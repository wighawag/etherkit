import type {EIP1193Provider} from 'eip-1193';
import {createBurnerWalletProvider} from './provider.js';
import {createBurnerWalletStore} from './store.js';
import type {BurnerWalletStore, CreateBurnerWalletStoreOptions} from './types.js';
import {
	announceBurnerWallet,
	type AnnounceBurnerWalletOptions,
} from './announcer.js';

export type InitBurnerWalletOptions = {
	/** Ethereum JSON-RPC endpoint URL */
	nodeURL: string;
} & CreateBurnerWalletStoreOptions &
	AnnounceBurnerWalletOptions;

export type BurnerWalletInstance = {
	provider: EIP1193Provider;
	store: BurnerWalletStore;
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
	options: InitBurnerWalletOptions
): BurnerWalletInstance {
	const store = createBurnerWalletStore({
		storagePrefix: options.storagePrefix,
	});

	const provider = createBurnerWalletProvider({
		nodeURL: options.nodeURL,
		store,
	});

	const cleanup = announceBurnerWallet(provider, options);

	return {
		provider,
		store,
		cleanup,
	};
}
