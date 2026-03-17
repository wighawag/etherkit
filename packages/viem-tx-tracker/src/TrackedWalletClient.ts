import {
	parseTransaction,
	ParseTransactionReturnType,
	recoverTransactionAddress,
	type Abi,
	type Account,
	type Address,
	type Chain,
	type ContractFunctionArgs,
	type ContractFunctionName,
	type Hash,
	type PublicClient,
	type Transaction,
	type TransactionReceipt,
	type TransactionSerialized,
	type Transport,
	type WalletClient,
} from 'viem';
import {Emitter} from 'radiate';
import type {
	AccessList,
	BlockTag,
	CreateTrackedWalletClientOptions,
	KnownTrackedTransaction,
	NonceOption,
	PopulatedMetadata,
	TrackedRawTransactionParameters,
	TrackedSendTransactionParameters,
	TrackedTransaction,
	TrackedWalletClient,
	TrackedWalletClientAutoPopulate,
	TrackedWriteContractAutoPopulateParameters,
	TrackedWriteContractParameters,
	UnknownTrackedTransaction,
} from './types.js';

/**
 * Check if a value is a block tag string
 */
function isBlockTag(value: unknown): value is BlockTag {
	return (
		typeof value === 'string' &&
		['latest', 'pending', 'earliest', 'safe', 'finalized'].includes(value)
	);
}

/**
 * Resolve the account address from various account formats
 */
function resolveAccountAddress(
	account: Account | Address | undefined | null,
): Address | undefined {
	if (!account) return undefined;
	if (typeof account === 'string') return account;
	return account.address;
}

/**
 * Coerce potentially null account to undefined for type compatibility with extractTransactionContext
 */
function normalizeAccount(
	account: Account | Address | undefined | null,
): Account | Address | undefined {
	return account === null ? undefined : account;
}

/**
 * Context for transaction tracking - common data extracted from request
 */
interface TransactionContext {
	from: Address;
	intendedNonce: number;
}

/**
 * Parameters we can extract from writeContract/sendTransaction calls.
 * These are the intended values - wallet may modify them.
 */
interface IntendedTransactionParams {
	to?: Address | null;
	value?: bigint;
	data?: `0x${string}`;
	gas?: bigint;
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	accessList?: AccessList;
}

/**
 * Infer transaction type from provided params.
 * Returns undefined if can't be determined (wallet will decide).
 */
function inferTxType(
	params: IntendedTransactionParams,
): 'eip1559' | 'legacy' | 'eip2930' | undefined {
	if (params.maxFeePerGas !== undefined) {
		return 'eip1559';
	}
	if (params.gasPrice !== undefined && params.accessList !== undefined) {
		return 'eip2930';
	}
	if (params.gasPrice !== undefined) {
		return 'legacy';
	}
	return undefined; // Wallet will determine
}

/**
 * Create an UnknownTrackedTransaction for immediate emission.
 * Populates all known intended values from the transaction parameters.
 */
function createUnknownTrackedTransaction<TMetadata>(
	hash: Hash,
	from: Address,
	nonce: number | undefined,
	chainId: number | undefined,
	metadata: TMetadata,
	broadcastTimestampMs: number,
	params: IntendedTransactionParams,
): UnknownTrackedTransaction<TMetadata> {
	const txType = inferTxType(params);
	return {
		known: false,
		chainId,
		hash,
		from,
		nonce,
		broadcastTimestampMs,
		metadata,
		...(txType !== undefined && {txType}),
		...(params.to !== undefined && {to: params.to}),
		...(params.value !== undefined && {value: params.value}),
		...(params.data !== undefined && {data: params.data}),
		...(params.gas !== undefined && {gas: params.gas}),
		...(params.gasPrice !== undefined && {gasPrice: params.gasPrice}),
		...(params.maxFeePerGas !== undefined && {
			maxFeePerGas: params.maxFeePerGas,
		}),
		...(params.maxPriorityFeePerGas !== undefined && {
			maxPriorityFeePerGas: params.maxPriorityFeePerGas,
		}),
		...(params.accessList !== undefined && {accessList: params.accessList}),
	};
}

/**
 * Extract transaction type-specific fields from a fetched transaction.
 */
