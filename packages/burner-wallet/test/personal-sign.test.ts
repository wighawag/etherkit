import {describe, it, expect, beforeEach, vi} from 'vitest';
import {recoverMessageAddress, stringToHex, getAddress} from 'viem';
import {createBurnerWalletProvider} from '../src/provider.js';
import type {Hex} from '../src/types.js';

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

/**
 * End-to-end signature checks through the burner wallet itself.
 *
 * The underlying EIP-191 encoding is covered by eip-1193-accounts-wrapper's own
 * tests, but these guard the integration: that the burner wallet is wired to a
 * version of the wrapper that signs recoverably. A dependency downgrade would
 * pass every test in this package except these.
 *
 * This is the property a contract's ecrecover relies on, and it is what blocked
 * signature-verification flows before eip-1193-accounts-wrapper@0.2.0.
 */
describe('burner wallet message signing', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	async function setup() {
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		const accounts = (await provider.request({
			method: 'eth_requestAccounts',
		})) as Hex[];
		return {provider, address: accounts[0]};
	}

	it('produces a signature that recovers to the signing address', async () => {
		const {provider, address} = await setup();
		const message = 'Sign in to confirm you own this address';

		const signature = (await provider.request({
			method: 'personal_sign',
			params: [stringToHex(message), address],
		} as any)) as Hex;

		const recovered = await recoverMessageAddress({message, signature});
		expect(getAddress(recovered)).toBe(getAddress(address));
	});

	it('recovers correctly for multi-byte UTF-8 messages', async () => {
		// Catches an EIP-191 length prefix counting characters instead of bytes.
		const {provider, address} = await setup();
		const message = 'Confirm registration for café 日本 🏴‍☠️';
		expect(new TextEncoder().encode(message).length).not.toBe(message.length);

		const signature = (await provider.request({
			method: 'personal_sign',
			params: [stringToHex(message), address],
		} as any)) as Hex;

		const recovered = await recoverMessageAddress({message, signature});
		expect(getAddress(recovered)).toBe(getAddress(address));
	});

	it('recovers correctly either side of the length-prefix digit boundaries', async () => {
		const {provider, address} = await setup();

		for (const length of [9, 10, 99, 100]) {
			const message = 'a'.repeat(length);
			const signature = (await provider.request({
				method: 'personal_sign',
				params: [stringToHex(message), address],
			} as any)) as Hex;

			const recovered = await recoverMessageAddress({message, signature});
			expect(getAddress(recovered), `length ${length}`).toBe(
				getAddress(address),
			);
		}
	});

	it('accepts a message passed as a plain string as well as hex', async () => {
		const {provider, address} = await setup();
		const message = 'plain string message';

		const asPlain = (await provider.request({
			method: 'personal_sign',
			params: [message, address],
		} as any)) as Hex;
		const asHex = (await provider.request({
			method: 'personal_sign',
			params: [stringToHex(message), address],
		} as any)) as Hex;

		expect(asPlain).toBe(asHex);
		expect(
			getAddress(await recoverMessageAddress({message, signature: asPlain})),
		).toBe(getAddress(address));
	});
});
