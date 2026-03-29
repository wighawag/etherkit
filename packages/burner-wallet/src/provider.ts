import type {
	EIP1193Provider,
	EIP1193ProviderWithoutEvents,
	EIP1193Account,
	EIP1193ChainId,
	EIP1193ConnectInfoMessage,
	EIP1193ProviderRpcError,
	EIP1193Message,
	Methods,
} from 'eip-1193';
import {createCurriedJSONRPC} from 'remote-procedure-call';
import {extendProviderWithAccounts} from 'eip-1193-accounts-wrapper';
import type {BurnerWalletStore} from './types.js';

export type BurnerWalletProviderOptions = {
	nodeURL: string;
	store: BurnerWalletStore;
};

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

export type BurnerWalletProviderResult = {
	provider: EIP1193Provider;
	/** Cleanup function to unsubscribe from store updates */
	cleanup: () => void;
};

export function createBurnerWalletProvider(
	options: BurnerWalletProviderOptions
): BurnerWalletProviderResult {
	const {nodeURL, store} = options;
	const listeners = new Map<EventName, Set<EventListener>>();

	function emit(eventName: EventName, data: unknown) {
		const set = listeners.get(eventName);
		if (set) {
			for (const listener of set) {
				(listener as (data: unknown) => unknown)(data);
			}
		}
	}

	/**
	 * Builds a new inner provider with current private keys.
	 *
	 * Note: Keys are captured at rebuild time (snapshot), not lazily.
	 * This is intentional - inner is rebuilt on every store address change,
	 * so keys always reflect the current state when needed.
	 */
	function buildProvider(): EIP1193ProviderWithoutEvents {
		const rpcProvider = createCurriedJSONRPC<Methods>(nodeURL);
		return extendProviderWithAccounts(rpcProvider, {
			accounts: {
				privateKeys: store.getPrivateKeys(),
			},
		});
	}

	/**
	 * Returns addresses ordered with selectedAddress first, per EIP-1193 convention.
	 * Most dapps expect accounts[0] to be the active account.
	 */
	function getOrderedAddresses(state: {
		addresses: string[];
		selectedIndex: number;
	}): string[] {
		if (state.addresses.length === 0) return [];
		const addresses = [...state.addresses];
		const selectedIndex = state.selectedIndex;
		if (selectedIndex > 0 && selectedIndex < addresses.length) {
			// Move selected address to front
			const [selected] = addresses.splice(selectedIndex, 1);
			addresses.unshift(selected);
		}
		return addresses;
	}

	let inner = buildProvider();
	let lastState = store.get();
	let lastOrderedAddresses = getOrderedAddresses(lastState);

	// Subscribe to store changes - rebuild when addresses change, emit when order changes.
	// Note: subscribe() fires immediately with current state (Svelte store convention).
	// This means lastState is set to the same state just before, so the initial
	// callback won't cause a spurious rebuild or emit.
	const unsubscribe = store.subscribe((state) => {
		const addressesChanged =
			state.addresses.length !== lastState.addresses.length ||
			state.addresses.some((addr, i) => addr !== lastState.addresses[i]);

		const orderedAddresses = getOrderedAddresses(state);
		const orderChanged =
			orderedAddresses.length !== lastOrderedAddresses.length ||
			orderedAddresses.some((addr, i) => addr !== lastOrderedAddresses[i]);

		if (addressesChanged) {
			inner = buildProvider();
		}

		if (orderChanged) {
			emit('accountsChanged', orderedAddresses);
		}

		lastState = state;
		lastOrderedAddresses = orderedAddresses;
	});

	const request = async (args: {
		method: string;
		params?: readonly unknown[];
	}) => {
		if (args.method === 'eth_requestAccounts') {
			const state = store.get();
			if (state.accountCount === 0) {
				// Create a wallet with 1 account if none exists
				store.createWallet();
				// After createWallet, the store subscription will rebuild the provider
			}
			return getOrderedAddresses(store.get());
		}

		return (inner as EIP1193ProviderWithoutEvents).request(args as any);
	};

	const provider = {
		request,

		on(eventName: string, listener: (...args: any[]) => any) {
			const name = eventName as EventName;
			if (!listeners.has(name)) {
				listeners.set(name, new Set());
			}
			listeners.get(name)!.add(listener as EventListener);
			return provider;
		},

		removeListener(eventName: string, listener: (...args: any[]) => any) {
			const set = listeners.get(eventName as EventName);
			if (set) {
				set.delete(listener as EventListener);
			}
			return provider;
		},
	} as unknown as EIP1193Provider;

	// Emit connect event asynchronously after creation
	setTimeout(() => {
		provider
			.request({method: 'eth_chainId'})
			.then((chainId: EIP1193ChainId) => {
				emit('connect', {chainId});
			})
			.catch(() => {
				// connection failed, no connect event
			});
	}, 0);

	return {
		provider,
		cleanup: unsubscribe,
	};
}
