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
	TransactionIntentState,
	TransactionIntentVia,
	TransactionObserver,
} from './types.js';

/**
 * Compute the merged intent state from all its transactions.
 *
 * Priority order (highest wins):
 * 1. Included - At least one tx is included in a block
 * 2. InMemPool - At least one tx is active in mempool
 * 3. NotFound - None visible in mempool
 * 4. Dropped - ALL txs are dropped (intent failed)
 *
 * For the Included state:
 * - If ANY tx succeeded → outcome: Success
 * - If ALL included txs failed → outcome: Failure
 * - `via` points to the winning attempt: first success, or first failure if
 *   all failed.
 */
function computeIntentState(intent: TransactionIntent): TransactionIntentState {
	const transactions = intent.transactions;

	// An effect observed out of band cannot be un-observed: nothing in the
	// transactions can disprove it, and this function has no way to re-check it.
	// It is kept unless one of the intent's own attempts succeeded, which points
	// at a hash and is therefore strictly more information.
	const provenOutOfBand =
		intent.state?.inclusion === 'Included' &&
		intent.state.via.kind === 'expectedUpdate'
			? intent.state
			: undefined;

	// An intent with no transaction has nothing to report yet: it may have been
	// added before its first broadcast, or it may be waiting to be proved by an
	// `expectedUpdate` alone. NotFound is the honest answer; Dropped would claim
	// the intent failed, which nothing here observed.
	if (transactions.length === 0) {
		return provenOutOfBand ?? {inclusion: 'NotFound'};
	}

	// Check for any Included txs - find index of first success, or first failure
	let winningIndex = -1;
	let hasSuccess = false;

	for (let i = 0; i < transactions.length; i++) {
		const transaction = transactions[i];
		if (transaction.state?.inclusion === 'Included') {
			if (transaction.state.outcome === 'Success') {
				winningIndex = i;
				hasSuccess = true;
				break; // First success wins
			} else if (winningIndex === -1) {
				winningIndex = i; // First failure as fallback
			}
		}
	}

	if (winningIndex >= 0 && (hasSuccess || !provenOutOfBand)) {
		// Finality and inclusion time are the winning attempt's: it is the one
		// the intent's result comes from.
		const winningState = transactions[winningIndex].state;
		const winning =
			winningState?.inclusion === 'Included' ? winningState : undefined;
		/* v8 ignore next - winningIndex is only ever set from an Included state */
		return {
			inclusion: 'Included',
			outcome: hasSuccess ? 'Success' : 'Failure',
			final: winning?.final ?? false,
			blockTimestamp: winning?.blockTimestamp,
			via: {kind: 'attempt', attemptIndex: winningIndex},
		};
	}

	// A failed attempt does not undo an effect that was observed on chain.
	if (provenOutOfBand) {
		return provenOutOfBand;
	}

	// Check for any InMemPool
	if (
		transactions.some(
			(transaction) => transaction.state?.inclusion === 'InMemPool',
		)
	) {
		return {inclusion: 'InMemPool'};
	}

	// Dropped requires EVERY transaction to be observed as dropped. A tx that
	// has not been looked at yet proves nothing, so it reads as NotFound.
	const allDropped = transactions.every(
		(transaction) => transaction.state?.inclusion === 'Dropped',
	);
	if (!allDropped) {
		return {inclusion: 'NotFound'};
	}

	// The intent's drop is final only once every drop is final.
	const allFinal = transactions.every(
		(transaction) =>
			transaction.state?.inclusion === 'Dropped' && transaction.state.final,
	);

	return {inclusion: 'Dropped', final: allFinal};
}

function isSameVia(
	a: TransactionIntentVia | undefined,
	b: TransactionIntentVia | undefined,
): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}
	if (a.kind !== b.kind) {
		return false;
	}
	if (a.kind === 'attempt' && b.kind === 'attempt') {
		return a.attemptIndex === b.attemptIndex;
	}
	return true;
}

