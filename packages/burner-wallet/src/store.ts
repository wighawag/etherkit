// packages/burner-wallet/src/store.ts

import {toHex} from 'viem';
import {generateMnemonic, mnemonicToAccount, english} from 'viem/accounts';
import type {
	Hex,
	BurnerWalletState,
	BurnerWalletStore,
	CreateBurnerWalletStoreOptions,
} from './types.js';

export function createBurnerWalletStore(
	options?: CreateBurnerWalletStoreOptions
): BurnerWalletStore {
	const prefix = options?.storagePrefix ?? 'burner-wallet:';
	const listeners = new Set<(state: BurnerWalletState) => void>();

	// Internal state
	let mnemonic: string | null = null;
	let accountCount = 0;
	let selectedIndex = 0;

	// Load from localStorage on init
	function load() {
		try {
			const storedMnemonic = localStorage.getItem(prefix + 'mnemonic');
			const storedCount = localStorage.getItem(prefix + 'count');
			const storedSelected = localStorage.getItem(prefix + 'selected');

			if (storedMnemonic) {
				mnemonic = storedMnemonic;
				accountCount = storedCount ? parseInt(storedCount, 10) : 1;
				selectedIndex = storedSelected
					? parseInt(storedSelected, 10)
					: 0;
			}
		} catch {
			// localStorage unavailable
		}
	}

	function save() {
		try {
			if (mnemonic) {
				localStorage.setItem(prefix + 'mnemonic', mnemonic);
				localStorage.setItem(prefix + 'count', String(accountCount));
				localStorage.setItem(prefix + 'selected', String(selectedIndex));
			} else {
				localStorage.removeItem(prefix + 'mnemonic');
				localStorage.removeItem(prefix + 'count');
				localStorage.removeItem(prefix + 'selected');
			}
		} catch {
			// localStorage unavailable
		}
	}

	function deriveAddress(index: number): Hex {
		if (!mnemonic) throw new Error('No wallet created');
		const account = mnemonicToAccount(mnemonic, {addressIndex: index});
		return account.address as Hex;
	}

	/**
	 * Derives the private key for an account at the given index.
	 *
	 * Note: account.getHdKey() is used here but may not be guaranteed stable
	 * across viem major versions. If this breaks in a future viem update,
	 * consider using hdKeyToAccount which exposes privateKey directly.
	 * @see https://viem.sh/docs/accounts/hd.html
	 */
	function derivePrivateKey(index: number): Hex {
		if (!mnemonic) throw new Error('No wallet created');
		const account = mnemonicToAccount(mnemonic, {addressIndex: index});
		const hdKey = account.getHdKey();
		if (!hdKey.privateKey) {
			throw new Error('Failed to derive private key');
		}
		return toHex(hdKey.privateKey) as Hex;
	}

	function buildState(): BurnerWalletState {
		const addresses: Hex[] = [];
		if (mnemonic) {
			for (let i = 0; i < accountCount; i++) {
				addresses.push(deriveAddress(i));
			}
		}

		return {
			mnemonic,
			accountCount,
			selectedIndex,
			addresses,
			selectedAddress: addresses[selectedIndex] ?? null,
		};
	}

	function notify() {
		const state = buildState();
		for (const listener of listeners) {
			listener(state);
		}
	}

	function ensureWallet() {
		if (!mnemonic) {
			mnemonic = generateMnemonic(english);
			accountCount = 1;
			selectedIndex = 0;
			save();
		}
	}

	// Initialize
	load();

	return {
		subscribe(listener) {
			listeners.add(listener);
			listener(buildState()); // Immediate callback with current state (Svelte convention)
			return () => listeners.delete(listener);
		},

		get: buildState,

		createWallet() {
			mnemonic = generateMnemonic(english);
			accountCount = 1;
			selectedIndex = 0;
			save();
			notify();
			return mnemonic;
		},

		importMnemonic(newMnemonic: string) {
			// Validate by attempting to derive an account
			mnemonicToAccount(newMnemonic, {addressIndex: 0});
			mnemonic = newMnemonic;
			accountCount = 1;
			selectedIndex = 0;
			save();
			notify();
		},

		addAccount() {
			ensureWallet();
			const newIndex = accountCount;
			accountCount++;
			selectedIndex = newIndex;
			save();
			notify();
			return newIndex;
		},

		selectAccount(index: number) {
			ensureWallet();
			if (index < 0 || index >= accountCount) {
				throw new Error('Invalid index');
			}
			selectedIndex = index;
			save();
			notify();
		},

		clearAll() {
			mnemonic = null;
			accountCount = 0;
			selectedIndex = 0;
			save();
			notify();
		},

		getMnemonic: () => mnemonic,

		getPrivateKey(index: number) {
			if (!mnemonic) throw new Error('No wallet created');
			if (index < 0 || index >= accountCount)
				throw new Error('Invalid index');
			return derivePrivateKey(index);
		},

		getPrivateKeys() {
			if (!mnemonic) return [];
			const keys: Hex[] = [];
			for (let i = 0; i < accountCount; i++) {
				keys.push(derivePrivateKey(i));
			}
			return keys;
		},

		getAddress(index: number) {
			if (!mnemonic) throw new Error('No wallet created');
			if (index < 0 || index >= accountCount)
				throw new Error('Invalid index');
			return deriveAddress(index);
		},
	};
}
