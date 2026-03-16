import type {
	EIP1193Provider,
	EIP1193Block,
	EIP1193ProviderWithoutEvents,
	DeepReadonly,
} from 'eip-1193';
import {logs} from 'named-logs';
import {throttle} from 'lodash-es';
import {Emitter} from 'radiate';
const logger = logs('tx-observer');
import type {
	BroadcastedTransaction,
	DeepWritable,
	TransactionIntent,
	TransactionIntentEvent,
	TransactionIntentsAddedEvent,
	TransactionIntentsRemovedEvent,
	TransactionIntentStatus,
} from './types.js';

/**
 * Compute the merged intent status from all its transactions.
 *
 * Priority order (highest wins):
 * 1. Included - At least one tx is included in a block
 * 2. Broadcasted - At least one tx is active in mempool
 * 4. NotFound - None visible in mempool
 * 5. Dropped - ALL txs are dropped (intent failed)
 *
 * For Included status:
 * - If ANY tx succeeded → status: Success
 * - If ALL included txs failed → status: Failure
 * - attemptIndex points to first success, or first failure if all failed
 */
function computeIntentStatus(
	intent: TransactionIntent,
): TransactionIntentStatus {
	const transactions = intent.transactions;

	// Check for any Included txs - find index of first success, or first failure
	let winningIndex = -1;
	let hasSuccess = false;

	for (let i = 0; i < transactions.length; i++) {
		const transaction = transactions[i];
		if (transaction.state?.inclusion === 'Included') {
			if (transaction.state.status === 'Success') {
				winningIndex = i;
				hasSuccess = true;
				break; // First success wins
			} else if (winningIndex === -1) {
				winningIndex = i; // First failure as fallback
			}
		}
	}

	if (winningIndex >= 0) {
		// Determine finality - use the most final timestamp from included txs
		const includedAttempts = transactions.filter(
			(transaction) => transaction.state?.inclusion === 'Included',
		);
		let finalTimestamp: number | undefined;
		for (const transaction of includedAttempts) {
			if (transaction.state?.final !== undefined) {
				if (
					finalTimestamp === undefined ||
					transaction.state.final > finalTimestamp
				) {
					finalTimestamp = transaction.state.final;
				}
			}
		}

		return {
			inclusion: 'Included',
			status: hasSuccess ? 'Success' : 'Failure',
			final: finalTimestamp,
			attemptIndex: winningIndex,
		};
	}

	// Check for any Broadcasted
	if (
		transactions.some(
			(transaction) => transaction.state?.inclusion === 'InMemPool',
		)
	) {
		return {
			inclusion: 'InMemPool',
			final: undefined,
			status: undefined,
			attemptIndex: undefined,
		};
	}

	// Check for any NotFound
	if (
		transactions.some(
			(transaction) => transaction.state?.inclusion === 'NotFound',
		)
	) {
		return {
			inclusion: 'NotFound',
			final: undefined,
			status: undefined,
			attemptIndex: undefined,
		};
	}

	// All must be Dropped - find earliest dropped timestamp
	let droppedTimestamp: number | undefined;
	for (const transaction of transactions) {
		if (transaction.state?.final !== undefined) {
			if (
				droppedTimestamp === undefined ||
				transaction.state.final < droppedTimestamp
			) {
				droppedTimestamp = transaction.state.final;
			}
		}
	}

	return {
		inclusion: 'Dropped',
		final: droppedTimestamp,
		status: undefined,
		attemptIndex: undefined,
	};
}

/**
 * Update an intent's status fields from a computed status.
 * This mutates the intent in place.
 */
function applyIntentStatus(
	intent: TransactionIntent,
	newState: TransactionIntentStatus,
): void {
	if (!intent.state) {
		intent.state = newState;
	}
	intent.state.inclusion = newState.inclusion;
	intent.state.final = newState.final;
	intent.state.status = newState.status;
	intent.state.attemptIndex = newState.attemptIndex;
}

/**
 * Check if intent status has changed.
 */
function hasIntentStatusChanged(
	intent: TransactionIntent,
	newStatus: TransactionIntentStatus,
): boolean {
	if (!intent.state) {
		return true;
	}
	return (
		intent.state.inclusion !== newStatus.inclusion ||
		intent.state.final !== newStatus.final ||
		intent.state.status !== newStatus.status ||
		intent.state.attemptIndex !== newStatus.attemptIndex
	);
}

function clone<T>(v: T): DeepWritable<T> {
	return structuredClone(v) as DeepWritable<T>;
}

