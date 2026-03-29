// packages/burner-wallet/src/index.ts

export {createBurnerWalletProvider} from './provider.js';
export {
	ACCOUNT_COUNT,
	type Hex,
	type BurnerWalletState,
	type BurnerWalletManager,
	type CreateBurnerWalletProviderOptions,
	type BurnerWalletProviderResult,
} from './types.js';
export {BURNER_WALLET_SVG, BURNER_WALLET_ICON_DATA_URI} from './icon.js';
export {announceBurnerWallet} from './announcer.js';
export type {
	EIP6963ProviderInfo,
	EIP6963ProviderDetail,
	AnnounceBurnerWalletOptions,
} from './announcer.js';
export {initBurnerWallet} from './init.js';
export type {InitBurnerWalletOptions, BurnerWalletInstance} from './init.js';
