import type {
	Abi,
	Account,
	Address,
	Chain,
	ContractFunctionArgs,
	ContractFunctionName,
	Hash,
	PublicClient,
	SendTransactionParameters,
	TransactionReceipt,
	TransactionSerialized,
	Transport,
	WalletClient,
	WriteContractParameters,
} from 'viem';

/**
 * Metadata for contract function calls.
 * Auto-populated by writeContract when populateMetadata: true.
 */
export type FunctionCallMetadata = {
	type: 'functionCall';
	functionName: string;
	args?: readonly unknown[];
};

/**
 * Metadata for unknown/untyped operations.
 * Used as a fallback for sendTransaction/sendRawTransaction
 * when using the default PopulatedMetadata type.
 */
export type UnknownTypeMetadata = {
	type: 'unknown';
	name: string;
	data: any[];
};

/**
 * Default metadata type when using populateMetadata: true.
 * A discriminated union that allows either:
 * - FunctionCallMetadata (auto-populated by writeContract)
 * - UnknownTypeMetadata (for sendTransaction/sendRawTransaction)
 *
 * Users can provide their own TMetadata type that excludes 'unknown'
 * if they want to enforce specific operation types.
 */
export type PopulatedMetadata = FunctionCallMetadata | UnknownTypeMetadata;

/**
 * Options for creating a tracked wallet client.
 */
export interface CreateTrackedWalletClientOptions<
	TPopulate extends boolean = false,
> {
	/**
	 * When true, writeContract and writeContractSync automatically populate
	 * operation, functionName and args in the metadata from the contract call parameters.
	 * TMetadata must be a type where FunctionCallMetadata is assignable to it
	 * (e.g., PopulatedMetadata, FunctionCallMetadata, or a union including FunctionCallMetadata).
	 */
	populateMetadata?: TPopulate;
	/**
	 * A clock function that returns the current time in milliseconds.
	 * Defaults to Date.now.
	 */
	clock?: () => number;
}

/**
 * Block tags that can be used to specify nonce fetching strategy
 */
export type BlockTag = 'latest' | 'pending' | 'earliest' | 'safe' | 'finalized';

/**
 * Nonce can be:
 * - number: exact nonce to use
 * - BlockTag: fetch nonce using this block tag
 * - undefined: fetch nonce using 'pending' (default)
 */
export type NonceOption = number | BlockTag;

/**
 * Conditional type that makes metadata required or optional based on TMetadata.
 * If TMetadata includes undefined (e.g., `MyMeta | undefined`), metadata is optional.
 * Otherwise, metadata is required.
 */
export type MetadataField<TMetadata> = undefined extends TMetadata
	? {metadata?: TMetadata}
	: {metadata: TMetadata};

/**
 * Access list type used in EIP-2930 and EIP-1559 transactions.
 */
export type AccessList = readonly {
	address: Address;
	storageKeys: readonly `0x${string}`[];
}[];

/**
 * Gas parameters for UnknownTrackedTransaction.
 * All fields are optional - we provide what we have,
 * but the wallet may modify or fill in missing values.
 */
export type IntendedGasParameters = {
	readonly gas?: bigint;
	readonly gasPrice?: bigint;
	readonly maxFeePerGas?: bigint;
	readonly maxPriorityFeePerGas?: bigint;
};

/**
 * Common fields for all tracked transactions.
 * All field paths are stable - you can always access tx.field
 */
type CommonTrackedFields<TMetadata> = {
	readonly hash: `0x${string}`;
	readonly from: `0x${string}`;
	readonly broadcastTimestampMs: number;
	readonly metadata: TMetadata;
	readonly to: `0x${string}` | null;
	readonly value: bigint;
	readonly data: `0x${string}`;
	readonly nonce: number;
};

/**
 * A fully known tracked transaction with all fields confirmed from chain.
 * Emitted via transaction:fetched when tx data is fetched from chain,
 * or immediately for sendRawTransaction where we can parse the tx.
 *
 * When known=true, all values are the actual confirmed values used by the chain.
 * Uses discriminated union by txType to enforce correct field combinations.
 * - txType at top level (stable path)
 * - accessList at top level, presence depends on txType
 * - gasParameters at top level with txType-specific fields
 */
