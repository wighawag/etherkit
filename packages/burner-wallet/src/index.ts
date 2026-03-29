// packages/burner-wallet/src/index.ts

export {createBurnerWalletStore} from './store.js';
export type {
	Hex,
	BurnerWalletState,
	BurnerWalletStore,
	CreateBurnerWalletStoreOptions,
} from './types.js';
export {createBurnerWalletProvider} from './provider.js';
export type {
	BurnerWalletProviderOptions,
	BurnerWalletProviderResult,
} from './provider.js';
export {BURNER_WALLET_SVG, BURNER_WALLET_ICON_DATA_URI} from './icon.js';
export {announceBurnerWallet} from './announcer.js';
export type {
	EIP6963ProviderInfo,
	EIP6963ProviderDetail,
	AnnounceBurnerWalletOptions,
} from './announcer.js';
export {initBurnerWallet} from './init.js';
export type {InitBurnerWalletOptions, BurnerWalletInstance} from './init.js';
