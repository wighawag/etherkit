export type BurnerKeyStorage = {
	getPrivateKeys(): `0x${string}`[];
	addPrivateKey(key: `0x${string}`): void;
	removePrivateKey(key: `0x${string}`): void;
	clearAll(): void;
};
