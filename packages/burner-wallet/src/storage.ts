import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';

export type Hex = `0x${string}`;

export class BurnerKeyStorage {
	private readonly storagePrefix: string;
	private keys: Hex[];

	constructor(storagePrefix: string = 'burner-wallet:') {
		this.storagePrefix = storagePrefix;
		this.keys = [];
		this.load();

		console.warn(
			'[BurnerKeyStorage] Private keys are stored in localStorage in plain text. ' +
				'This is intended for development and testing only. ' +
				'Do not use with real funds.'
		);
	}

	createAccount(): Hex {
		const privateKey = generatePrivateKey();
		this.keys.push(privateKey);
		this.save();
		return privateKey;
	}

	getPrivateKeys(): Hex[] {
		return [...this.keys];
	}

	getAddresses(): Hex[] {
		return this.keys.map(
			(key) => privateKeyToAccount(key).address as Hex
		);
	}

	removeAccount(address: Hex): void {
		const lowerAddress = address.toLowerCase();
		this.keys = this.keys.filter(
			(key) =>
				privateKeyToAccount(key).address.toLowerCase() !== lowerAddress
		);
		this.save();
	}

	clear(): void {
		this.keys = [];
		this.save();
	}

	private load(): void {
		try {
			const raw = localStorage.getItem(this.storagePrefix + 'keys');
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					this.keys = parsed.filter(
						(k: unknown): k is Hex =>
							typeof k === 'string' && k.startsWith('0x')
					);
				}
			}
		} catch {
			this.keys = [];
		}
	}

	private save(): void {
		try {
			localStorage.setItem(
				this.storagePrefix + 'keys',
				JSON.stringify(this.keys)
			);
		} catch {
			// localStorage may be unavailable in some environments
		}
	}
}