function extractTransactionTypeFields(tx: Transaction): {
	txType: 'eip1559' | 'legacy' | 'eip2930';
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	accessList?: AccessList;
} {
	if (tx.type === 'eip1559') {
		return {
			txType: 'eip1559',
			maxFeePerGas: tx.maxFeePerGas!,
			maxPriorityFeePerGas: tx.maxPriorityFeePerGas!,
			...(tx.accessList && {accessList: tx.accessList as AccessList}),
		};
	} else if (tx.type === 'eip2930') {
		return {
			txType: 'eip2930',
			gasPrice: tx.gasPrice!,
			accessList: (tx.accessList ?? []) as AccessList,
		};
	} else {
		// Legacy or unknown - treat as legacy
		return {
			txType: 'legacy',
			gasPrice: tx.gasPrice!,
		};
	}
}

/**
 * Create a KnownTrackedTransaction from a fetched transaction.
 */
function createKnownTrackedTransaction<TMetadata>(
	tx: Transaction,
	metadata: TMetadata,
	broadcastTimestampMs: number,
): KnownTrackedTransaction<TMetadata> {
	const typeFields = extractTransactionTypeFields(tx);

	return {
		known: true,
		chainId: tx.chainId!,
		hash: tx.hash,
		from: tx.from,
		to: tx.to,
		nonce: tx.nonce,
		value: tx.value,
		data: tx.input,
		gas: tx.gas,
		broadcastTimestampMs,
		metadata,
		...typeFields,
	} as KnownTrackedTransaction<TMetadata>;
}

/**
 * Create a KnownTrackedTransaction from a parsed raw transaction.
 */
function createKnownTrackedTransactionFromRaw<TMetadata>(
	parsedTx: ParseTransactionReturnType<`0x${string}`>,
	from: `0x${string}`,
	hash: Hash,
	metadata: TMetadata,
	chainId: number | undefined,
	broadcastTimestampMs: number,
): KnownTrackedTransaction<TMetadata> {
	// Determine transaction type from parsed tx
	let typeFields: {
		txType: 'eip1559' | 'legacy' | 'eip2930';
		gasPrice?: bigint;
		maxFeePerGas?: bigint;
		maxPriorityFeePerGas?: bigint;
		accessList?: AccessList;
	};

	if ('maxFeePerGas' in parsedTx && parsedTx.maxFeePerGas !== undefined) {
		typeFields = {
			txType: 'eip1559',
			maxFeePerGas: parsedTx.maxFeePerGas,
			maxPriorityFeePerGas: parsedTx.maxPriorityFeePerGas!,
			...('accessList' in parsedTx &&
				parsedTx.accessList && {
					accessList: parsedTx.accessList as AccessList,
				}),
		};
	} else if ('accessList' in parsedTx && parsedTx.accessList) {
		typeFields = {
			txType: 'eip2930',
			gasPrice: parsedTx.gasPrice!,
			accessList: parsedTx.accessList as AccessList,
		};
	} else {
		typeFields = {
			txType: 'legacy',
			gasPrice: parsedTx.gasPrice!,
		};
	}

	return {
		known: true,
		chainId: parsedTx.chainId ?? chainId!,
		hash,
		from,
		to: parsedTx.to ?? null,
		nonce: parsedTx.nonce!,
		value: parsedTx.value ?? 0n,
		data: parsedTx.data ?? '0x',
		gas: parsedTx.gas!,
		broadcastTimestampMs,
		metadata,
		...typeFields,
	} as KnownTrackedTransaction<TMetadata>;
}

/**
 * Extract intended params from sendTransaction args.
 * Uses 'unknown' for 'to' since viem's SendTransactionParameters has a complex type for it.
 */
function extractIntendedParamsFromSendTransaction(args: {
	to?: unknown;
	value?: bigint;
	data?: `0x${string}`;
	gas?: bigint;
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	accessList?: AccessList;
}): IntendedTransactionParams {
	// Normalize 'to' to either a hex address, null, or undefined
	const to =
		args.to === null || args.to === undefined
			? (args.to as null | undefined)
			: typeof args.to === 'string'
				? (args.to as Address)
				: undefined;

	return {
		to,
		value: args.value ?? 0n,
		data: args.data,
		gas: args.gas,
		gasPrice: args.gasPrice,
		maxFeePerGas: args.maxFeePerGas,
		maxPriorityFeePerGas: args.maxPriorityFeePerGas,
		accessList: args.accessList,
	};
}

