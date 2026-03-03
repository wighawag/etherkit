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

/**
 * Expected event for success detection.
 * Even if tx hash changes due to replacement, we can detect success by watching for this event.
 */
export interface ExpectedEvent {
	address: Address;
	eventName: string;
	args?: Record<string, unknown>;
}

/**
 * Metadata that can be attached to a transaction for tracking purposes.
 * All fields are optional and extensible.
 */
export interface TransactionMetadata {
	/**
	 * Optional custom ID - if provided, used instead of tx hash for tracking.
	 * Useful for correlating transactions with business logic (e.g., order IDs).
	 */
	id?: string;

	/**
	 * Human-readable title for the transaction.
	 */
	title?: string;

	/**
	 * Detailed description of what the transaction does.
	 */
	description?: string;

	/**
	 * Expected event signature/filter for success detection.
	 * Even if tx hash changes due to replacement, we can detect success by watching for this event.
	 */
	expectedEvent?: ExpectedEvent;

	/**
	 * Extensible: user can add any additional fields.
	 */
	[key: string]: unknown;
}

/**
 * A tracked transaction record with all relevant information for tracking.
 */
export interface TrackedTransaction<M extends TransactionMetadata = TransactionMetadata> {
	/**
	 * Tracking ID - either metadata.id or auto-generated UUID.
	 */
	trackingId: string;

	/**
	 * The transaction hash once known.
	 */
	txHash: Hash;

	/**
	 * Sender address.
	 */
	from: Address;

	/**
	 * Transaction nonce (actual nonce from fetched tx, or intended if fetch failed).
	 */
	nonce: number;

	/**
	 * Chain ID.
	 */
	chainId: number;

	/**
	 * The full metadata provided by the caller.
	 */
	metadata: M;

	/**
	 * Timestamp when the transaction was initiated (ms since epoch).
	 */
	initiatedAt: number;

	/**
	 * The original transaction request data.
	 */
	request: unknown;
}

/**
 * Extended WriteContractParameters with optional metadata and flexible nonce.
 */
export type TrackedWriteContractParameters<
	TAbi extends Abi | readonly unknown[] = Abi,
	TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'> = ContractFunctionName<
		TAbi,
		'nonpayable' | 'payable'
	>,
	TArgs extends ContractFunctionArgs<
		TAbi,
		'nonpayable' | 'payable',
		TFunctionName
	> = ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
	TChainOverride extends Chain | undefined = Chain | undefined,
> = Omit<
	WriteContractParameters<TAbi, TFunctionName, TArgs, TChain, TAccount, TChainOverride>,
	'nonce'
> & {
	/**
	 * Optional metadata to attach to the transaction for tracking.
	 */
	metadata?: TransactionMetadata;

	/**
	 * Nonce option:
	 * - number: exact nonce to use
	 * - BlockTag ('latest', 'pending', etc.): fetch nonce using this block tag
	 * - undefined: fetch nonce using 'pending' (default)
	 */
	nonce?: NonceOption;
};

/**
 * Extended SendTransactionParameters with optional metadata and flexible nonce.
 */
export type TrackedSendTransactionParameters<
	TChain extends Chain | undefined = Chain | undefined,
	TAccount extends Account | undefined = Account | undefined,
	TChainOverride extends Chain | undefined = Chain | undefined,
> = Omit<SendTransactionParameters<TChain, TAccount, TChainOverride>, 'nonce'> & {
	/**
	 * Optional metadata to attach to the transaction for tracking.
	 */
	metadata?: TransactionMetadata;

	/**
	 * Nonce option:
	 * - number: exact nonce to use
	 * - BlockTag ('latest', 'pending', etc.): fetch nonce using this block tag
	 * - undefined: fetch nonce using 'pending' (default)
	 */
	nonce?: NonceOption;
};

/**
 * Parameters for sendRawTransaction with optional metadata.
 * The serialized transaction already contains from/nonce which will be decoded.
 */
export interface TrackedRawTransactionParameters {
	/**
	 * The RLP-encoded signed transaction.
	 */
	serializedTransaction: TransactionSerialized;

	/**
	 * Optional metadata to attach to the transaction for tracking.
	 */
	metadata?: TransactionMetadata;
}

/**
 * A wallet client wrapper that tracks transactions with metadata.
 */
export interface TrackedWalletClient<
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
	 * Write to a contract with optional metadata tracking.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	writeContract<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
		TArgs extends ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
		TChainOverride extends Chain | undefined = undefined,
	>(
		args: TrackedWriteContractParameters<
			TAbi,
			TFunctionName,
			TArgs,
			TChain,
			TAccount,
			TChainOverride
		>,
	): Promise<Hash>;

	/**
	 * Send a transaction with optional metadata tracking.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendTransaction<TChainOverride extends Chain | undefined = undefined>(
		args: TrackedSendTransactionParameters<TChain, TAccount, TChainOverride>,
	): Promise<Hash>;

	/**
	 * Send a signed raw transaction with optional metadata tracking.
	 * The nonce and from address are decoded from the serialized transaction.
	 * Returns immediately after broadcast with the transaction hash.
	 */
	sendRawTransaction(args: TrackedRawTransactionParameters): Promise<Hash>;

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
		TArgs extends ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName>,
		TChainOverride extends Chain | undefined = undefined,
	>(
		args: TrackedWriteContractParameters<
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
		args: TrackedSendTransactionParameters<TChain, TAccount, TChainOverride>,
	): Promise<TransactionReceipt>;

	/**
	 * Send a signed raw transaction and wait for confirmation.
	 * Returns the transaction receipt after the transaction is confirmed.
	 */
	sendRawTransactionSync(args: TrackedRawTransactionParameters): Promise<TransactionReceipt>;
}
