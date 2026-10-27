// packages/burner-wallet/src/init.ts

import type {EIP1193Provider} from 'eip-1193';
import {createBurnerWalletProvider} from './provider.js';
import type {BurnerWalletManager, BurnerWalletNode, Hex} from './types.js';
import {
	announceBurnerWallet,
	type AnnounceBurnerWalletOptions,
} from './announcer.js';

export type InitBurnerWalletOptions = {
	/**
	 * Ethereum JSON-RPC endpoint URL, or an EIP-1193 node object to call
	 * directly - an in-browser chain has no URL. See `BurnerWalletNodeProvider`.
	 */
	nodeURL: BurnerWalletNode;
	/** localStorage key prefix (default: 'burner-wallet:') */
	storagePrefix?: string;
	/** List of addresses to impersonate - requires a node that supports hardhat_impersonateAccount */
	impersonateAddresses?: Hex[];
	/**
	 * How many accounts to derive (default: ten). Pass 1 so a connecting app has
	 * no account picker to show. See `CreateBurnerWalletProviderOptions`.
	 */
	accountCount?: number;
} & AnnounceBurnerWalletOptions;

export type BurnerWalletInstance = {
	provider: EIP1193Provider;
	walletManager: BurnerWalletManager;
	cleanup: () => void;
};

/**
 * Initialize a burner wallet and announce it via EIP-6963.
 *
 * Usage in a Vite app:
 * ```ts
 * import {initBurnerWallet} from '@etherkit/burner-wallet';
 *
 * if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_BURNER_WALLET) {
 *   initBurnerWallet({nodeURL: import.meta.env.VITE_RPC_URL});
 * }
 * ```
 */
export function initBurnerWallet(
	options: InitBurnerWalletOptions,
): BurnerWalletInstance {
	const {
		provider,
		walletManager,
		cleanup: providerCleanup,
	} = createBurnerWalletProvider({
		nodeURL: options.nodeURL,
		storagePrefix: options.storagePrefix,
		impersonateAddresses: options.impersonateAddresses,
		accountCount: options.accountCount,
	});

	const announcerCleanup = announceBurnerWallet(provider, options);

	return {
		provider,
		walletManager,
		cleanup: () => {
			announcerCleanup();
			providerCleanup();
		},
	};
}
