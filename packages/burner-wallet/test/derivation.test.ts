import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createBurnerWalletProvider} from '../src/provider.js';
import {ACCOUNT_DERIVATION_PATH, derivePrivateKeys} from '../src/derivation.js';
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

const TEST_MNEMONIC =
	'test test test test test test test test test test test junk';

/**
 * WHAT A NODE SAYS, not what this package thinks a node says.
 *
 * Captured from `anvil --mnemonic "test test ... junk" --accounts 10`, which
 * prints `Derivation path: m/44'/60'/0'/0/`. `hardhat node` prints the same
 * list, as does importing the mnemonic into MetaMask. These are the addresses
 * a developer funds, so they are the addresses this wallet must report.
 */
const ANVIL_ADDRESSES = [
	'0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
	'0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
	'0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
	'0x90F79bf6EB2c4f870365E785982E1f101E93b906',
	'0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
	'0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
	'0x976EA74026E726554dB657fA54763abd0C3a0aa9',
	'0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
	'0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
	'0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
];

/** The first three private keys anvil prints for the same mnemonic. */
const ANVIL_PRIVATE_KEYS = [
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
	'0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];

/**
 * THE ADDRESS THIS WALLET USED TO CALL "ACCOUNT 1", derived at
 * `m/44'/60'/1'/0/0` by walking BIP-44's account level instead of its address
 * level. Kept as a named negative so a regression is reported as what it is,
 * rather than as ten opaque mismatches.
 */
const WRONG_PATH_ACCOUNT_1 = '0x8C8d35429F74ec245F8Ef2f4Fd1e551cFF97d650';

function createFakeNode() {
	return {
		request(args: {method: string; params?: unknown}): Promise<unknown> {
			if (args.method === 'eth_chainId') return Promise.resolve('0x7a69');
			return Promise.reject(new Error(`Method not found: ${args.method}`));
		},
	};
}

describe('account derivation matches the node', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	it('reports exactly the accounts anvil reports, in order', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: createFakeNode(),
		});
		walletManager.importMnemonic(TEST_MNEMONIC);

		const accounts = (await provider.request({
			method: 'eth_accounts',
		})) as Hex[];

		expect(accounts.map((a) => a.toLowerCase())).toEqual(
			ANVIL_ADDRESSES.map((a) => a.toLowerCase()),
		);
	});

	it('does not walk the account level (the bug this replaced)', async () => {
		// Index 0 is IDENTICAL under both paths, which is why the old derivation
		// survived so long: the wallet looked exactly like the node until someone
		// used a second account.
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: createFakeNode(),
		});
		walletManager.importMnemonic(TEST_MNEMONIC);

		const accounts = (await provider.request({
			method: 'eth_accounts',
		})) as Hex[];

		expect(accounts[0].toLowerCase()).toBe(ANVIL_ADDRESSES[0].toLowerCase());
		expect(accounts[1].toLowerCase()).not.toBe(
			WRONG_PATH_ACCOUNT_1.toLowerCase(),
		);
		expect(accounts[1].toLowerCase()).toBe(ANVIL_ADDRESSES[1].toLowerCase());
	});

	it('derives the private keys anvil publishes', () => {
		// Addresses could match while the keys were wrong only if the whole HD
		// derivation were wrong in a way that cancelled out, but these are the
		// values a developer pastes into a script, so they are asserted directly.
		expect(derivePrivateKeys(TEST_MNEMONIC, 3)).toEqual(ANVIL_PRIVATE_KEYS);
	});

	it('derives exactly the requested count, in path order', () => {
		expect(derivePrivateKeys(TEST_MNEMONIC, 1)).toEqual(
			ANVIL_PRIVATE_KEYS.slice(0, 1),
		);
		expect(derivePrivateKeys(TEST_MNEMONIC, 10)).toHaveLength(10);
	});

	it('rejects an invalid mnemonic', () => {
		expect(() => derivePrivateKeys('not a mnemonic', 1)).toThrow();
	});

	it('states the path it implements', () => {
		expect(ACCOUNT_DERIVATION_PATH).toBe("m/44'/60'/0'/0/{index}");
	});
});