/**
 * Extract intended params from writeContract args.
 */
function extractIntendedParamsFromWriteContract(args: {
	address: Address;
	value?: bigint;
	gas?: bigint;
	gasPrice?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
	accessList?: AccessList;
}): IntendedTransactionParams {
	return {
		to: args.address,
		value: args.value ?? 0n,
		// Note: data could be encoded using encodeFunctionData(args) if desired
		gas: args.gas,
		gasPrice: args.gasPrice,
		maxFeePerGas: args.maxFeePerGas,
		maxPriorityFeePerGas: args.maxPriorityFeePerGas,
		accessList: args.accessList,
	};
}

/**
 * Infer transport type from WalletClient
 */
type InferTransport<T> =
	T extends WalletClient<infer TTransport, any, any> ? TTransport : Transport;

/**
 * Infer chain type from WalletClient
 */
type InferChain<T> =
	T extends WalletClient<any, infer TChain, any> ? TChain : Chain | undefined;

/**
 * Infer account type from WalletClient
 */
type InferAccount<T> =
	T extends WalletClient<any, any, infer TAccount>
		? TAccount
		: Account | undefined;

/**
 * Builder interface returned by createTrackedWalletClient for the curried API.
 */
export interface TrackedWalletClientBuilder<TMetadata> {
	/**
	 * Create the tracked wallet client using the provided wallet and public clients.
	 *
	 * @param walletClient - The underlying viem WalletClient
	 * @param publicClient - A PublicClient for nonce fetching and tx verification
	 * @returns A TrackedWalletClient instance
	 */
	using<TClient extends WalletClient>(
		walletClient: TClient,
		publicClient: PublicClient,
	): TrackedWalletClient<
		TMetadata,
		InferTransport<TClient>,
		InferChain<TClient>,
		InferAccount<TClient>
	>;
}

/**
 * Builder interface returned by createTrackedWalletClient with populateMetadata: true.
 * This builder returns a TrackedWalletClientAutoPopulate that auto-populates operation, functionName and args.
 * TMetadata must be a type where FunctionCallMetadata is assignable to it.
 */
export interface TrackedWalletClientAutoPopulateBuilder<TMetadata> {
	/**
	 * Create the tracked wallet client using the provided wallet and public clients.
	 * writeContract and writeContractSync will automatically populate operation, functionName and args.
	 *
	 * @param walletClient - The underlying viem WalletClient
	 * @param publicClient - A PublicClient for nonce fetching and tx verification
	 * @returns A TrackedWalletClientAutoPopulate instance
	 */
	using<TClient extends WalletClient>(
		walletClient: TClient,
		publicClient: PublicClient,
	): TrackedWalletClientAutoPopulate<
		TMetadata,
		InferTransport<TClient>,
		InferChain<TClient>,
		InferAccount<TClient>
	>;
}

/**
 * Create a tracked wallet client that wraps a viem WalletClient.
 *
 * The tracked client provides the same API as WalletClient but with:
 * - Metadata field for transaction tracking (required unless TMetadata includes undefined)
 * - Automatic nonce fetching (with 'pending' by default)
 * - Post-broadcast transaction verification
 * - Event emission for tracking
 *
 * @typeParam TMetadata - The metadata type. Use `MyMeta | undefined` to make metadata optional.
 * @returns A builder with a `.using()` method to provide the wallet and public clients
 *
 * @example
 * ```typescript
 * // Standard mode with required metadata
 * const tracked = createTrackedWalletClient<{purpose: string}>()
 *   .using(walletClient, publicClient);
 *
 * // Standard mode with optional metadata
 * const tracked = createTrackedWalletClient<{purpose: string} | undefined>()
 *   .using(walletClient, publicClient);
 *
 * // Auto-populate mode - functionName and args are auto-populated
 * const tracked = createTrackedWalletClient({ populateMetadata: true })
 *   .using(walletClient, publicClient);
 *
 * // Auto-populate mode with extended metadata
 * type MyMetadata = OperationMetadata & { purpose: string };
 * const tracked = createTrackedWalletClient<MyMetadata>({ populateMetadata: true })
 *   .using(walletClient, publicClient);
 * ```
 */
