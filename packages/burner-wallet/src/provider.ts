// packages/burner-wallet/src/provider.ts

import type {
	EIP1193Provider,
	EIP1193ProviderWithoutEvents,
	EIP1193Account,
	EIP1193ChainId,
	EIP1193ConnectInfoMessage,
	EIP1193ProviderRpcError,
	EIP1193Message,
} from 'eip-1193';
import {createCurriedJSONRPC} from 'remote-procedure-call';
import {
	extendProviderWithAccounts,
	generateMnemonic,
} from 'eip-1193-accounts-wrapper';
import {english} from 'viem/accounts';
import {
	ACCOUNT_COUNT,
	type BurnerWalletManager,
	type BurnerWalletState,
	type CreateBurnerWalletProviderOptions,
	type BurnerWalletProviderResult,
} from './types.js';

type EventName =
	| 'accountsChanged'
	| 'chainChanged'
	| 'connect'
	| 'disconnect'
	| 'message';

type EventListener =
	| ((accounts: EIP1193Account[]) => unknown)
	| ((chainId: EIP1193ChainId) => unknown)
	| ((info: EIP1193ConnectInfoMessage) => unknown)
	| ((error: EIP1193ProviderRpcError) => unknown)
	| ((message: EIP1193Message) => unknown);

export function createBurnerWalletProvider(
	options: CreateBurnerWalletProviderOptions,
): BurnerWalletProviderResult {
	const {nodeURL, storagePrefix = 'burner-wallet:'} = options;
	const eventListeners = new Map<EventName, Set<EventListener>>();

	// ==================== Internal State ====================
	let mnemonic: string | null = null;
	let selectedIndex = 0;

	// ==================== localStorage ====================
	function load(): void {
		try {
			const storedMnemonic = localStorage.getItem(storagePrefix + 'mnemonic');
			const storedSelected = localStorage.getItem(storagePrefix + 'selected');

			if (storedMnemonic) {
				mnemonic = storedMnemonic;
				selectedIndex = storedSelected ? parseInt(storedSelected, 10) : 0;
			}
		} catch {
			// localStorage unavailable (SSR, etc)
		}
	}

	function save(): void {
		try {
			if (mnemonic) {
				localStorage.setItem(storagePrefix + 'mnemonic', mnemonic);
				localStorage.setItem(storagePrefix + 'selected', String(selectedIndex));
			} else {
				localStorage.removeItem(storagePrefix + 'mnemonic');
				localStorage.removeItem(storagePrefix + 'selected');
			}
		} catch {
			// localStorage unavailable
		}
	}

	// ==================== Event Handling ====================
	function emit(eventName: EventName, data: unknown): void {
		const set = eventListeners.get(eventName);
		if (set) {
			for (const listener of set) {
				(listener as (data: unknown) => unknown)(data);
			}
		}
	}

	async function emitAccountsChanged(): Promise<void> {
		if (!mnemonic) {
			emit('accountsChanged', []);
			return;
		}
		// Get accounts from inner provider and reorder
		const accounts = await inner.request({method: 'eth_accounts'});
		emit('accountsChanged', getOrderedAddresses(accounts as string[]));
	}

	// ==================== Inner Provider ====================
	function buildInner(): EIP1193ProviderWithoutEvents {
		const rpcProvider = createCurriedJSONRPC(nodeURL);
		if (!mnemonic) {
			// No mnemonic yet - return bare RPC provider
			return rpcProvider as unknown as EIP1193ProviderWithoutEvents;
		}
		return extendProviderWithAccounts(
			rpcProvider as unknown as EIP1193ProviderWithoutEvents,
			{
				accounts: {
					mnemonic,
					numAccounts: ACCOUNT_COUNT,
				},
			},
		);
	}

	let inner = buildInner();

	// ==================== Address Ordering ====================
	/**
	 * Reorder addresses so selectedIndex is first.
	 * Per EIP-1193, accounts[0] is the "active" account.
	 */
	function getOrderedAddresses(addresses: string[]): string[] {
		if (addresses.length === 0) return [];
		if (selectedIndex === 0 || selectedIndex >= addresses.length)
			return addresses;
		const result = [...addresses];
		const [selected] = result.splice(selectedIndex, 1);
		result.unshift(selected);
		return result;
	}

	// ==================== WalletManager ====================
	const walletManager: BurnerWalletManager = {
		createNew(): string {
			mnemonic = generateMnemonic(english);
			selectedIndex = 0;
			save();
			inner = buildInner();
			emitAccountsChanged();
			return mnemonic;
		},

		importMnemonic(newMnemonic: string): void {
			// Validate by building provider (will throw if invalid)
			mnemonic = newMnemonic;
			selectedIndex = 0;
			inner = buildInner(); // This validates the mnemonic
			save();
			emitAccountsChanged();
		},

		selectAccount(index: number): void {
			if (index < 0 || index >= ACCOUNT_COUNT) {
				throw new Error(
					`Invalid index: ${index}. Must be 0-${ACCOUNT_COUNT - 1}`,
				);
			}
			selectedIndex = index;
			save();
			// No need to rebuild inner - just reorder addresses
			emitAccountsChanged();
		},

		clearAll(): void {
			mnemonic = null;
			selectedIndex = 0;
			save();
			inner = buildInner();
			emitAccountsChanged();
		},

		get(): BurnerWalletState {
			return {mnemonic, selectedIndex};
		},
	};

	// ==================== Provider ====================
	const provider: EIP1193Provider = {
		async request(args: {method: string; params?: readonly unknown[]}) {
			// Auto-create wallet on first connection
			if (args.method === 'eth_requestAccounts') {
				if (!mnemonic) {
					walletManager.createNew();
				}
				const accounts = await inner.request(args as any);
				return getOrderedAddresses(accounts as unknown as string[]);
			}

			// Return ordered addresses
			if (args.method === 'eth_accounts') {
				const accounts = await inner.request(args as any);
				return getOrderedAddresses(accounts as unknown as string[]);
			}

			// All other methods delegate to inner provider
			return inner.request(args as any);
		},

		on(eventName: string, listener: (...args: any[]) => any) {
			const name = eventName as EventName;
			if (!eventListeners.has(name)) {
				eventListeners.set(name, new Set());
			}
			eventListeners.get(name)!.add(listener as EventListener);
			return provider;
		},

		removeListener(eventName: string, listener: (...args: any[]) => any) {
			const set = eventListeners.get(eventName as EventName);
			if (set) {
				set.delete(listener as EventListener);
			}
			return provider;
		},
	} as EIP1193Provider;

	// ==================== Initialize ====================
	load();
	if (mnemonic) {
		inner = buildInner();
	}

	// Emit connect event asynchronously
	setTimeout(() => {
		provider
			.request({method: 'eth_chainId'})
			.then((chainId: EIP1193ChainId) => {
				emit('connect', {chainId});
			})
			.catch(() => {
				// Connection failed silently
			});
	}, 0);

	return {
		provider,
		walletManager,
		cleanup: () => {
			eventListeners.clear();
		},
	};
}
