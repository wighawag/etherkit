import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createBurnerWalletProvider} from '../src/provider.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(),
	length: 0,
	key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
});

describe('createBurnerWalletProvider', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	it('returns a provider with storage', () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(provider).toBeDefined();
		expect(provider.storage).toBeDefined();
		expect(provider.request).toBeTypeOf('function');
		expect(provider.on).toBeTypeOf('function');
		expect(provider.removeListener).toBeTypeOf('function');
	});

	it('eth_requestAccounts creates account if none exist', async () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(provider.storage.getPrivateKeys()).toHaveLength(0);

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(1);
		expect((accounts as string[])[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
		expect(provider.storage.getPrivateKeys()).toHaveLength(1);
	});

	it('eth_requestAccounts does not create extra accounts if one exists', async () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		provider.storage.createAccount();

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(1);
		expect(provider.storage.getPrivateKeys()).toHaveLength(1);
	});

	it('emits accountsChanged when eth_requestAccounts creates account', async () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringMatching(/^0x/)])
		);
	});

	it('does not emit accountsChanged when accounts already exist', async () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		provider.storage.createAccount();

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).not.toHaveBeenCalled();
	});

	it('on returns the provider for chaining', () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		const result = provider.on('accountsChanged', () => {});
		expect(result).toBe(provider);
	});

	it('removeListener stops notifications', async () => {
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		provider.removeListener('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).not.toHaveBeenCalled();
	});
});
