// packages/burner-wallet/src/types.ts

export type Hex = `0x${string}`;

export const ACCOUNT_COUNT = 10;

export type BurnerWalletState = {
	/** The mnemonic phrase - null if not yet created */
	mnemonic: string | null;
	/** Currently selected account index (0-based) */
	selectedIndex: number;
};

export type BurnerWalletManager = {
	/** Generate new wallet with fresh 12-word mnemonic, returns the mnemonic */
	createNew: () => string;

	/** Import existing mnemonic, resets selectedIndex to 0 */
	importMnemonic: (mnemonic: string) => void;

	/** Select account by index (0-9), affects address ordering */
	selectAccount: (index: number) => void;

	/** Clear everything - mnemonic and selection */
	clearAll: () => void;

	/** Get current state snapshot */
	get: () => BurnerWalletState;
};

export type CreateBurnerWalletProviderOptions = {
	/** Ethereum JSON-RPC endpoint URL */
	nodeURL: string;
	/** localStorage key prefix (default: 'burner-wallet:') */
	storagePrefix?: string;
};

export type BurnerWalletProviderResult = {
	/** EIP-1193 provider - pure, no extra methods */
	provider: import('eip-1193').EIP1193Provider;
	/** Wallet state management */
	walletManager: BurnerWalletManager;
	/** Cleanup function */
	cleanup: () => void;
};