/**
 * Update an intent's state from a computed state.
 * This mutates the intent in place.
 *
 * The whole object is assigned rather than field by field: the arms of
 * `TransactionIntentState` do not share keys, so a field-by-field assignment
 * would leave stale keys from the previous arm behind. Assigning the object
 * also makes an arm switch atomic.
 */
function applyIntentState(
	intent: TransactionIntent,
	newState: TransactionIntentState,
): void {
	intent.state = newState;
}

/**
 * Check if the intent state has changed.
 */
function hasIntentStateChanged(
	intent: TransactionIntent,
	newState: TransactionIntentState,
): boolean {
	const current = intent.state;
	if (!current) {
		return true;
	}
	return (
		current.inclusion !== newState.inclusion ||
		current.outcome !== newState.outcome ||
		current.final !== newState.final ||
		current.blockTimestamp !== newState.blockTimestamp ||
		// `via` is a discriminated union: compare it structurally (kind first,
		// then the arm's payload), otherwise a transition between two Included
		// arms, or between two winning attempts, would go unnoticed.
		!isSameVia(current.via, newState.via)
	);
}

function clone<T>(v: T): DeepWritable<T> {
	return structuredClone(v) as DeepWritable<T>;
}

/**
 * Everything one process() tick knows about the chain head, shared by every
 * intent and transaction processed during that tick.
 */
type ProcessContext = {
	latestBlockNumber: number;
	latestBlockTime: number;
	latestFinalizedBlock: EIP1193Block;
	latestFinalizedBlockTime: number;
	startGeneration: number;
	/**
	 * The provider generation the tick started on. A tick that started against
	 * one chain must not write its answers after setProvider swapped in another.
	 */
	startProviderGeneration: number;
};

