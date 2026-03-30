// packages/burner-wallet/src/init.ts

import type {EIP1193Provider} from 'eip-1193';
import {createBurnerWalletProvider} from './provider.js';
import type {BurnerWalletManager, Hex} from './types.js';
import {
	announceBurnerWallet,
	type AnnounceBurnerWalletOptions,
} from './announcer.js';

export type InitBurnerWalletOptions = {
	/** Ethereum JSON-RPC endpoint URL */
	nodeURL: string;
	/** localStorage key prefix (default: 'burner-wallet:') */
	storagePrefix?: string;
	/** List of addresses to impersonate - requires a node that supports hardhat_impersonateAccount */
	impersonateAddresses?: Hex[];
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
