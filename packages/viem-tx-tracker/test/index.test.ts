import {describe, it, expect} from 'vitest';
import {
	createPublicClient,
	createWalletClient,
	http,
	parseEther,
	type Address,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {createTrackedWalletClient} from '../src/index.js';
import {RPC_URL} from './prool/url.js';

// Anvil's first test account private key
const TEST_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

describe('TrackedWalletClient', () => {
	it('should send a transaction and return a hash', async () => {
		// Create viem clients
		const account = privateKeyToAccount(TEST_PRIVATE_KEY);

		const publicClient = createPublicClient({
			chain: foundry,
			transport: http(RPC_URL),
		});

		const walletClient = createWalletClient({
			account,
			chain: foundry,
			transport: http(RPC_URL),
		});

		// Create tracked wallet client
		const trackedClient = createTrackedWalletClient(walletClient, publicClient);

		// Send a simple ETH transfer
		const recipientAddress =
			'0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

		const txHash = await trackedClient.sendTransaction({
			to: recipientAddress,
			value: parseEther('0.1'),
		});

		// Verify we got a valid transaction hash
		expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

		// Verify the transaction is on chain
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
		});
		expect(receipt.status).toBe('success');
	});
});