export function createTransactionObserver(config: {
	finality: number;
	throttle?: number;
	provider?: EIP1193ProviderWithoutEvents;
	/**
	 * Some providers (notably injected wallets like MetaMask on dev/local
	 * chains) cache `eth_getTransactionByHash` and keep returning a stale
	 * pending view of a mined transaction, with `blockNumber: null`. By default
	 * the observer only fetches the receipt when `getTransactionByHash` reports a
	 * block, so against such a provider a mined tx stays stuck as `InMemPool`.
	 *
	 * When `alwaysFetchReceipt` is true, the observer additionally calls
	 * `eth_getTransactionReceipt` directly whenever the tx is known to the
	 * provider but reports no block. If the receipt shows inclusion, the tx is
	 * marked `Included`. This mirrors what a direct receipt lookup (e.g. a block
	 * explorer) does and does not require any dedicated/hardcoded RPC.
	 *
	 * Defaults to `false` to preserve existing behaviour.
	 */
	alwaysFetchReceipt?: boolean;
}): TransactionObserver {
	const emitter = new Emitter<{
		// Fires when anything in the intent changes (for persistence)
		'intent:updated': TransactionIntentEvent;
		// Fires only when the intent state changes (for UI/state updates)
		'intent:state': TransactionIntentEvent;
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
	// The chain the provider is on. Fetched once and refreshed on setProvider.
	let chainId: number | undefined;
	// The provider cannot answer eth_chainId. Remembered so we do not spend a
	// round trip per tick asking again; setProvider re-arms it.
	let chainIdUnavailable = false;
	// Increments on every setProvider so a late chain id answer from a previous
	// provider cannot overwrite the current one.
	let providerGeneration = 0;
	// Intents already reported as belonging to another chain, so the warning is
	// logged once and not on every tick.
	const chainMismatchWarned: Set<string> = new Set();
	// The latest block number seen by process(), used by add() to window an
	// expectedUpdate without spending an extra RPC.
	let lastKnownBlockNumber: number | undefined;
	// Transactions there is nothing left to learn about: the hash was never seen
	// on chain and the nonce the consumer supplied is consumed in finalized
	// history. They keep their honest `NotFound` state but stop being polled.
	// Deliberately NOT persisted: it is re-derived in one tick after a reload,
	// and it would be a lie in a stored record (the observer never proved it).
	const unobservable: Set<string> = new Set();

	/**
	 * True when the tick that produced this context is no longer the current
	 * session: clear() emptied the observer, or setProvider pointed it at
	 * another chain. Either way its answers must not be written or emitted.
	 */
	function aborted(context: ProcessContext): boolean {
		return (
			clearGeneration !== context.startGeneration ||
			providerGeneration !== context.startProviderGeneration
		);
	}

	async function fetchChainId(): Promise<void> {
		if (!provider) {
			return;
		}
		const generation = providerGeneration;
		const usedProvider = provider;
		try {
			const chainIdAsHex = await usedProvider.request({method: 'eth_chainId'});
			const answered = Number(chainIdAsHex);
			if (!Number.isInteger(answered) || answered <= 0) {
				// A garbage answer must not turn every tagged intent foreign.
				logger.error(`provider returned an unusable chainId: ${chainIdAsHex}`);
				chainIdUnavailable = true;
				return;
			}
			if (generation === providerGeneration) {
				chainId = answered;
				logger.debug(`chainId: ${chainId}`);
			}
		} catch (err) {
			// Not knowing the chain must not stop processing: the check simply
			// stays disabled. Asking again every tick would cost a round trip per
			// poll forever against a provider that does not support the method.
			chainIdUnavailable = true;
			logger.error('failed to fetch chainId', err);
		}
	}

	/**
	 * The first transaction of the intent that claims a chain the provider is
	 * not on. Unknown chain id (provider never answered) means no check.
	 */
	function foreignTransaction(
		intent: TransactionIntent,
	): BroadcastedTransaction | undefined {
		if (chainId === undefined) {
			return undefined;
		}
		return intent.transactions.find(
			(transaction) =>
				typeof transaction.chainId === 'number' &&
				transaction.chainId !== chainId,
		);
	}

	/**
	 * True when the intent belongs to another chain, warning once per intent.
	 */
	function isFromAnotherChain(id: string, intent: TransactionIntent): boolean {
		const foreign = foreignTransaction(intent);
		if (!foreign) {
			return false;
		}
		if (!chainMismatchWarned.has(id)) {
			chainMismatchWarned.add(id);
			logger.warn(
				`intent ${id} skipped: transaction ${foreign.hash} is from chain ${foreign.chainId}, provider is on chain ${chainId}`,
			);
		}
		return true;
	}

	/**
	 * Fill `expectedUpdate.fromBlock` when the caller did not supply one.
	 * Returns true when it filled it, so the caller can emit the new value:
	 * the consumer must persist it, otherwise a reload would move the window
	 * forward and an event that landed meanwhile would be missed forever.
	 */
	function fillExpectedUpdateWindow(
		intent: TransactionIntent,
		blockNumber: number | undefined,
	): boolean {
		if (blockNumber === undefined) {
			return false;
		}
		if (
			!intent.expectedUpdate ||
			intent.expectedUpdate.fromBlock !== undefined
		) {
			return false;
		}
		intent.expectedUpdate.fromBlock = blockNumber;
		return true;
	}

	function addMultiple(
		intents: DeepReadonly<{[id: string]: TransactionIntent}>,
	) {
		logger.debug(`adding ${Object.keys(intents).length} intents...`);
		const windowed: string[] = [];
		for (const entry of Object.entries(intents)) {
			if (_add(entry[0], entry[1])) {
				windowed.push(entry[0]);
			}
		}
		if (emitter.hasListeners('intents:added')) {
			emitter.emit('intents:added', clone(intents));
		}
		emitFilledWindows(windowed);
	}

	/**
	 * Emit the intents whose expectedUpdate window we just filled in, so the
	 * consumer persists the value we chose.
	 */
	function emitFilledWindows(ids: string[]) {
		if (ids.length === 0 || !emitter.hasListeners('intent:updated')) {
			return;
		}
		for (const id of ids) {
			const intent = intentsById[id];
			if (intent) {
				emitter.emit('intent:updated', {id, intent: clone(intent)});
			}
		}
	}

	/**
	 * Returns true when the intent's expectedUpdate window was filled in.
	 */
	function _add(
		id: string,
		intentToAdd: DeepReadonly<TransactionIntent>,
	): boolean {
		const intent = clone(intentToAdd);
		logger.debug(`adding intent ${id}...`);
		const existing = intentsById[id];
		if (!existing) {
			intentsById[id] = intent;
			// Index all tx hashes for this intent
			for (const transaction of intent.transactions) {
				txToIntent[transaction.hash] = intent;
			}
			return fillExpectedUpdateWindow(intent, lastKnownBlockNumber);
		}
		// Update existing intent - merge transactions
		for (const transaction of intent.transactions) {
			if (!txToIntent[transaction.hash]) {
				existing.transactions.push(transaction);
				txToIntent[transaction.hash] = existing;
			}
		}
		// A watch can be attached after the intent was registered (the app often
		// only knows the event signature later). An existing watch is never
		// replaced: that would move its `fromBlock` forward and lose the window.
		if (!existing.expectedUpdate && intent.expectedUpdate) {
			existing.expectedUpdate = intent.expectedUpdate;
		}
		return fillExpectedUpdateWindow(existing, lastKnownBlockNumber);
	}

	function add(id: string, intentToAdd: DeepReadonly<TransactionIntent>) {
		const windowFilled = _add(id, intentToAdd);
		if (emitter.hasListeners('intents:added')) {
			emitter.emit('intents:added', {
				[id]: clone(intentToAdd),
			});
		}
		if (windowFilled) {
			emitFilledWindows([id]);
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
				unobservable.delete(transaction.hash);
			}
			delete intentsById[key];
			chainMismatchWarned.delete(key);
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
				unobservable.delete(transaction.hash);
			}
			delete intentsById[intentId];
		}
		chainMismatchWarned.delete(intentId);

		if (emitter.hasListeners('intents:removed')) {
			emitter.emit('intents:removed', [intentId]);
		}
	}

	/**
	 * Check if a transaction needs processing (is not yet final).
	 * A transaction is final if it is Included or Dropped and past the
	 * finality depth.
	 */
	function isTransactionFinal(transaction: BroadcastedTransaction): boolean {
		if (!transaction.state) {
			return false;
		}
		if (!transaction.state.final) {
			return false;
		}
		return (
			transaction.state.inclusion === 'Included' ||
			transaction.state.inclusion === 'Dropped'
		);
	}

	/**
	 * Check if there is anything left to ask the chain about.
	 *
	 * A transaction is worth polling unless it is final, or the observer gave up
	 * on it (see `unobservable`). An intent from another chain is never polled:
	 * it would only spend the two head-block requests every tick.
	 */
	function hasTransactionsToProcess(): boolean {
		for (const id of Object.keys(intentsById)) {
			const intent = intentsById[id];
			if (foreignTransaction(intent)) {
				continue;
			}
			// A watch with no window yet needs one tick to get its `fromBlock`,
			// even when the intent has nothing else to poll: an intent waiting
			// only for an out-of-band effect is exactly what the field is for.
			if (
				intent.expectedUpdate &&
				intent.expectedUpdate.fromBlock === undefined
			) {
				return true;
			}
			for (const transaction of intent.transactions) {
				if (unobservable.has(transaction.hash)) {
					continue;
				}
				if (!isTransactionFinal(transaction)) {
					return true;
				}
			}
		}
		return false;
	}

	async function process() {
		if (!provider) {
			return;
		}

		// Skip if there are no transactions to check
		if (!hasTransactionsToProcess()) {
			logger.debug('process skipped: no transactions to process');
			return;
		}

		// Capture generation at start to detect if clear() is called during processing
		const startGeneration = clearGeneration;
		// Same idea for the provider: a tick that started against one chain must
		// not write its answers into the intents after the provider was swapped.
		const startProviderGeneration = providerGeneration;

		if (chainId === undefined && !chainIdUnavailable) {
			await fetchChainId();
			if (
				clearGeneration !== startGeneration ||
				providerGeneration !== startProviderGeneration
			) {
				logger.debug('process aborted after chainId fetch');
				return;
			}
		}

		// The two block fetches are infrastructure-level: if we can't even read the
		// chain head, the whole tick cannot proceed. We let such errors reject
		// process() (the caller's interval simply retries next tick). Per-intent
		// errors, by contrast, are isolated below so one bad tx can't wedge others.
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
		lastKnownBlockNumber = latestBlockNumber;

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
			if (
				clearGeneration !== startGeneration ||
				providerGeneration !== startProviderGeneration
			) {
				logger.debug('process aborted in intent loop');
				return;
			}
			// Isolate per-intent failures: a provider error on one intent's tx
			// (e.g. an injected wallet mishandling a specific request) must not
			// prevent the other intents from being processed, nor wedge the loop.
			// The intent is simply retried on the next tick.
			try {
				await processTransactionIntent(id, intentsById[id], {
					latestBlockNumber,
					latestBlockTime,
					latestFinalizedBlock,
					latestFinalizedBlockTime,
					startGeneration,
					startProviderGeneration,
				});
			} catch (err) {
				logger.error(`process: failed to process intent ${id}`, err);
			}
		}
	}

	async function processTransactionIntent(
		id: string,
		intent: TransactionIntent,
		context: ProcessContext,
	): Promise<boolean> {
		const {latestBlockNumber, startGeneration} = context;
		/* v8 ignore start - defensive check: provider verified in process() */
		if (!provider) {
			return false;
		}
		/* v8 ignore stop */

		// A transaction carrying a chainId that is not the provider's chain
		// cannot be resolved here: its hash is unknown to this node and its
		// sender's nonce means nothing. Skip the intent rather than reporting a
		// state computed against the wrong chain.
		if (isFromAnotherChain(id, intent)) {
			return false;
		}

		// The caller may have created the intent without a window; fill it from
		// the block we just polled so it does not need an RPC of its own.
		const windowFilled = fillExpectedUpdateWindow(intent, latestBlockNumber);

		// CONSISTENCY GUARANTEE: Snapshot transactions to avoid mid-iteration modifications
		// This ensures stable iteration while allowing new txs to be added via addMultiple()
		const attemptsSnapshot = [...intent.transactions];
		const initialTxCount = attemptsSnapshot.length;

		// Process each transaction from the snapshot, track if any changed
		let anyTxChanged = false;
		for (const transaction of attemptsSnapshot) {
			if (aborted(context)) {
				logger.debug(`processTransactionIntent aborted for ${id}`);
				return false;
			}
			const changed = await processAttempt(transaction, context);
			if (changed) anyTxChanged = true;
		}

		if (aborted(context)) {
			logger.debug(
				`processTransactionIntent aborted for ${id} after processing`,
			);
			return false;
		}

		// Check if new txs were added during processing
		const txsWereAdded = intent.transactions.length > initialTxCount;

		// IMPORTANT: Compute state from ALL current txs, not just snapshot
		// This ensures txs added during processing are included in the computation
		// and emitted transactions always include all known transactions
		const newState = computeIntentState(intent);
		const stateChanged = hasIntentStateChanged(intent, newState);

		// Update intent state if changed
		if (stateChanged) {
			applyIntentState(intent, newState);
		}

		// Final check before emissions - ensure the session is still the same and
		// the intent still exists. This prevents emitting events for intents from
		// a previous session (e.g., a different account or a different chain).
		if (aborted(context)) {
			logger.debug(`processTransactionIntent aborted for ${id} before emit`);
			return false;
		}

		// Emit events if still tracked
		if (intentsById[id]) {
			// Emit 'intent:updated' for any change worth persisting, INCLUDING a
			// state change: a consumer that persists on this event must never end
			// up storing a state the UI was never told about.
			if (anyTxChanged || txsWereAdded || windowFilled || stateChanged) {
				if (emitter.hasListeners('intent:updated')) {
					emitter.emit('intent:updated', {
						id,
						intent: clone(intent),
					});
				}
			}

			// Emit 'intent:state' only when the intent state changes (for UI/state)
			if (stateChanged) {
				if (emitter.hasListeners('intent:state')) {
					emitter.emit('intent:state', {
						id,
						intent: clone(intent),
					});
				}
			}
		}

		return anyTxChanged || stateChanged || windowFilled;
	}

	async function processAttempt(
		transaction: BroadcastedTransaction,
		context: ProcessContext,
	): Promise<boolean> {
		const {latestBlockNumber, latestFinalizedBlock} = context;
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

		// Nothing left to learn about this one (see `unobservable`).
		if (unobservable.has(transaction.hash)) {
			return false;
		}

		// IMPORTANT: Fetch nonce count BEFORE eth_getTransactionByHash to avoid race condition.
		// If we checked tx first and it was not found, then the tx got included before nonce check,
		// we'd incorrectly mark it as Dropped. By fetching nonce first, we capture the state
		// before looking up the tx, ensuring correct Dropped vs NotFound determination.
		const account = transaction.from;
		const latestTransactionCount = await provider.request({
			method: 'eth_getTransactionCount',
			params: [account, 'latest'],
		});
		if (aborted(context)) {
			return false;
		}
		const latestNonce = Number(latestTransactionCount);
		logger.debug(`latestNonce: ${latestNonce}`);

		const txFromPeers = await provider.request({
			method: 'eth_getTransactionByHash',
			params: [transaction.hash],
		});

		if (aborted(context)) {
			return false;
		}

		let changes = false;
		if (txFromPeers) {
			// The chain just told us the nonce the transaction was actually signed
			// with. This is the only trustworthy source: what the consumer passed
			// in was the nonce it INTENDED, and a wallet may have used another.
			const observedNonce = Number(txFromPeers.nonce);
			if (
				// A provider that answers something unusable must not turn into a
				// write on every tick (NaN !== NaN), nor claim the nonce is known.
				Number.isInteger(observedNonce) &&
				(transaction.nonce !== observedNonce ||
					transaction.nonceObserved !== true)
			) {
				transaction.nonce = observedNonce;
				transaction.nonceObserved = true;
				changes = true;
			}

			let receipt;
			// Normally the receipt is only worth fetching once the tx reports a
			// block. But some providers keep returning a stale pending view
			// (blockNumber null) for an already-mined tx; `alwaysFetchReceipt`
			// makes us ask for the receipt directly in that case too.
			if (txFromPeers.blockNumber || config.alwaysFetchReceipt) {
				receipt = await provider.request({
					method: 'eth_getTransactionReceipt',
					params: [transaction.hash],
				});
				if (aborted(context)) {
					return false;
				}
			}
			if (receipt) {
				// The tx view may be stale (blockHash null) while the receipt
				// carries the real inclusion block; prefer the receipt's blockHash.
				const blockHash = txFromPeers.blockHash ?? receipt.blockHash;
				const block = blockHash
					? await provider.request({
							method: 'eth_getBlockByHash',
							params: [blockHash, false],
						})
					: null;
				if (aborted(context)) {
					return false;
				}
				if (!block) {
					// We have a receipt (proof of mining) but could not resolve its
					// block yet, e.g. a lagging provider that has not surfaced the
					// inclusion block through eth_getBlockByHash. Leave the state
					// unchanged and retry next tick rather than reporting a false
					// state; log it so the situation is observable.
					logger.debug(
						`receipt present for ${transaction.hash} but block ${blockHash} not resolvable yet; retrying next tick`,
					);
				}
				if (block) {
					const blockNumber = Number(block.number);
					// The inclusion block's own timestamp, in chain seconds. Recorded
					// as soon as the tx is included so a UI can show "mined at"
					// before the tx is final.
					const blockTimestamp = Number(block.timestamp);
					const isFinal = latestBlockNumber - blockNumber >= config.finality;
					const outcome =
						receipt.status === '0x0' || receipt.status === '0x00'
							? 'Failure'
							: 'Success';
					const current = transaction.state;
					if (
						current?.inclusion !== 'Included' ||
						current.outcome !== outcome ||
						current.final !== isFinal ||
						current.blockTimestamp !== blockTimestamp
					) {
						// Whole-object assignment: the state arms do not share keys.
						transaction.state = {
							inclusion: 'Included',
							outcome,
							final: isFinal,
							blockTimestamp,
						};
						changes = true;
					}
				}
			} else {
				if (transaction.state?.inclusion !== 'InMemPool') {
					transaction.state = {inclusion: 'InMemPool'};
					changes = true;
				}
			}
		} else {
			// NOTE: we fetched it again to ensure the call was not lost
			const txFromPeers = await provider.request({
				method: 'eth_getTransactionByHash',
				params: [transaction.hash],
			});
			if (aborted(context)) {
				return false;
			}
			if (txFromPeers) {
				return false; // we skip it for now
			}

			// The node has never heard of this hash. The nonce fetched before the
			// lookup decides between "gone" and "not visible yet".
			const nonce = transaction.nonce;
			if (typeof nonce === 'number' && latestNonce > nonce) {
				// The nonce is spent. Is it spent for good?
				const finalizedTransactionCount = await provider.request({
					method: 'eth_getTransactionCount',
					params: [account, {blockHash: latestFinalizedBlock.hash}],
				});
				if (aborted(context)) {
					return false;
				}
				const finalityNonce = Number(finalizedTransactionCount);
				logger.debug(`finalityNonce: ${finalityNonce}`);
				const spentForGood = finalityNonce > nonce;

				// Only an OBSERVED nonce may declare a transaction dropped. A nonce
				// supplied by the consumer is the one it INTENDED; the wallet may
				// have signed another. Combined with a hash this node cannot find,
				// an intended nonce would yield a confident "Dropped" for a
				// transaction that is in fact still pending at a higher nonce.
				if (transaction.nonceObserved === true) {
					const current = transaction.state;
					if (
						current?.inclusion !== 'Dropped' ||
						current.final !== spentForGood
					) {
						transaction.state = {inclusion: 'Dropped', final: spentForGood};
						changes = true;
					}
				} else {
					if (transaction.state?.inclusion !== 'NotFound') {
						transaction.state = {inclusion: 'NotFound'};
						changes = true;
					}
					if (spentForGood) {
						// We cannot call this Dropped, but there is also nothing left
						// to learn: the hash was never seen on this chain and the
						// nonce we were given is spent in finalized history. Keep the
						// honest NotFound and stop polling, instead of paying RPC for
						// this transaction on every tick forever.
						if (!unobservable.has(transaction.hash)) {
							unobservable.add(transaction.hash);
							logger.debug(
								`giving up on ${transaction.hash}: never seen on chain and its intended nonce ${nonce} is finalized-spent`,
							);
						}
					}
				}
			} else {
				// The nonce is not spent yet (or we have none): the transaction may
				// still show up. NotFound is the honest answer.
				if (transaction.state?.inclusion !== 'NotFound') {
					transaction.state = {inclusion: 'NotFound'};
					changes = true;
				}
			}
		}

		return changes;
	}

	return {
		setProvider(newProvider: EIP1193Provider) {
			provider = newProvider;
			providerGeneration++;
			chainId = undefined;
			chainIdUnavailable = false;
			chainMismatchWarned.clear();
			// Block numbers and "nothing left to learn" verdicts belong to the
			// chain they were derived from.
			lastKnownBlockNumber = undefined;
			unobservable.clear();
			void fetchChainId();
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