export type KnownTrackedTransaction<TMetadata> =
	CommonTrackedFields<TMetadata> & {
		readonly known: true;
	} & (
			| {
					readonly txType: 'eip1559';
					readonly chainId: number;
					readonly accessList?: AccessList;
					readonly gasParameters: {
						readonly gas: bigint;
						readonly maxFeePerGas: bigint;
						readonly maxPriorityFeePerGas: bigint;
					};
			  }
			| {
					readonly txType: 'legacy';
					readonly chainId?: number;
					// accessList not available for legacy
					readonly gasParameters: {
						readonly gas: bigint;
						readonly gasPrice: bigint;
					};
			  }
			| {
					readonly txType: 'eip2930';
					readonly chainId: number;
					readonly accessList: AccessList;
					readonly gasParameters: {
						readonly gas: bigint;
						readonly gasPrice: bigint;
					};
			  }
		);

/**
 * A partially known tracked transaction with intended/provided values.
 * Emitted immediately via transaction:broadcasted.
 *
 * When known=false, values are what we intended/provided, but the wallet
 * may have modified them (e.g., gas estimation, nonce override).
 * Also discriminated by txType when known.
 * gasParameters may differ from what wallet actually uses.
 *
 * txType is inferred from provided params:
 * - maxFeePerGas provided → 'eip1559'
 * - gasPrice + accessList provided → 'eip2930'
 * - gasPrice only → 'legacy'
 * - undefined → wallet will determine type
 */
export type UnknownTrackedTransaction<TMetadata> =
	CommonTrackedFields<TMetadata> & {
		readonly known: false;
	} & (
			| {
					// txType inferred as eip1559
					readonly txType: 'eip1559';
					readonly chainId?: number;
					readonly accessList?: AccessList;
					readonly gasParameters: {
						readonly gas?: bigint;
						readonly maxFeePerGas?: bigint;
						readonly maxPriorityFeePerGas?: bigint;
					};
			  }
			| {
					// txType inferred as legacy
					readonly txType: 'legacy';
					readonly chainId?: number;
					// no accessList for legacy
					readonly gasParameters: {
						readonly gas?: bigint;
						readonly gasPrice?: bigint;
					};
			  }
			| {
					// txType inferred as eip2930
					readonly txType: 'eip2930';
					readonly chainId?: number;
					readonly accessList?: AccessList;
					readonly gasParameters: {
						readonly gas?: bigint;
						readonly gasPrice?: bigint;
					};
			  }
			| {
					// txType unknown - wallet will decide
					readonly txType?: undefined;
					readonly chainId?: number;
					readonly accessList?: AccessList;
					readonly gasParameters: IntendedGasParameters;
			  }
		);

/**
 * A tracked transaction - discriminated by 'known' field.
 * - known=true: Values are confirmed from chain fetch
 * - known=false: Values are intended/provided, may differ from actual
 */
export type TrackedTransaction<TMetadata> =
	| KnownTrackedTransaction<TMetadata>
	| UnknownTrackedTransaction<TMetadata>;

/**
 * Extended WriteContractParameters with metadata and flexible nonce.
 * Metadata is required unless TMetadata includes undefined.
 */
export type TrackedWriteContractParameters<
	TMetadata,
	TAbi extends Abi | readonly unknown[] = Abi,
	TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'> =
		ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
	TArgs extends ContractFunctionArgs<
		TAbi,
		'nonpayable' | 'payable',
		TFunctionName
	> = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
	TChainOverride extends Chain | undefined = Chain | undefined,
> = Omit<
	WriteContractParameters<
		TAbi,
		TFunctionName,
		TArgs,
		TChain,
		TAccount,
		TChainOverride
	>,
	'nonce'
> & {
	/**
	 * Nonce option:
	 * - number: exact nonce to use
	 * - BlockTag ('latest', 'pending', etc.): fetch nonce using this block tag
	 * - undefined: fetch nonce using 'pending' (default)
	 */
	nonce?: NonceOption;
} & MetadataField<TMetadata>;

