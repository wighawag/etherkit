// packages/burner-wallet/src/types.ts

export type Hex = `0x${string}`;

export type BurnerWalletState = {
	/** The mnemonic phrase - null if not yet created */
	mnemonic: string | null;
	/** Number of accounts created (0 to accountCount-1 are valid indices) */
	accountCount: number;
	/** Currently selected account index (0-based), 0 if no accounts */
	selectedIndex: number;
	/** Derived addresses for all accounts */
	addresses: Hex[];
	/** Currently selected address, null if no accounts */
	selectedAddress: Hex | null;
};

export type BurnerWalletStore = {
	/** Subscribe to state changes - returns unsubscribe function (Svelte store compatible) */
	subscribe: (listener: (state: BurnerWalletState) => void) => () => void;

	/** Get current state snapshot */
	get: () => BurnerWalletState;

	// === Mutation Methods ===

	/** Create new wallet with fresh 12-word mnemonic, returns the mnemonic */
	createWallet: () => string;

	/** Import existing mnemonic, resets account count to 1 */
	importMnemonic: (mnemonic: string) => void;

	/** Add next account (sequential), auto-creates wallet if needed, returns new index */
	addAccount: () => number;

	/** Select an account by index, auto-creates wallet if needed */
	selectAccount: (index: number) => void;

	/** Clear everything - mnemonic and all accounts */
	clearAll: () => void;

	// === Read Methods ===

	/** Get mnemonic (null if not created) */
	getMnemonic: () => string | null;

	/** Get private key for account at index (throws if index >= accountCount) */
	getPrivateKey: (index: number) => Hex;

	/** Get all private keys for accounts 0 to accountCount-1 */
	getPrivateKeys: () => Hex[];

	/** Get address for account at index (throws if index >= accountCount) */
	getAddress: (index: number) => Hex;
};

export type CreateBurnerWalletStoreOptions = {
	/** localStorage key prefix (default: 'burner-wallet:') */
	storagePrefix?: string;
};
