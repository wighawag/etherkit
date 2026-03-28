import {describe, it, expect, beforeEach, vi} from 'vitest';
import {BurnerKeyStorage} from '../src/storage.js';

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
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
	}),
	length: 0,
	key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
});

describe('BurnerKeyStorage', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	it('starts with no keys', () => {
		const storage = new BurnerKeyStorage();
		expect(storage.getPrivateKeys()).toEqual([]);
		expect(storage.getAddresses()).toEqual([]);
	});

	it('creates an account and returns a private key', () => {
		const storage = new BurnerKeyStorage();
		const key = storage.createAccount();
		expect(key).toMatch(/^0x[0-9a-f]{64}$/);
		expect(storage.getPrivateKeys()).toHaveLength(1);
		expect(storage.getPrivateKeys()[0]).toBe(key);
	});

	it('derives addresses from private keys', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		const addresses = storage.getAddresses();
		expect(addresses).toHaveLength(1);
		expect(addresses[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
	});

	it('persists keys to localStorage', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		expect(localStorageMock.setItem).toHaveBeenCalledWith(
			'burner-wallet:keys',
			expect.any(String)
		);
	});

	it('loads keys from localStorage', () => {
		const storage = new BurnerKeyStorage();
		const key = storage.createAccount();

		// Create a new instance - should load from localStorage
		const storage2 = new BurnerKeyStorage();
		expect(storage2.getPrivateKeys()).toEqual([key]);
	});

	it('supports custom storage prefix', () => {
		const storage = new BurnerKeyStorage('custom:');
		storage.createAccount();
		expect(localStorageMock.setItem).toHaveBeenCalledWith(
			'custom:keys',
			expect.any(String)
		);
	});

	it('creates multiple accounts', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		storage.createAccount();
		storage.createAccount();
		expect(storage.getPrivateKeys()).toHaveLength(3);
		expect(storage.getAddresses()).toHaveLength(3);
	});

	it('removes an account by address', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		storage.createAccount();
		const addresses = storage.getAddresses();
		storage.removeAccount(addresses[0]);
		expect(storage.getPrivateKeys()).toHaveLength(1);
		expect(storage.getAddresses()).toEqual([addresses[1]]);
	});

	it('removeAccount is case-insensitive', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		const address = storage.getAddresses()[0];
		storage.removeAccount(address.toUpperCase() as `0x${string}`);
		expect(storage.getPrivateKeys()).toHaveLength(0);
	});

	it('clears all accounts', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		storage.createAccount();
		storage.clear();
		expect(storage.getPrivateKeys()).toEqual([]);
		expect(storage.getAddresses()).toEqual([]);
	});

	it('getPrivateKeys returns a copy', () => {
		const storage = new BurnerKeyStorage();
		storage.createAccount();
		const keys = storage.getPrivateKeys();
		keys.pop();
		expect(storage.getPrivateKeys()).toHaveLength(1);
	});

	it('handles corrupted localStorage gracefully', () => {
		store['burner-wallet:keys'] = 'not-json';
		const storage = new BurnerKeyStorage();
		expect(storage.getPrivateKeys()).toEqual([]);
	});

	it('handles non-hex values in localStorage', () => {
		store['burner-wallet:keys'] = JSON.stringify([
			'not-hex',
			'0xabc123',
		]);
		const storage = new BurnerKeyStorage();
		expect(storage.getPrivateKeys()).toEqual(['0xabc123']);
	});
});