// Overload 1: Standard mode, no options
export function createTrackedWalletClient<
	TMetadata,
>(): TrackedWalletClientBuilder<TMetadata>;

// Overload 2: Auto-populate mode with default PopulatedMetadata
export function createTrackedWalletClient(options: {
	populateMetadata: true;
}): TrackedWalletClientAutoPopulateBuilder<PopulatedMetadata>;

// Overload 3: Auto-populate mode with custom metadata (must allow FunctionCallMetadata)
export function createTrackedWalletClient<TMetadata>(options: {
	populateMetadata: true;
}): TrackedWalletClientAutoPopulateBuilder<TMetadata>;

// Implementation
export function createTrackedWalletClient<TMetadata>(
	options?: CreateTrackedWalletClientOptions<boolean>,
):
	| TrackedWalletClientBuilder<TMetadata>
	| TrackedWalletClientAutoPopulateBuilder<TMetadata> {
	const populateMetadata = options?.populateMetadata ?? false;
	const clock = options?.clock ?? Date.now;

	if (populateMetadata) {
		return createAutoPopulateBuilder<TMetadata>(
			clock,
		) as TrackedWalletClientAutoPopulateBuilder<TMetadata>;
	}

	return {
		using<TClient extends WalletClient>(
			walletClient: TClient,
			publicClient: PublicClient,
		): TrackedWalletClient<
			TMetadata,
			InferTransport<TClient>,
			InferChain<TClient>,
			InferAccount<TClient>
		> {
			// Type aliases for internal use
			type TTransport = InferTransport<TClient>;
			type TChain = InferChain<TClient>;
			type TAccount = InferAccount<TClient>;

			// Create emitter for transaction events
			const emitter = new Emitter<{
				'transaction:broadcasted': TrackedTransaction<TMetadata>;
				'transaction:fetched': KnownTrackedTransaction<TMetadata>;
			}>();

			/**
			 * Resolve the nonce to use for a transaction.
			 *
			 * @param nonceOption - The nonce option provided by the caller
			 * @param from - The sender address
			 * @returns The resolved nonce number
			 */
			async function resolveNonce(
				nonceOption: NonceOption | undefined,
				from: Address,
			): Promise<number> {
				if (typeof nonceOption === 'number') {
					// Explicit number - use as-is
					return nonceOption;
				}

				// Block tag (string) or undefined - fetch from chain
				const blockTag = isBlockTag(nonceOption) ? nonceOption : 'pending';
				return await publicClient.getTransactionCount({
					address: from,
					blockTag,
				});
			}

			/**
			 * Extract common transaction context (account, nonce) from request args.
			 * This is the shared logic between all transaction methods.
			 *
			 * @param args - The transaction args containing account and nonce options
			 * @returns TransactionContext with resolved from address and nonce
			 */
			async function extractTransactionContext(args: {
				account?: Account | Address;
				nonce?: NonceOption;
			}): Promise<TransactionContext> {
				// Get account/from address
				const account = args.account ?? walletClient.account;
				const from = resolveAccountAddress(account);

				if (!from) {
					throw new Error(
						'[TrackedWalletClient] No account available. ' +
							'Provide an account in the request or configure the wallet client with an account.',
					);
				}

				// Resolve nonce
				const intendedNonce = await resolveNonce(args.nonce, from);

				return {from, intendedNonce};
			}

			/**
			 * Fetch full transaction data and emit transaction:fetched event.
			 * Non-blocking, runs in background. Does not throw.
			 */
			async function fetchAndEmitFullData(
				hash: Hash,
				metadata: TMetadata,
				broadcastTimestampMs: number,
			): Promise<void> {
				try {
					const tx = await publicClient.getTransaction({hash});
					const knownTx = createKnownTrackedTransaction(
						tx,
						metadata,
						broadcastTimestampMs,
					);
					emitter.emit('transaction:fetched', knownTx);
				} catch (error) {
					// Log but don't throw - transaction:fetched simply won't fire
					console.warn(
						`[TrackedWalletClient] Could not fetch tx ${hash}. ` +
							`transaction:fetched event will not be emitted. Error: ${error}`,
					);
				}
			}

			/**
			 * Common wrapper for transaction methods that broadcast (sendTransaction, writeContract).
			 * Emits transaction:broadcasted immediately with intended values,
			 * then fetches and emits transaction:fetched with actual values.
			 */
			async function executeTrackedTransaction<T, R>(args: {
				account?: Account | Address;
				nonce?: NonceOption;
				metadata: TMetadata;
				restArgs: T;
				intendedParams: IntendedTransactionParams;
				execute: (argsWithNonce: T & {nonce: number}) => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {metadata, restArgs, intendedParams, execute, extractHash} = args;
				const broadcastTimestampMs = clock();

				// Extract common context
				const {from, intendedNonce} = await extractTransactionContext(args);

				// Execute the underlying transaction with nonce injected
				const result = await execute({
					...restArgs,
					nonce: intendedNonce,
				} as T & {
					nonce: number;
				});
				const hash = extractHash(result);

				// Emit transaction:broadcasted immediately with intended values
				const unknownTx = createUnknownTrackedTransaction(
					hash,
					from,
					intendedNonce,
					walletClient.chain?.id,
					metadata,
					broadcastTimestampMs,
					intendedParams,
				);
				emitter.emit('transaction:broadcasted', unknownTx);

				// Fire-and-forget: fetch full data and emit transaction:fetched
				fetchAndEmitFullData(hash, metadata, broadcastTimestampMs);

				return result;
			}

			/**
			 * Common wrapper for raw transaction broadcasts (sendRawTransaction).
			 * For raw transactions, we can parse full data immediately.
			 * Emits KnownTrackedTransaction directly to transaction:broadcasted.
			 */
			async function executeTrackedRawTransaction<R>(args: {
				serializedTransaction: TransactionSerialized;
				metadata: TMetadata;
				execute: () => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {serializedTransaction, metadata, execute, extractHash} = args;
				const broadcastTimestampMs = clock();

				const from = await recoverTransactionAddress({serializedTransaction});

				const parsedTx = parseTransaction(serializedTransaction);

				// Execute the broadcast
				const result = await execute();
				const hash = extractHash(result);

				// For raw transactions, we can parse full data immediately
				const knownTx = createKnownTrackedTransactionFromRaw(
					parsedTx,
					from,
					hash,
					metadata,
					walletClient.chain?.id,
					broadcastTimestampMs,
				);

				// Emit as KnownTrackedTransaction since we have all data
				emitter.emit('transaction:broadcasted', knownTx);

				// Also emit to transaction:fetched for consistency
				emitter.emit('transaction:fetched', knownTx);

				return result;
			}

			return {
				walletClient: walletClient as unknown as WalletClient<
					TTransport,
					TChain,
					TAccount
				>,
				publicClient,

				// ============================================
				// Async methods (return hash)
				// ============================================

				async writeContract<
					const TAbi extends Abi | readonly unknown[],
					TFunctionName extends ContractFunctionName<
						TAbi,
						'nonpayable' | 'payable'
					>,
					TArgs extends ContractFunctionArgs<
						TAbi,
						'nonpayable' | 'payable',
						TFunctionName
					>,
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedWriteContractParameters<
						TMetadata,
						TAbi,
						TFunctionName,
						TArgs,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<Hash> {
					const {metadata, nonce, ...writeArgs} = args;
					const intendedParams = extractIntendedParamsFromWriteContract(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: writeArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.writeContract(argsWithNonce as any),
						extractHash: (hash) => hash,
					});
				},

				async sendTransaction<
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedSendTransactionParameters<
						TMetadata,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<Hash> {
					const {metadata, nonce, ...sendArgs} = args;
					const intendedParams = extractIntendedParamsFromSendTransaction(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.sendTransaction(argsWithNonce as any),
						extractHash: (hash) => hash,
					});
				},

				async sendRawTransaction(
					args: TrackedRawTransactionParameters<TMetadata>,
				): Promise<Hash> {
					const {metadata, serializedTransaction} = args;

					return executeTrackedRawTransaction({
						serializedTransaction,
						metadata: metadata as TMetadata,
						execute: () =>
							walletClient.sendRawTransaction({serializedTransaction}),
						extractHash: (hash) => hash,
					});
				},

				// ============================================
				// Sync methods (return receipt, wait for confirmation)
				// ============================================

				async writeContractSync<
					const TAbi extends Abi | readonly unknown[],
					TFunctionName extends ContractFunctionName<
						TAbi,
						'nonpayable' | 'payable'
					>,
					TArgs extends ContractFunctionArgs<
						TAbi,
						'nonpayable' | 'payable',
						TFunctionName
					>,
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedWriteContractParameters<
						TMetadata,
						TAbi,
						TFunctionName,
						TArgs,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<TransactionReceipt> {
					const {metadata, nonce, ...writeArgs} = args;
					const intendedParams = extractIntendedParamsFromWriteContract(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: writeArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.writeContractSync(argsWithNonce as any),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				async sendTransactionSync<
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedSendTransactionParameters<
						TMetadata,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<TransactionReceipt> {
					const {metadata, nonce, ...sendArgs} = args;
					const intendedParams = extractIntendedParamsFromSendTransaction(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.sendTransactionSync(argsWithNonce as any),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				async sendRawTransactionSync(
					args: TrackedRawTransactionParameters<TMetadata>,
				): Promise<TransactionReceipt> {
					const {metadata, serializedTransaction} = args;

					return executeTrackedRawTransaction({
						serializedTransaction,
						metadata: metadata as TMetadata,
						execute: () =>
							walletClient.sendRawTransactionSync({serializedTransaction}),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				// ============================================
				// Event subscription methods
				// ============================================

				on: emitter.on.bind(emitter),
				off: emitter.off.bind(emitter),
			};
		},
	};
}

/**
 * Create an auto-populate builder for TrackedWalletClient.
 * This builder auto-populates operation, functionName and args in writeContract metadata.
 */
function createAutoPopulateBuilder<TMetadata>(
	clock: () => number,
): TrackedWalletClientAutoPopulateBuilder<TMetadata> {
	return {
		using<TClient extends WalletClient>(
			walletClient: TClient,
			publicClient: PublicClient,
		): TrackedWalletClientAutoPopulate<
			TMetadata,
			InferTransport<TClient>,
			InferChain<TClient>,
			InferAccount<TClient>
		> {
			// Type aliases for internal use
			type TTransport = InferTransport<TClient>;
			type TChain = InferChain<TClient>;
			type TAccount = InferAccount<TClient>;

			// Create emitter for transaction events
			const emitter = new Emitter<{
				'transaction:broadcasted': TrackedTransaction<TMetadata>;
				'transaction:fetched': KnownTrackedTransaction<TMetadata>;
			}>();

			/**
			 * Resolve the nonce to use for a transaction.
			 */
			async function resolveNonce(
				nonceOption: NonceOption | undefined,
				from: Address,
			): Promise<number> {
				if (typeof nonceOption === 'number') {
					return nonceOption;
				}
				const blockTag = isBlockTag(nonceOption) ? nonceOption : 'pending';
				return await publicClient.getTransactionCount({
					address: from,
					blockTag,
				});
			}

			/**
			 * Extract common transaction context (account, nonce) from request args.
			 */
			async function extractTransactionContext(args: {
				account?: Account | Address;
				nonce?: NonceOption;
			}): Promise<TransactionContext> {
				const account = args.account ?? walletClient.account;
				const from = resolveAccountAddress(account);

				if (!from) {
					throw new Error(
						'[TrackedWalletClient] No account available. ' +
							'Provide an account in the request or configure the wallet client with an account.',
					);
				}

				const intendedNonce = await resolveNonce(args.nonce, from);
				return {from, intendedNonce};
			}

			/**
			 * Fetch full transaction data and emit transaction:fetched event.
			 * Non-blocking, runs in background. Does not throw.
			 */
			async function fetchAndEmitFullData(
				hash: Hash,
				metadata: TMetadata,
				broadcastTimestampMs: number,
			): Promise<void> {
				try {
					const tx = await publicClient.getTransaction({hash});
					const knownTx = createKnownTrackedTransaction(
						tx,
						metadata,
						broadcastTimestampMs,
					);
					emitter.emit('transaction:fetched', knownTx);
				} catch (error) {
					// Log but don't throw - transaction:fetched simply won't fire
					console.warn(
						`[TrackedWalletClient] Could not fetch tx ${hash}. ` +
							`transaction:fetched event will not be emitted. Error: ${error}`,
					);
				}
			}

			/**
			 * Validate that user didn't provide operation, functionName or args in metadata
			 * when populateMetadata is enabled.
			 */
			function validateNoAutoPopulatedFieldsInMetadata(
				userMetadata: unknown,
			): void {
				if (userMetadata && typeof userMetadata === 'object') {
					if ('type' in userMetadata) {
						throw new Error(
							'[TrackedWalletClient] Cannot specify type in metadata when populateMetadata is enabled. ' +
								'The type is automatically populated from the contract call.',
						);
					}
					if ('functionName' in userMetadata) {
						throw new Error(
							'[TrackedWalletClient] Cannot specify functionName in metadata when populateMetadata is enabled. ' +
								'The functionName is automatically populated from the contract call.',
						);
					}
					if ('args' in userMetadata) {
						throw new Error(
							'[TrackedWalletClient] Cannot specify args in metadata when populateMetadata is enabled. ' +
								'The args are automatically populated from the contract call.',
						);
					}
				}
			}

			/**
			 * Common wrapper for transaction methods that broadcast.
			 * Emits transaction:broadcasted immediately with intended values,
			 * then fetches and emits transaction:fetched with actual values.
			 */
			async function executeTrackedTransaction<T, R>(args: {
				account?: Account | Address;
				nonce?: NonceOption;
				metadata: TMetadata;
				restArgs: T;
				intendedParams: IntendedTransactionParams;
				execute: (argsWithNonce: T & {nonce: number}) => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {metadata, restArgs, intendedParams, execute, extractHash} = args;
				const broadcastTimestampMs = clock();

				const {from, intendedNonce} = await extractTransactionContext(args);

				const result = await execute({
					...restArgs,
					nonce: intendedNonce,
				} as T & {
					nonce: number;
				});
				const hash = extractHash(result);

				// Emit transaction:broadcasted immediately with intended values
				const unknownTx = createUnknownTrackedTransaction(
					hash,
					from,
					intendedNonce,
					walletClient.chain?.id,
					metadata,
					broadcastTimestampMs,
					intendedParams,
				);
				emitter.emit('transaction:broadcasted', unknownTx);

				// Fire-and-forget: fetch full data and emit transaction:fetched
				fetchAndEmitFullData(hash, metadata, broadcastTimestampMs);

				return result;
			}

			/**
			 * Common wrapper for raw transaction broadcasts.
			 * For raw transactions, we can parse full data immediately.
			 * Emits KnownTrackedTransaction directly to transaction:broadcasted.
			 */
			async function executeTrackedRawTransaction<R>(args: {
				serializedTransaction: TransactionSerialized;
				metadata: TMetadata;
				execute: () => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {serializedTransaction, metadata, execute, extractHash} = args;
				const broadcastTimestampMs = clock();

				const from = await recoverTransactionAddress({serializedTransaction});
				const parsedTx = parseTransaction(serializedTransaction);

				// Execute the broadcast
				const result = await execute();
				const hash = extractHash(result);

				// For raw transactions, we can parse full data immediately
				const knownTx = createKnownTrackedTransactionFromRaw(
					parsedTx,
					from,
					hash,
					metadata,
					walletClient.chain?.id,
					broadcastTimestampMs,
				);

				// Emit as KnownTrackedTransaction since we have all data
				emitter.emit('transaction:broadcasted', knownTx);

				// We do not emit fetched as the tx is already known

				return result;
			}

			return {
				walletClient: walletClient as unknown as WalletClient<
					TTransport,
					TChain,
					TAccount
				>,
				publicClient,

				// ============================================
				// Async methods (return hash)
				// ============================================

				async writeContract<
					const TAbi extends Abi | readonly unknown[],
					TFunctionName extends ContractFunctionName<
						TAbi,
						'nonpayable' | 'payable'
					>,
					TArgs extends ContractFunctionArgs<
						TAbi,
						'nonpayable' | 'payable',
						TFunctionName
					>,
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedWriteContractAutoPopulateParameters<
						TMetadata,
						TAbi,
						TFunctionName,
						TArgs,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<Hash> {
					const {metadata: userMetadata, nonce, ...writeArgs} = args;

					// Validate that user didn't provide operation, functionName or args
					validateNoAutoPopulatedFieldsInMetadata(userMetadata);

					// Auto-populate type, functionName and args
					const finalMetadata = {
						...(userMetadata ?? {}),
						type: 'functionCall' as const,
						functionName: args.functionName as string,
						args: args.args as readonly unknown[],
					} as TMetadata;

					const intendedParams = extractIntendedParamsFromWriteContract(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: finalMetadata,
						restArgs: writeArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.writeContract(argsWithNonce as any),
						extractHash: (hash) => hash,
					});
				},

				async sendTransaction<
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedSendTransactionParameters<
						TMetadata,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<Hash> {
					const {metadata, nonce, ...sendArgs} = args;
					const intendedParams = extractIntendedParamsFromSendTransaction(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.sendTransaction(argsWithNonce as any),
						extractHash: (hash) => hash,
					});
				},

				async sendRawTransaction(
					args: TrackedRawTransactionParameters<TMetadata>,
				): Promise<Hash> {
					const {metadata, serializedTransaction} = args;

					return executeTrackedRawTransaction({
						serializedTransaction,
						metadata: metadata as TMetadata,
						execute: () =>
							walletClient.sendRawTransaction({serializedTransaction}),
						extractHash: (hash) => hash,
					});
				},

				// ============================================
				// Sync methods (return receipt, wait for confirmation)
				// ============================================

				async writeContractSync<
					const TAbi extends Abi | readonly unknown[],
					TFunctionName extends ContractFunctionName<
						TAbi,
						'nonpayable' | 'payable'
					>,
					TArgs extends ContractFunctionArgs<
						TAbi,
						'nonpayable' | 'payable',
						TFunctionName
					>,
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedWriteContractAutoPopulateParameters<
						TMetadata,
						TAbi,
						TFunctionName,
						TArgs,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<TransactionReceipt> {
					const {metadata: userMetadata, nonce, ...writeArgs} = args;

					// Validate that user didn't provide operation, functionName or args
					validateNoAutoPopulatedFieldsInMetadata(userMetadata);

					// Auto-populate type, functionName and args
					const finalMetadata = {
						...(userMetadata ?? {}),
						type: 'functionCall' as const,
						functionName: args.functionName as string,
						args: args.args as readonly unknown[],
					} as TMetadata;

					const intendedParams = extractIntendedParamsFromWriteContract(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: finalMetadata,
						restArgs: writeArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.writeContractSync(argsWithNonce as any),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				async sendTransactionSync<
					TChainOverride extends Chain | undefined = undefined,
				>(
					args: TrackedSendTransactionParameters<
						TMetadata,
						TChain,
						TAccount,
						TChainOverride
					>,
				): Promise<TransactionReceipt> {
					const {metadata, nonce, ...sendArgs} = args;
					const intendedParams = extractIntendedParamsFromSendTransaction(args);

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
						intendedParams,
						execute: (argsWithNonce) =>
							walletClient.sendTransactionSync(argsWithNonce as any),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				async sendRawTransactionSync(
					args: TrackedRawTransactionParameters<TMetadata>,
				): Promise<TransactionReceipt> {
					const {metadata, serializedTransaction} = args;

					return executeTrackedRawTransaction({
						serializedTransaction,
						metadata: metadata as TMetadata,
						execute: () =>
							walletClient.sendRawTransactionSync({serializedTransaction}),
						extractHash: (receipt) => receipt.transactionHash,
					});
				},

				// ============================================
				// Event subscription methods
				// ============================================

				on: emitter.on.bind(emitter),
				off: emitter.off.bind(emitter),
			};
		},
	};
}
