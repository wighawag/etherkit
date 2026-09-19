// packages/burner-wallet/src/types.ts

export type Hex = `0x${string}`;

/** Number of accounts derived from the mnemonic when `accountCount` is not given. */
export const ACCOUNT_COUNT = 10;

/**
 * THE CHAIN THE BURNER POINTS AT, when it is not a URL.
 *
 * One async `request`, because that is the whole of what this package asks of a
 * node: the RPC client is built with `createCurriedJSONRPC(nodeURL)`, and for a
 * non-string endpoint `remote-procedure-call` calls `endpoint.request({method,
 * params})` per request and touches nothing else.
 *
 * DELIBERATELY NOT `EIP1193Provider` FROM `eip-1193`, which would be the
 * obvious type and would not compile at any real call site. That type is an
 * intersection of per-method overloads plus `on`/`removeListener`, so a node
 * with a generic `request(args): Promise<unknown>` - which is what an
 * in-browser chain such as webevm exposes - satisfies neither half, and naming
 * it here would leave the caller casting exactly as they do today. The methods
 * required are the methods used.
 *
 * A NODE NEEDS NO EVENTS, and that is not an oversight: it is the node, not the
 * wallet. The events requirement lives on the OTHER side of this package, on
 * the provider it returns - see `BurnerWalletProviderResult.provider`.
 *
 * Method syntax rather than a property is intentional: it makes the parameter
 * check bivariant, so a node declaring `params` as required, optional, `unknown`
 * or a tuple all fit.
 */
export type EIP1193NodeProvider = {
	request(args: {method: string; params?: any}): Promise<any>;
};

/** A JSON-RPC endpoint URL, or a chain living in the same tab. */
export type BurnerWalletNode = string | EIP1193NodeProvider;

export type BurnerWalletState = {
	/** The mnemonic phrase - null if not yet created */
	mnemonic: string | null;
	/** Currently selected account address - null if none selected */
	selectedAddress: Hex | null;
};

export type BurnerWalletManager = {
	/** Generate new wallet with fresh 12-word mnemonic, returns the mnemonic */
	createNew: () => string;

	/** Import existing mnemonic */
	importMnemonic: (mnemonic: string) => void;

	/** Select account by address - affects address ordering, selected address will be first */
	selectAccount: (address: Hex) => void;

	/** Clear everything - mnemonic and selection */
	clearAll: () => void;

	/** Get current state snapshot */
	get: () => BurnerWalletState;
};

export type CreateBurnerWalletProviderOptions = {
	/**
	 * Ethereum JSON-RPC endpoint URL, or an EIP-1193 node object to call
	 * directly - an in-browser chain has no URL. See `EIP1193NodeProvider`.
	 */
	nodeURL: BurnerWalletNode;
	/** localStorage key prefix (default: 'burner-wallet:') */
	storagePrefix?: string;
	/** List of addresses to impersonate - requires a node that supports hardhat_impersonateAccount */
	impersonateAddresses?: Hex[];
	/**
	 * How many accounts to derive from the mnemonic (default: `ACCOUNT_COUNT`,
	 * ten). Must be an integer >= 1; anything else throws at creation.
	 *
	 * PASS 1 WHEN THE APP SHOULD NOT ASK WHICH ACCOUNT. A wallet offering
	 * several makes a connecting app show an account picker, which is a second
	 * dialog between a player and a game they have already chosen to play.
	 *
	 * This is a bound on derivation, not a filter in front of it: the accounts
	 * beyond it are never derived, so nothing downstream can reveal them. Do NOT
	 * reach for a wrapper that truncates `eth_accounts` instead - see the
	 * warning on `BurnerWalletProviderResult.provider`.
	 */
	accountCount?: number;
};

export type BurnerWalletProviderResult = {
	/**
	 * EIP-1193 provider - pure, no extra methods.
	 *
	 * PASS THIS OBJECT ITSELF TO A CONNECTOR, not a `{request}` object built
	 * around it. `EthereumWalletProvider` in
	 * `@etherplay/wallet-connector-ethereum` also calls `on` and
	 * `removeListener`, to follow account and chain changes, and a wrapper
	 * forwarding only `request` therefore throws `removeListener is not a
	 * function` - from inside the connection, as a FAILED TRANSACTION, with the
	 * send already signed. The type says so (`EIP1193Provider` includes the
	 * event methods), and the reason to wrap at all - hiding accounts - is
	 * `accountCount` instead. If you must wrap, forward everything and
	 * intercept, so the wrapper cannot go stale when the interface grows.
	 */
	provider: import('eip-1193').EIP1193Provider;
	/** Wallet state management */
	walletManager: BurnerWalletManager;
	/** Cleanup function */
	cleanup: () => void;
};