/**
 * The fields that are auto-populated by writeContract.
 * These are excluded from user-provided metadata for writeContract.
 */
export type AutoPopulatedFields = 'type' | 'functionName' | 'args';

/**
 * Type that explicitly forbids auto-populated fields.
 * Uses never to make TypeScript error when these properties are provided.
 */
export type ForbiddenAutoPopulateFields = {
	type?: never;
	functionName?: never;
	args?: never;
};

/**
 * Metadata type for writeContract when auto-population is enabled.
 * Excludes operation, functionName and args since they will be auto-populated,
 * and explicitly forbids them to cause TypeScript errors if provided.
 *
 * User provides the remaining fields (e.g., purpose, priority), and the
 * auto-populated fields (operation, functionName, args) are added at runtime.
 */
export type WriteContractAutoPopulateMetadata<TMetadata> = Omit<
	TMetadata,
	AutoPopulatedFields
> &
	ForbiddenAutoPopulateFields;

/**
 * Metadata field for writeContract when auto-population is enabled.
 * Excludes operation, functionName and args since they will be auto-populated.
 *
 * If the remaining fields (after removing auto-populated fields) are all optional,
 * the metadata field itself becomes optional.
 */
export type WriteContractAutoPopulateMetadataField<TMetadata> =
	// Check if there are any remaining required keys after removing auto-populated fields
	keyof Omit<TMetadata, AutoPopulatedFields> extends never
		? // No other fields - metadata is optional (can be omitted entirely)
			{metadata?: WriteContractAutoPopulateMetadata<TMetadata>}
		: // Check if all remaining fields are optional
			Partial<Omit<TMetadata, AutoPopulatedFields>> extends Omit<
					TMetadata,
					AutoPopulatedFields
			  >
			? // All remaining fields are optional - metadata field is optional
				{metadata?: WriteContractAutoPopulateMetadata<TMetadata>}
			: // Some fields are required - metadata field is required
				{metadata: WriteContractAutoPopulateMetadata<TMetadata>};

/**
 * Extended WriteContractParameters with auto-populated metadata.
 * operation, functionName and args are excluded from the metadata since they're auto-populated.
 *
 * User provides any additional fields required by their TMetadata (e.g., purpose, priority),
 * and the auto-populated fields are merged at runtime.
 */
export type TrackedWriteContractAutoPopulateParameters<
	TMetadata,
	TAbi extends Abi | readonly unknown[] = Abi,
	TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'> =
		ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
	TArgs extends ContractFunctionArgs<
		TAbi,
		'nonpayable' | 'payable',
		TFunctionName
	> = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
	TChainOverride extends Chain | undefined = Chain | undefined,
> = Omit<
	WriteContractParameters<
		TAbi,
		TFunctionName,
		TArgs,
		TChain,
		TAccount,
		TChainOverride
	>,
	'nonce'
> & {
	/**
	 * Nonce option:
	 * - number: exact nonce to use
	 * - BlockTag ('latest', 'pending', etc.): fetch nonce using this block tag
	 * - undefined: fetch nonce using 'pending' (default)
	 */
	nonce?: NonceOption;
} & WriteContractAutoPopulateMetadataField<TMetadata>;

/**
 * Extended SendTransactionParameters with metadata and flexible nonce.
 * Metadata is required unless TMetadata includes undefined.
 */
export type TrackedSendTransactionParameters<
	TMetadata,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
	TChainOverride extends Chain | undefined = Chain | undefined,
> = Omit<
	SendTransactionParameters<TChain, TAccount, TChainOverride>,
	'nonce'
> & {
	/**
	 * Nonce option:
	 * - number: exact nonce to use
	 * - BlockTag ('latest', 'pending', etc.): fetch nonce using this block tag
	 * - undefined: fetch nonce using 'pending' (default)
	 */
	nonce?: NonceOption;
} & MetadataField<TMetadata>;

/**
 * Parameters for sendRawTransaction with metadata.
 * The serialized transaction already contains from/nonce which will be decoded.
 * Metadata is required unless TMetadata includes undefined.
 */
export type TrackedRawTransactionParameters<TMetadata> = {
	/**
	 * The RLP-encoded signed transaction.
	 */
	serializedTransaction: TransactionSerialized;
} & MetadataField<TMetadata>;

