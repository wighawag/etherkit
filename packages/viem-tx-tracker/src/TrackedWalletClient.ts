import {
	parseTransaction,
	recoverTransactionAddress,
	type Abi,
	type Account,
	type Address,
	type Chain,
	type ContractFunctionArgs,
	type ContractFunctionName,
	type Hash,
	type PublicClient,
	type TransactionReceipt,
	type TransactionSerialized,
	type Transport,
	type WalletClient,
} from 'viem';
import {Emitter} from 'radiate';
import type {
	BlockTag,
	CreateTrackedWalletClientOptions,
	NonceOption,
	PopulatedMetadata,
	TrackedRawTransactionParameters,
	TrackedSendTransactionParameters,
	TrackedTransaction,
	TrackedWalletClient,
	TrackedWalletClientAutoPopulate,
	TrackedWriteContractAutoPopulateParameters,
	TrackedWriteContractParameters,
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
 * Generate a unique tracking ID if not provided in metadata
 */
function generateTrackingId(): string {
	return crypto.randomUUID();
}

/**
 * Context for transaction tracking - common data extracted from request
 */
interface TransactionContext {
	from: Address;
	intendedNonce: number;
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

	if (populateMetadata) {
		return createAutoPopulateBuilder<TMetadata>() as TrackedWalletClientAutoPopulateBuilder<TMetadata>;
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

			// Create emitter for transaction broadcast events
			const emitter = new Emitter<{
				'transaction:broadcasted': TrackedTransaction<TMetadata>;
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
			 * Extract transaction context from a serialized (signed) transaction.
			 * Parses the transaction and recovers the sender address.
			 *
			 * @param serializedTransaction - The RLP-encoded signed transaction
			 * @returns TransactionContext with from address and nonce
			 */
			async function extractRawTransactionContext(
				serializedTransaction: TransactionSerialized,
			): Promise<TransactionContext> {
				// Parse the serialized transaction to get the nonce
				const parsedTx = parseTransaction(serializedTransaction);

				if (parsedTx.nonce === undefined) {
					throw new Error(
						'[TrackedWalletClient] Could not extract nonce from serialized transaction.',
					);
				}

				// Recover the sender address from the signature
				const from = await recoverTransactionAddress({
					serializedTransaction,
				});

				return {
					from,
					intendedNonce: parsedTx.nonce,
				};
			}

			/**
			 * Fetch the transaction after broadcast to verify nonce.
			 * Logs a warning if the nonce was overridden or if tx cannot be found.
			 *
			 * @param hash - The transaction hash
			 * @param intendedNonce - The nonce we intended to use
			 * @returns The actual nonce, or the intended nonce if fetch failed
			 */
			async function verifyTransactionNonce(
				hash: Hash,
				intendedNonce: number,
			): Promise<number> {
				try {
					const tx = await publicClient.getTransaction({hash});
					const actualNonce = tx.nonce;

					if (actualNonce !== intendedNonce) {
						console.warn(
							`[TrackedWalletClient] Nonce mismatch: intended ${intendedNonce}, actual ${actualNonce}. ` +
								`Wallet may have overridden the nonce.`,
						);
					}

					return actualNonce;
				} catch (fetchError) {
					// Transaction not found in mempool/chain yet
					console.warn(
						`[TrackedWalletClient] Could not fetch tx ${hash} after broadcast. ` +
							`It may not be in the mempool yet.`,
					);
					return intendedNonce;
				}
			}

			/**
			 * Create a tracked transaction record.
			 */
			function createTrackedTransactionRecord(
				txHash: Hash,
				from: Address,
				nonce: number,
				metadata: TMetadata,
			): TrackedTransaction<TMetadata> {
				return {
					hash: txHash,
					from,
					nonce,
					chainId: walletClient.chain?.id,
					metadata,
					broadcastTimestampMs: Date.now(),
				};
			}

			/**
			 * Common wrapper for transaction methods that broadcast (sendTransaction, writeContract).
			 * Handles nonce resolution, underlying call, post-broadcast verification, and tracking record creation.
			 */
			async function executeTrackedTransaction<T, R>(args: {
				account?: Account | Address;
				nonce?: NonceOption;
				metadata: TMetadata;
				restArgs: T;
				execute: (argsWithNonce: T & {nonce: number}) => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {metadata, restArgs, execute, extractHash} = args;

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

				// Verify transaction and get actual nonce
				const actualNonce = await verifyTransactionNonce(hash, intendedNonce);

				// Create tracked transaction record
				const trackedTx = createTrackedTransactionRecord(
					hash,
					from,
					actualNonce,
					metadata,
				);

				// Emit transaction broadcasted event
				emitter.emit('transaction:broadcasted', trackedTx);

				return result;
			}

			/**
			 * Common wrapper for raw transaction broadcasts (sendRawTransaction).
			 * Decodes the transaction to extract from/nonce, broadcasts, and creates tracking record.
			 */
			async function executeTrackedRawTransaction<R>(args: {
				serializedTransaction: TransactionSerialized;
				metadata: TMetadata;
				execute: () => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {serializedTransaction, metadata, execute, extractHash} = args;

				// Extract context from the serialized transaction
				const {from, intendedNonce} = await extractRawTransactionContext(
					serializedTransaction,
				);

				// Execute the broadcast
				const result = await execute();
				const hash = extractHash(result);

				// For raw transactions, the nonce is already embedded, so no verification needed
				// (wallet cannot override nonce in an already-signed transaction)

				// Create tracked transaction record
				const trackedTx = createTrackedTransactionRecord(
					hash,
					from,
					intendedNonce,
					metadata,
				);

				// Emit transaction broadcasted event
				emitter.emit('transaction:broadcasted', trackedTx);

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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: writeArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: writeArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
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

				onTransactionBroadcasted: (
					listener: (event: TrackedTransaction<TMetadata>) => void,
				) => emitter.on('transaction:broadcasted', listener),

				offTransactionBroadcasted: (
					listener: (event: TrackedTransaction<TMetadata>) => void,
				) => emitter.off('transaction:broadcasted', listener),
			};
		},
	};
}

/**
 * Create an auto-populate builder for TrackedWalletClient.
 * This builder auto-populates operation, functionName and args in writeContract metadata.
 */
function createAutoPopulateBuilder<
	TMetadata,
>(): TrackedWalletClientAutoPopulateBuilder<TMetadata> {
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

			// Create emitter for transaction broadcast events
			const emitter = new Emitter<{
				'transaction:broadcasted': TrackedTransaction<TMetadata>;
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
			 * Extract transaction context from a serialized (signed) transaction.
			 */
			async function extractRawTransactionContext(
				serializedTransaction: TransactionSerialized,
			): Promise<TransactionContext> {
				const parsedTx = parseTransaction(serializedTransaction);

				if (parsedTx.nonce === undefined) {
					throw new Error(
						'[TrackedWalletClient] Could not extract nonce from serialized transaction.',
					);
				}

				const from = await recoverTransactionAddress({
					serializedTransaction,
				});

				return {
					from,
					intendedNonce: parsedTx.nonce,
				};
			}

			/**
			 * Fetch the transaction after broadcast to verify nonce.
			 */
			async function verifyTransactionNonce(
				hash: Hash,
				intendedNonce: number,
			): Promise<number> {
				try {
					const tx = await publicClient.getTransaction({hash});
					const actualNonce = tx.nonce;

					if (actualNonce !== intendedNonce) {
						console.warn(
							`[TrackedWalletClient] Nonce mismatch: intended ${intendedNonce}, actual ${actualNonce}. ` +
								`Wallet may have overridden the nonce.`,
						);
					}

					return actualNonce;
				} catch (fetchError) {
					console.warn(
						`[TrackedWalletClient] Could not fetch tx ${hash} after broadcast. ` +
							`It may not be in the mempool yet.`,
					);
					return intendedNonce;
				}
			}

			/**
			 * Create a tracked transaction record.
			 */
			function createTrackedTransactionRecord(
				txHash: Hash,
				from: Address,
				nonce: number,
				metadata: TMetadata,
			): TrackedTransaction<TMetadata> {
				return {
					hash: txHash,
					from,
					nonce,
					chainId: walletClient.chain?.id,
					metadata,
					broadcastTimestampMs: Date.now(),
				};
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
			 */
			async function executeTrackedTransaction<T, R>(args: {
				account?: Account | Address;
				nonce?: NonceOption;
				metadata: TMetadata;
				restArgs: T;
				execute: (argsWithNonce: T & {nonce: number}) => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {metadata, restArgs, execute, extractHash} = args;

				const {from, intendedNonce} = await extractTransactionContext(args);

				const result = await execute({
					...restArgs,
					nonce: intendedNonce,
				} as T & {
					nonce: number;
				});
				const hash = extractHash(result);

				const actualNonce = await verifyTransactionNonce(hash, intendedNonce);

				const trackedTx = createTrackedTransactionRecord(
					hash,
					from,
					actualNonce,
					metadata,
				);

				emitter.emit('transaction:broadcasted', trackedTx);

				return result;
			}

			/**
			 * Common wrapper for raw transaction broadcasts.
			 */
			async function executeTrackedRawTransaction<R>(args: {
				serializedTransaction: TransactionSerialized;
				metadata: TMetadata;
				execute: () => Promise<R>;
				extractHash: (result: R) => Hash;
			}): Promise<R> {
				const {serializedTransaction, metadata, execute, extractHash} = args;

				const {from, intendedNonce} = await extractRawTransactionContext(
					serializedTransaction,
				);

				const result = await execute();
				const hash = extractHash(result);

				const trackedTx = createTrackedTransactionRecord(
					hash,
					from,
					intendedNonce,
					metadata,
				);

				emitter.emit('transaction:broadcasted', trackedTx);

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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: finalMetadata,
						restArgs: writeArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: finalMetadata,
						restArgs: writeArgs,
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

					return executeTrackedTransaction({
						account: normalizeAccount(args.account),
						nonce,
						metadata: metadata as TMetadata,
						restArgs: sendArgs,
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

				onTransactionBroadcasted: (
					listener: (event: TrackedTransaction<TMetadata>) => void,
				) => emitter.on('transaction:broadcasted', listener),

				offTransactionBroadcasted: (
					listener: (event: TrackedTransaction<TMetadata>) => void,
				) => emitter.off('transaction:broadcasted', listener),
			};
		},
	};
}
