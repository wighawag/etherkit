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

export type ExpectedUpdate =
	| {
			address: `0x${string}`;
			event: {topics: `0x${string}`[]};
	  }
	| {
			address: `0x${string}`;
			call: {data: `0x${string}`; result: `0x${string}`};
	  };

/**
 * Metadata that can be attached to a transaction for tracking purposes.
 * All fields are optional and extensible.
 */
export interface TransactionMetadata {
	id?: string;
	name?: string;
	args?: any[];
	description?: string;
	expectedUpdate?: ExpectedUpdate;
	[key: string]: unknown;
}

/**
 * Conditional type that makes metadata required or optional based on TMetadata.
 * If TMetadata includes undefined (e.g., `MyMeta | undefined`), metadata is optional.
 * Otherwise, metadata is required.
 */
export type MetadataField<TMetadata> = undefined extends TMetadata
	? {metadata?: TMetadata}
	: {metadata: TMetadata};

/**
 * A tracked transaction record with all relevant information for tracking.
 * The metadata field type matches what was provided to the TrackedWalletClient.
 */
export interface TrackedTransaction<TMetadata> {
	chainId?: number;
	readonly hash: `0x${string}`;
	readonly from: `0x${string}`;
	nonce?: number;
	readonly broadcastTimestampMs: number;
	readonly metadata: TMetadata;
}

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
	 * Subscribe to transaction broadcast events.
	 * Called immediately after a transaction is successfully broadcast.
	 * @param listener - Callback function receiving TrackedTransaction with TMetadata
	 * @returns Unsubscribe function
	 */
	onTransactionBroadcasted(
		listener: (event: TrackedTransaction<TMetadata>) => void,
	): () => void;

	/**
	 * Unsubscribe from transaction broadcast events.
	 * @param listener - The same listener function passed to onTransactionBroadcasted
	 */
	offTransactionBroadcasted(
		listener: (event: TrackedTransaction<TMetadata>) => void,
	): void;
}