/**
 * A wallet client wrapper that tracks transactions with metadata.
 * TMetadata is the first type parameter and is mandatory - it determines
 * whether metadata is required or optional on transaction calls.
 */
export interface TrackedWalletClient<
	TMetadata,
	TTransport extends Transport = Transport,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
> {
	/**
	 * The underlying wallet client.
	 */
	readonly walletClient: WalletClient<TTransport, TChain, TAccount>;

	/**
	 * The public client used for nonce fetching and tx verification.
	 */
	readonly publicClient: PublicClient;

	// ============================================
	// Async methods (return hash immediately after broadcast)
	// ============================================

	/**
	 * Write to a contract with metadata tracking.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	writeContract<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
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
	): Promise<Hash>;

	/**
	 * Send a transaction with metadata tracking.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendTransaction<TChainOverride extends Chain | undefined = undefined>(
		args: TrackedSendTransactionParameters<
			TMetadata,
			TChain,
			TAccount,
			TChainOverride
		>,
	): Promise<Hash>;

	/**
	 * Send a signed raw transaction with metadata tracking.
	 * The nonce and from address are decoded from the serialized transaction.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendRawTransaction(
		args: TrackedRawTransactionParameters<TMetadata>,
	): Promise<Hash>;

	// ============================================
	// Sync methods (wait for confirmation, return receipt)
	// ============================================

	/**
	 * Write to a contract and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	writeContractSync<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
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
	): Promise<TransactionReceipt>;

	/**
	 * Send a transaction and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	sendTransactionSync<TChainOverride extends Chain | undefined = undefined>(
		args: TrackedSendTransactionParameters<
			TMetadata,
			TChain,
			TAccount,
			TChainOverride
		>,
	): Promise<TransactionReceipt>;

	/**
	 * Send a signed raw transaction and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	sendRawTransactionSync(
		args: TrackedRawTransactionParameters<TMetadata>,
	): Promise<TransactionReceipt>;

	// ============================================
	// Event subscription methods
	// ============================================

	/**
	 * Subscribe to transaction events.
	 * @param event - The event type to subscribe to
	 * @param listener - Callback function receiving the event data
	 * @returns Unsubscribe function
	 */
	on<TEvent extends keyof TrackedWalletClientEvents<TMetadata>>(
		event: TEvent,
		listener: (data: TrackedWalletClientEvents<TMetadata>[TEvent]) => void,
	): () => void;

	/**
	 * Unsubscribe from transaction events.
	 * @param event - The event type to unsubscribe from
	 * @param listener - The same listener function passed to on
	 */
	off<TEvent extends keyof TrackedWalletClientEvents<TMetadata>>(
		event: TEvent,
		listener: (data: TrackedWalletClientEvents<TMetadata>[TEvent]) => void,
	): void;
}

/**
 * Event map for TrackedWalletClient events.
 */
export type TrackedWalletClientEvents<TMetadata> = {
	/**
	 * Emitted immediately after a transaction is successfully broadcast.
	 */
	'transaction:broadcasted': TrackedTransaction<TMetadata>;
	/**
	 * Emitted when full transaction data is successfully fetched from chain.
	 * Not guaranteed to fire if fetch fails (tx not in mempool yet, network issues, etc.)
	 */
	'transaction:fetched': KnownTrackedTransaction<TMetadata>;
};

/**
 * A wallet client wrapper that tracks transactions with auto-populated metadata.
 * TMetadata must be a type where FunctionCallMetadata is assignable to it.
 * writeContract and writeContractSync automatically populate operation, functionName and args.
 */
export interface TrackedWalletClientAutoPopulate<
	TMetadata,
	TTransport extends Transport = Transport,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
