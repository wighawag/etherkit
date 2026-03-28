import type {EIP1193Provider} from 'eip-1193';
import {createBurnerWalletProvider} from './provider.js';
import type {BurnerWalletProviderOptions} from './provider.js';
import {
	announceBurnerWallet,
	type AnnounceBurnerWalletOptions,
} from './announcer.js';
import type {BurnerKeyStorage} from './storage.js';

export type InitBurnerWalletOptions = BurnerWalletProviderOptions &
	AnnounceBurnerWalletOptions;

export type BurnerWalletInstance = {
	provider: EIP1193Provider;
	storage: BurnerKeyStorage;
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
	const providerWithStorage = createBurnerWalletProvider(options);
	const cleanup = announceBurnerWallet(providerWithStorage, options);

	return {
		provider: providerWithStorage,
		storage: providerWithStorage.storage,
		cleanup,
	};
}
