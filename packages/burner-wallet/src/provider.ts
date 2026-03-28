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
import {BurnerKeyStorage} from './storage.js';

export type BurnerWalletProviderOptions = {
	nodeURL: string;
	storageKey?: string;
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

export function createBurnerWalletProvider(
	options: BurnerWalletProviderOptions
): EIP1193Provider & {storage: BurnerKeyStorage} {
	const storage = new BurnerKeyStorage(options.storageKey);
	const listeners = new Map<EventName, Set<EventListener>>();

	function emit(eventName: EventName, data: unknown) {
		const set = listeners.get(eventName);
		if (set) {
			for (const listener of set) {
				(listener as (data: unknown) => unknown)(data);
			}
		}
	}

	function buildProvider(): EIP1193ProviderWithoutEvents {
		const rpcProvider = createCurriedJSONRPC<Methods>(options.nodeURL);
		return extendProviderWithAccounts(rpcProvider, {
			accounts: {
				privateKeys: storage.getPrivateKeys(),
			},
		});
	}

	let inner = buildProvider();

	function rebuildAndNotify() {
		inner = buildProvider();
		emit('accountsChanged', storage.getAddresses());
	}

	const request = async (args: {
		method: string;
		params?: readonly unknown[];
	}) => {
		if (args.method === 'eth_requestAccounts') {
			if (storage.getPrivateKeys().length === 0) {
				storage.createAccount();
				rebuildAndNotify();
			}
			return storage.getAddresses();
		}

		return (inner as EIP1193ProviderWithoutEvents).request(args as any);
	};

	const provider = {
		storage,

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
	} as unknown as EIP1193Provider & {storage: BurnerKeyStorage};

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

	return provider;
}