export function createTransactionObserver(config: {
	finality: number;
	throttle?: number;
	provider?: EIP1193ProviderWithoutEvents;
}) {
	const emitter = new Emitter<{
		// Fires when any TX in the intent changes (for persistence)
		'intent:updated': TransactionIntentEvent;
		// Fires only when intent status changes (for UI/state updates)
		'intent:status': TransactionIntentEvent;
		'intents:added': TransactionIntentsAddedEvent;
		'intents:removed': TransactionIntentsRemovedEvent;
		'intents:cleared': void;
	}>();

	let provider: EIP1193ProviderWithoutEvents | undefined = config.provider;
	const intentsById: {[id: string]: TransactionIntent} = {};
	// Maintain tx hash lookup for efficient updates
	const txToIntent: {[txHash: string]: TransactionIntent} = {};
	// Session counter to invalidate in-flight processing when clear() is called
	let clearGeneration = 0;

	function addMultiple(
		intents: DeepReadonly<{[id: string]: TransactionIntent}>,
	) {
		logger.debug(`adding ${Object.keys(intents).length} intents...`);
		for (const entry of Object.entries(intents)) {
			_add(entry[0], entry[1]);
		}
		if (emitter.hasListeners('intents:added')) {
			emitter.emit('intents:added', clone(intents));
		}
	}

	function _add(
		id: string,
		intentToAdd: DeepReadonly<TransactionIntent>,
	): TransactionIntent {
		const intent = clone(intentToAdd);
		logger.debug(`adding intent ${id}...`);
		const existing = intentsById[id];
		if (!existing) {
			intentsById[id] = intent;
			// Index all tx hashes for this intent
			for (const transaction of intent.transactions) {
				txToIntent[transaction.hash] = intent;
			}
		} else {
			// Update existing intent - merge transactions
			for (const transaction of intent.transactions) {
				if (!txToIntent[transaction.hash]) {
					existing.transactions.push(transaction);
					txToIntent[transaction.hash] = existing;
				}
			}
		}
		return intent;
	}

	function add(id: string, intentToAdd: DeepReadonly<TransactionIntent>) {
		_add(id, intentToAdd);
		if (emitter.hasListeners('intents:added')) {
			emitter.emit('intents:added', {
				[id]: clone(intentToAdd),
			});
		}
	}

	function clear() {
		logger.debug(`clearing transactions...`);
		// Increment generation to invalidate any in-flight processing
		clearGeneration++;
		logger.debug(`clear generation incremented to ${clearGeneration}`);
		const keys = Object.keys(intentsById);
		for (const key of keys) {
			const intent = intentsById[key];
			for (const transaction of intent.transactions) {
				delete txToIntent[transaction.hash];
			}
			delete intentsById[key];
		}
		if (emitter.hasListeners('intents:cleared')) {
			emitter.emit('intents:cleared', undefined);
		}
	}

	function remove(intentId: string) {
		logger.debug(`removing intent ${intentId}...`);
		const intent = intentsById[intentId];
		if (intent) {
			// Remove transaction hash mappings
			for (const transaction of intent.transactions) {
				delete txToIntent[transaction.hash];
			}
			delete intentsById[intentId];
		}

		if (emitter.hasListeners('intents:removed')) {
			emitter.emit('intents:removed', [intentId]);
		}
	}

	async function process() {
		if (!provider) {
			return;
		}

		// Capture generation at start to detect if clear() is called during processing
		const startGeneration = clearGeneration;

		const latestBlock = await provider.request({
			method: 'eth_getBlockByNumber',
			params: ['latest', false],
		});

		// Abort if clear() was called
		if (clearGeneration !== startGeneration) {
			logger.debug(
				'process aborted after latest block fetch: clear() was called',
			);
			return;
		}

		if (!latestBlock) {
			return;
		}

		const latestBlockTime = Number(latestBlock.timestamp);
		const latestBlockNumber = Number(latestBlock.number);

		logger.debug(`latestBlock: ${latestBlockNumber}`);

		const latestFinalizedBlockNumber = Math.max(
			latestBlockNumber - config.finality,
			0,
		);

		const latestFinalizedBlock = await provider.request({
			method: 'eth_getBlockByNumber',
			params: [`0x${latestFinalizedBlockNumber.toString(16)}`, false],
		});

		// Abort if clear() was called
		if (clearGeneration !== startGeneration) {
			logger.debug(
				'process aborted after finalized block fetch: clear() was called',
			);
			return;
		}

		if (!latestFinalizedBlock) {
			return;
		}
		const latestFinalizedBlockTime = Number(latestFinalizedBlock.timestamp);

		logger.debug(`latestFinalizedBlock: ${latestFinalizedBlockNumber}`);

		for (const id of Object.keys(intentsById)) {
			// Check before processing each intent
			if (clearGeneration !== startGeneration) {
				logger.debug('process aborted in intent loop: clear() was called');
				return;
			}
			await processTransactionIntent(id, intentsById[id], {
				latestBlockNumber,
				latestBlockTime,
				latestFinalizedBlock,
				latestFinalizedBlockTime,
				startGeneration,
			});
		}
	}

	async function processTransactionIntent(
		id: string,
		intent: TransactionIntent,
		{
			latestBlockNumber,
			latestBlockTime,
			latestFinalizedBlock,
			latestFinalizedBlockTime,
			startGeneration,
		}: {
			latestBlockNumber: number;
			latestBlockTime: number;
			latestFinalizedBlock: EIP1193Block;
			latestFinalizedBlockTime: number;
			startGeneration: number;
		},
	): Promise<boolean> {
		/* v8 ignore start - defensive check: provider verified in process() */
		if (!provider) {
			return false;
		}
		/* v8 ignore stop */

		// CONSISTENCY GUARANTEE: Snapshot transactions to avoid mid-iteration modifications
		// This ensures stable iteration while allowing new txs to be added via addMultiple()
		const attemptsSnapshot = [...intent.transactions];
		const initialTxCount = attemptsSnapshot.length;

		// Process each transaction from the snapshot, track if any changed
		let anyTxChanged = false;
		for (const transaction of attemptsSnapshot) {
			// Abort if clear() was called
			if (clearGeneration !== startGeneration) {
				logger.debug(
					`processTransactionIntent aborted for ${id}: clear() was called`,
				);
				return false;
			}
			const changed = await processAttempt(transaction, {
				latestBlockNumber,
				latestBlockTime,
				latestFinalizedBlock,
				latestFinalizedBlockTime,
				startGeneration,
			});
			if (changed) anyTxChanged = true;
		}

		// Abort if clear() was called during transaction processing
		if (clearGeneration !== startGeneration) {
			logger.debug(
				`processTransactionIntent aborted for ${id} after processing: clear() was called`,
			);
			return false;
		}

		// Check if new txs were added during processing
		const txsWereAdded = intent.transactions.length > initialTxCount;

		// Only recompute status if we processed something or new txs were added
		// This prevents spurious emissions for empty transactions
		if (initialTxCount === 0 && !txsWereAdded) {
			return false;
		}

		// IMPORTANT: Compute status from ALL current txs, not just snapshot
		// This ensures txs added during processing are included in status computation
		// and emitted transactions always include all known transactions
		const newStatus = computeIntentStatus(intent);
		const statusChanged = hasIntentStatusChanged(intent, newStatus);

		// Update intent status fields if changed
		if (statusChanged) {
			applyIntentStatus(intent, newStatus);
		}

		// Final check before emissions - ensure clear() wasn't called and intent still exists
		// This prevents emitting events for intents from a previous session (e.g., different account)
		if (clearGeneration !== startGeneration) {
			logger.debug(
				`processTransactionIntent aborted for ${id} before emit: clear() was called`,
			);
			return false;
		}

		// Emit events if still tracked
		if (intentsById[id]) {
			// Emit 'intent' for any TX change (for persistence)
			if (anyTxChanged || txsWereAdded) {
				if (emitter.hasListeners('intent:updated')) {
					emitter.emit('intent:updated', {
						id,
						intent: clone(intent),
					});
				}
			}

			// Emit 'intent:status' only when intent status changes (for UI/state)
			if (statusChanged) {
				if (emitter.hasListeners('intent:status')) {
					emitter.emit('intent:status', {
						id,
						intent: clone(intent),
					});
				}
			}
		}

		return anyTxChanged || statusChanged;
	}

	async function processAttempt(
		transaction: BroadcastedTransaction,
		{
			latestBlockNumber,
			latestBlockTime,
			latestFinalizedBlock,
			latestFinalizedBlockTime,
			startGeneration,
		}: {
			latestBlockNumber: number;
			latestBlockTime: number;
			latestFinalizedBlock: EIP1193Block;
			latestFinalizedBlockTime: number;
			startGeneration: number;
		},
	): Promise<boolean> {
		/* v8 ignore start - defensive check: provider verified in process() */
		if (!provider) {
			return false;
		}
		/* v8 ignore stop */

		if (transaction.state && transaction.state.inclusion === 'Included') {
			if (transaction.state.final) {
				// TODO auto remove ?
				return false;
			}
		}

		const txFromPeers = await provider.request({
			method: 'eth_getTransactionByHash',
			params: [transaction.hash],
		});

		// Abort if clear() was called
		if (clearGeneration !== startGeneration) {
			return false;
		}

		let changes = false;
		if (txFromPeers) {
			let receipt;
			if (txFromPeers.blockNumber) {
				receipt = await provider.request({
					method: 'eth_getTransactionReceipt',
					params: [transaction.hash],
				});
				// Abort if clear() was called
				if (clearGeneration !== startGeneration) {
					return false;
				}
			}
			if (receipt) {
				const block = await provider.request({
					method: 'eth_getBlockByHash',
					params: [txFromPeers.blockHash, false],
				});
				// Abort if clear() was called
				if (clearGeneration !== startGeneration) {
					return false;
				}
				if (block) {
					const blockNumber = Number(block.number);
					const blockTimestamp = Number(block.timestamp);
					const is_final = latestBlockNumber - blockNumber >= config.finality;
					if (receipt.status === '0x0' || receipt.status === '0x00') {
						if (transaction.state) {
							if (
								transaction.state.status !== 'Failure' ||
								transaction.state.final !== blockTimestamp
							) {
								transaction.state.inclusion = 'Included';
								transaction.state.status = 'Failure';
								transaction.state.final = is_final ? blockTimestamp : undefined;
								changes = true;
							}
						} else {
							transaction.state = {
								inclusion: 'Included',
								status: 'Failure',
								final: is_final ? blockTimestamp : undefined,
							};
							changes = true;
						}
					} else {
						if (transaction.state) {
							if (
								transaction.state.status !== 'Success' ||
								transaction.state.final !== blockTimestamp
							) {
								transaction.state.inclusion = 'Included';
								transaction.state.status = 'Success';
								transaction.state.final = is_final ? blockTimestamp : undefined;
								changes = true;
							}
						} else {
							transaction.state = {
								inclusion: 'Included',
								status: 'Success',
								final: is_final ? blockTimestamp : undefined,
							};
							changes = true;
						}
					}
				}
			} else {
				if (transaction.state) {
					if (
						transaction.state &&
						transaction.state.inclusion !== 'InMemPool'
					) {
						transaction.state.inclusion = 'InMemPool';
						transaction.state.final = undefined;
						transaction.state.status = undefined;
						transaction.nonce = Number(txFromPeers.nonce);
						changes = true;
					}
				} else {
					transaction.state = {
						inclusion: 'InMemPool',
						final: undefined,
						status: undefined,
					};
					transaction.nonce = Number(txFromPeers.nonce);
					changes = true;
				}
			}
		} else {
			// NOTE: we fetched it again to ensure the call was not lost
			const txFromPeers = await provider.request({
				method: 'eth_getTransactionByHash',
				params: [transaction.hash],
			});
			// Abort if clear() was called
			if (clearGeneration !== startGeneration) {
				return false;
			}
			if (txFromPeers) {
				return false; // we skip it for now
			}

			// TODO cache finalityNonce
			const account = transaction.from;
			const tranactionCount = await provider.request({
				method: 'eth_getTransactionCount',
				params: [account, {blockHash: latestFinalizedBlock.hash}],
			});
			// Abort if clear() was called
			if (clearGeneration !== startGeneration) {
				return false;
			}
			const finalityNonce = Number(tranactionCount);

			logger.debug(`finalityNonce: ${finalityNonce}`);

			if (
				typeof transaction.nonce === 'number' &&
				finalityNonce > transaction.nonce
			) {
				if (transaction.state) {
					if (
						transaction.state.inclusion !== 'Dropped' ||
						!transaction.state.final
					) {
						transaction.state.inclusion = 'Dropped';
						transaction.state.final =
							transaction.broadcastTimestampMs !== undefined
								? Math.floor(transaction.broadcastTimestampMs / 1000)
								: latestFinalizedBlockTime;
						transaction.state.status = undefined;
						changes = true;
					}
				} else {
					transaction.state = {
						inclusion: 'Dropped',
						status: undefined,
						final:
							transaction.broadcastTimestampMs !== undefined
								? Math.floor(transaction.broadcastTimestampMs / 1000)
								: latestFinalizedBlockTime,
					};
					changes = true;
				}
			} else {
				if (transaction.state) {
					if (transaction.state.inclusion !== 'NotFound') {
						transaction.state.inclusion = 'NotFound';
						transaction.state.final = undefined;
						transaction.state.status = undefined;
						changes = true;
					}
				} else {
					transaction.state = {
						inclusion: 'NotFound',
						final: undefined,
						status: undefined,
					};
					changes = true;
				}
			}
		}

		return changes;
	}

	return {
		setProvider(newProvider: EIP1193Provider) {
			provider = newProvider;
		},

		remove,
		clear,
		add,
		addMultiple,

		process: (config.throttle
			? throttle(process, config.throttle)
			: process) as typeof process,

		on: emitter.on.bind(emitter),
		off: emitter.off.bind(emitter),
	};
}
