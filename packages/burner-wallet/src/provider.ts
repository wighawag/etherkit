// packages/burner-wallet/src/provider.ts

import type {
	EIP1193Provider,
	CoreMethods,
	EIP1193GenericRequestProvider,
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
	type EIP1193AccountsProvider,
	type ProviderOptions,
} from 'eip-1193-accounts-wrapper';
import {english} from 'viem/accounts';
import {derivePrivateKeys} from './derivation.js';
import {
	ACCOUNT_COUNT,
	type Hex,
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

/** Chain ids compared as numbers: `0x7a69` and `0x07a69` are the same chain. */
function sameChain(a: string, b: string): boolean {
	try {
		return BigInt(a) === BigInt(b);
	} catch {
		return false;
	}
}

/** An EIP-1193 `ProviderRpcError`: an `Error` with a numeric `code`. */
function rpcError(code: number, message: string): Error & {code: number} {
	return Object.assign(new Error(message), {code});
}

export function createBurnerWalletProvider(
	options: CreateBurnerWalletProviderOptions,
): BurnerWalletProviderResult {
	const {
		nodeURL,
		storagePrefix = 'burner-wallet:',
		impersonateAddresses,
		accountCount = ACCOUNT_COUNT,
	} = options;

	// Checked here rather than at the first request, so a bad count fails at the
	// call that is wrong instead of surfacing later as an empty account list.
	if (!Number.isInteger(accountCount) || accountCount < 1) {
		throw new Error(
			`accountCount must be an integer >= 1, got ${String(accountCount)}`,
		);
	}

	const eventListeners = new Map<EventName, Set<EventListener>>();

	// ==================== Internal State ====================
	let mnemonic: string | null = null;
	let selectedAddress: Hex | null = null;

	// ==================== localStorage ====================
	function load(): void {
		try {
			const storedMnemonic = localStorage.getItem(storagePrefix + 'mnemonic');
			const storedSelected = localStorage.getItem(storagePrefix + 'selected');

			if (storedMnemonic) {
				mnemonic = storedMnemonic;
			}
			if (storedSelected) {
				selectedAddress = storedSelected as Hex;
			}
		} catch {
			// localStorage unavailable (SSR, etc)
		}
	}

	function save(): void {
		try {
			if (mnemonic) {
				localStorage.setItem(storagePrefix + 'mnemonic', mnemonic);
			} else {
				localStorage.removeItem(storagePrefix + 'mnemonic');
			}
			if (selectedAddress) {
				localStorage.setItem(storagePrefix + 'selected', selectedAddress);
			} else {
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
		// Get accounts from inner provider and reorder
		const accounts = await inner.request({method: 'eth_accounts'});
		emit('accountsChanged', getOrderedAddresses(accounts as string[]));
	}

	// ==================== Inner Provider ====================
	/**
	 * Build the signing provider for a given mnemonic, `null` meaning "no wallet
	 * yet".
	 *
	 * TAKES THE MNEMONIC RATHER THAN READING IT, so that deriving (which is also
	 * how a mnemonic is validated) happens BEFORE any state is committed. The
	 * alternative - assign, then build, then save - leaves a rejected mnemonic in
	 * `walletManager.get()` while storage and signing still use the old one.
	 */
	function buildInner(forMnemonic: string | null): EIP1193AccountsProvider {
		// A URL it fetches, or the node object, whose `.request` it calls. Typed
		// with eip-1193's core methods, the ones every node serves: since
		// remote-procedure-call 0.2 the client is then an `EIP1193CoreProvider`.
		const rpcProvider = createCurriedJSONRPC<CoreMethods>(nodeURL);

		const providerOptions: ProviderOptions = {};

		if (forMnemonic) {
			// Private keys derived HERE rather than handing the wrapper the
			// mnemonic, because the wrapper walks BIP-44's account level and this
			// wallet must agree with the node it points at. See `derivation.ts`.
			providerOptions.accounts = {
				privateKeys: derivePrivateKeys(forMnemonic, accountCount),
			};
		}

		// Add impersonation support when list is provided
		if (impersonateAddresses && impersonateAddresses.length > 0) {
			providerOptions.impersonate = {
				impersonator: {
					impersonateAccount: async (params: {address: Hex}) => {
						// Not in any eip-1193 table the client is typed with: the untyped escape hatch.
						await (
							rpcProvider as unknown as EIP1193GenericRequestProvider
						).request({
							method: 'hardhat_impersonateAccount',
							params: [params.address],
						});
					},
				},
				mode: 'list',
				list: impersonateAddresses,
			};
		}

		return extendProviderWithAccounts(rpcProvider, providerOptions);
	}

	let inner = buildInner(mnemonic);

	// ==================== Address Ordering ====================
	/**
	 * Reorder addresses so selectedAddress is first.
	 * Per EIP-1193, accounts[0] is the "active" account.
	 */
	function getOrderedAddresses(addresses: string[]): string[] {
		if (addresses.length === 0) return [];
		if (!selectedAddress) return addresses;

		const selectedIdx = addresses.findIndex(
			(addr) => addr.toLowerCase() === selectedAddress!.toLowerCase(),
		);

		if (selectedIdx === -1 || selectedIdx === 0) return addresses;

		const result = [...addresses];
		const [selected] = result.splice(selectedIdx, 1);
		result.unshift(selected);
		return result;
	}

	// ==================== WalletManager ====================
	const walletManager: BurnerWalletManager = {
		createNew(): string {
			const newMnemonic = generateMnemonic(english);
			inner = buildInner(newMnemonic);
			mnemonic = newMnemonic;
			selectedAddress = null; // Reset selection, first account will be used
			save();
			emitAccountsChanged();
			return mnemonic;
		},

		importMnemonic(newMnemonic: string): void {
			// BUILD FIRST, COMMIT SECOND. Building derives the accounts, which is
			// what rejects an invalid mnemonic, so a throw here must leave the
			// wallet exactly as it was: same accounts signing, same mnemonic in
			// storage, same thing reported by `get()`. Assigning first made a
			// rejected mnemonic the one `get()` reported while the previous one
			// kept signing, and the two only agreed again after a reload.
			const nextInner = buildInner(newMnemonic);
			inner = nextInner;
			mnemonic = newMnemonic;
			selectedAddress = null; // Reset selection
			save();
			emitAccountsChanged();
		},

		selectAccount(address: Hex): void {
			selectedAddress = address;
			save();
			// No need to rebuild inner - just reorder addresses
			emitAccountsChanged();
		},

		clearAll(): void {
			mnemonic = null;
			selectedAddress = null;
			save();
			inner = buildInner(null);
			emitAccountsChanged();
		},

		get(): BurnerWalletState {
			return {mnemonic, selectedAddress};
		},
	};

	// ==================== Provider ====================
	const provider: EIP1193Provider = {
		async request(args: {method: string; params?: readonly unknown[]}) {
			// A genuine boundary: this is the wallet's own router, which receives any
			// method as a runtime string and forwards it, so it talks to the inner
			// provider through the untyped request signature. Read `inner` at call
			// time: `walletManager.createNew()` below replaces it.
			const forward = () => inner as unknown as EIP1193GenericRequestProvider;

			// Auto-create wallet on first connection
			if (args.method === 'eth_requestAccounts') {
				if (!mnemonic) {
					walletManager.createNew();
				}
				const accounts = await forward().request<string[]>(args);
				return getOrderedAddresses(accounts);
			}

			// Return ordered addresses
			if (args.method === 'eth_accounts') {
				if (!mnemonic) {
					walletManager.createNew();
				}
				const accounts = await forward().request<string[]>(args);
				return getOrderedAddresses(accounts);
			}

			// THE BURNER IS BOUND TO ONE NODE, so it is always on that node's chain
			// and can neither move to another nor add one. Without these two, the
			// requests went to the node, which answers "method not found" (-32601),
			// so an app asking to switch could not tell "wrong chain" from "broken
			// wallet". Answer them the way a wallet that lacks the chain does.
			if (
				args.method === 'wallet_switchEthereumChain' ||
				args.method === 'wallet_addEthereumChain'
			) {
				const requested = (args.params?.[0] as {chainId?: unknown} | undefined)
					?.chainId;
				if (
					typeof requested !== 'string' ||
					!/^0x[0-9a-fA-F]+$/.test(requested)
				) {
					// EIP-3326 / EIP-3085: the chain id is a 0x-prefixed hex string.
					throw rpcError(
						-32602,
						`${args.method} expects [{chainId: <0x-prefixed hex>}], got ${JSON.stringify(args.params)}`,
					);
				}
				const current = await forward().request<string>({
					method: 'eth_chainId',
				});
				if (sameChain(requested, current)) {
					return null; // EIP-3326 / EIP-3085: success is `null`
				}
				throw args.method === 'wallet_switchEthereumChain'
					? // EIP-3326: 4902 is "this chain has not been added", which is what
						// tells an app it may try wallet_addEthereumChain.
						rpcError(
							4902,
							`Unrecognized chain ID "${requested}": the burner wallet is bound to its node, on chain ${current}`,
						)
					: // EIP-1193 4200 "unsupported": adding a chain is not something
						// this wallet can do, and retrying will not change that.
						rpcError(
							4200,
							`The burner wallet cannot add chain "${requested}": it is bound to its node, on chain ${current}`,
						);
			}

			// All other methods delegate to inner provider
			return forward().request(args);
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
		inner = buildInner(mnemonic);
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