> {
	/**
	 * The underlying wallet client.
	 */
	readonly walletClient: WalletClient<TTransport, TChain, TAccount>;

	/**
	 * The public client used for nonce fetching and tx verification.
	 */
	readonly publicClient: PublicClient;

	// ============================================
	// Async methods (return hash immediately after broadcast)
	// ============================================

	/**
	 * Write to a contract with metadata tracking.
	 * functionName and args are automatically populated from the contract call.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	writeContract<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
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
	): Promise<Hash>;

	/**
	 * Send a transaction with metadata tracking.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendTransaction<TChainOverride extends Chain | undefined = undefined>(
		args: TrackedSendTransactionParameters<
			TMetadata,
			TChain,
			TAccount,
			TChainOverride
		>,
	): Promise<Hash>;

	/**
	 * Send a signed raw transaction with metadata tracking.
	 * The nonce and from address are decoded from the serialized transaction.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendRawTransaction(
		args: TrackedRawTransactionParameters<TMetadata>,
	): Promise<Hash>;

	// ============================================
	// Sync methods (wait for confirmation, return receipt)
	// ============================================

	/**
	 * Write to a contract and wait for confirmation.
	 * functionName and args are automatically populated from the contract call.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	writeContractSync<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
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
	): Promise<TransactionReceipt>;

	/**
	 * Send a transaction and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	sendTransactionSync<TChainOverride extends Chain | undefined = undefined>(
		args: TrackedSendTransactionParameters<
			TMetadata,
			TChain,
			TAccount,
			TChainOverride
		>,
	): Promise<TransactionReceipt>;

	/**
	 * Send a signed raw transaction and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	sendRawTransactionSync(
		args: TrackedRawTransactionParameters<TMetadata>,
	): Promise<TransactionReceipt>;

	// ============================================
	// Event subscription methods
	// ============================================

	/**
	 * Subscribe to transaction events.
	 * @param event - The event type to subscribe to
	 * @param listener - Callback function receiving the event data
	 * @returns Unsubscribe function
	 */
	on<TEvent extends keyof TrackedWalletClientEvents<TMetadata>>(
		event: TEvent,
		listener: (data: TrackedWalletClientEvents<TMetadata>[TEvent]) => void,
	): () => void;

	/**
	 * Unsubscribe from transaction events.
	 * @param event - The event type to unsubscribe from
	 * @param listener - The same listener function passed to on
	 */
	off<TEvent extends keyof TrackedWalletClientEvents<TMetadata>>(
		event: TEvent,
		listener: (data: TrackedWalletClientEvents<TMetadata>[TEvent]) => void,
	): void;
}

/**
	* Utility type to get the return type of createTrackedWalletClient().using().
	*
	* Use this type to declare variables that will hold a TrackedWalletClient
	* without having to manually specify all the type parameters.
	*
	* @typeParam TMetadata - The metadata type for transaction tracking
	* @typeParam TAutoPopulate - Whether auto-population is enabled (default: false)
	* @typeParam TTransport - The transport type (default: Transport)
	* @typeParam TChain - The chain type (default: Chain | undefined)
	* @typeParam TAccount - The account type (default: Account | undefined)
	*
	* @example
	* ```typescript
	* // Standard mode with required metadata
	* type MyClient = TrackedWalletClientType<{purpose: string}>;
	* let client: MyClient;
	*
	* // Standard mode with optional metadata
	* type MyOptionalClient = TrackedWalletClientType<{purpose: string} | undefined>;
	*
	* // Auto-populate mode with default PopulatedMetadata
	* type MyAutoClient = TrackedWalletClientType<PopulatedMetadata, true>;
	*
	* // Auto-populate mode with extended metadata
	* type MyExtendedMetadata = FunctionCallMetadata & { priority: number };
	* type MyExtendedClient = TrackedWalletClientType<MyExtendedMetadata, true>;
	*
	* // With specific wallet client types
	* type MySpecificClient = TrackedWalletClientType<
	*   {purpose: string},
	*   false,
	*   HttpTransport,
	*   typeof mainnet,
	*   PrivateKeyAccount
	* >;
	* ```
	*/
export type TrackedWalletClientType<
	TMetadata,
	TAutoPopulate extends boolean = false,
	TTransport extends Transport = Transport,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
> = TAutoPopulate extends true
	? TrackedWalletClientAutoPopulate<TMetadata, TTransport, TChain, TAccount>
	: TrackedWalletClient<TMetadata, TTransport, TChain, TAccount>;
