import {describe, it, expect, beforeAll, vi} from 'vitest';
import {
	createPublicClient,
	createWalletClient,
	http,
	parseEther,
	type Address,
	type PublicClient,
	type WalletClient,
	type Chain,
	type Transport,
	type Account,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {
	createTrackedWalletClient,
	type TrackedWalletClient,
	type TrackedTransaction,
	type TransactionMetadata,
} from '../src/index.js';
import {RPC_URL} from './prool/url.js';
import {TEST_CONTRACT_ABI, TEST_CONTRACT_BYTECODE} from './utils/data.js';

/**
 * Optional metadata type for tests - allows metadata to be omitted
 */
type TestMetadata = TransactionMetadata | undefined;

// Anvil's first two test account private keys
const TEST_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_PRIVATE_KEY_2 =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

// Test recipient address (Anvil account 2)
const RECIPIENT_ADDRESS =
	'0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

describe('TrackedWalletClient', () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
	let trackedClient: TrackedWalletClient<TestMetadata, Transport, Chain, Account>;
	let account: ReturnType<typeof privateKeyToAccount>;

	beforeAll(() => {
		account = privateKeyToAccount(TEST_PRIVATE_KEY);

		publicClient = createPublicClient({
			chain: foundry,
			transport: http(RPC_URL),
		});

		walletClient = createWalletClient({
			account,
			chain: foundry,
			transport: http(RPC_URL),
		});

		trackedClient = createTrackedWalletClient<TestMetadata>(walletClient, publicClient);
	});

	describe('sendTransaction', () => {
		it('should send a transaction and return a hash', async () => {
			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.1'),
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});

		it('should send a transaction with metadata', async () => {
			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.05'),
				metadata: {
					id: 'my-custom-id',
					title: 'Test Transfer',
					description: 'A test ETH transfer',
				},
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});

		it('should send a transaction with explicit nonce', async () => {
			// Get current nonce
			const currentNonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce: currentNonce,
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Verify the transaction used the correct nonce
			const tx = await publicClient.getTransaction({hash: txHash});
			expect(tx.nonce).toBe(currentNonce);
		});

		it('should send a transaction with block tag nonce', async () => {
			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce: 'pending', // Use 'pending' block tag
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});
	});

	describe('sendTransactionSync', () => {
		it('should send a transaction and return the receipt', async () => {
			const receipt = await trackedClient.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			expect(receipt.status).toBe('success');
			expect(receipt.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
			expect(receipt.from.toLowerCase()).toBe(account.address.toLowerCase());
		});

		it('should send a transaction with metadata and return the receipt', async () => {
			const receipt = await trackedClient.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					id: 'sync-transfer-id',
					title: 'Sync Transfer',
				},
			});

			expect(receipt.status).toBe('success');
		});
	});

	describe('writeContract', () => {
		let tokenAddress: Address;

		beforeAll(async () => {
			// Deploy the token contract for testing
			// Constructor takes (address to, uint256 amount)
			const deployHash = await walletClient.deployContract({
				abi: TEST_CONTRACT_ABI,
				bytecode: TEST_CONTRACT_BYTECODE,
				args: [account.address, parseEther('1000')],
			});

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});
			tokenAddress = receipt.contractAddress!;
		});

		it('should call a contract function and return a hash', async () => {
			const txHash = await trackedClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('10')],
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});

		it('should call a contract function with metadata', async () => {
			const txHash = await trackedClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('5')],
				metadata: {
					id: 'token-transfer',
					title: 'Token Transfer',
				},
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});
	});

	describe('writeContractSync', () => {
		let tokenAddress: Address;

		beforeAll(async () => {
			// Deploy the token contract for testing
			const deployHash = await walletClient.deployContract({
				abi: TEST_CONTRACT_ABI,
				bytecode: TEST_CONTRACT_BYTECODE,
				args: [account.address, parseEther('1000')],
			});

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});
			tokenAddress = receipt.contractAddress!;
		});

		it('should call a contract function and return the receipt', async () => {
			const receipt = await trackedClient.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('10')],
			});

			expect(receipt.status).toBe('success');
			expect(receipt.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
		});
	});

	describe('sendRawTransaction', () => {
		it('should send a signed raw transaction and return a hash', async () => {
			// Get current nonce
			const nonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			// Sign a transaction
			const signedTx = await walletClient.signTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce,
				gas: 21000n,
				maxFeePerGas: parseEther('0.000000002'), // 2 gwei
				maxPriorityFeePerGas: parseEther('0.000000001'), // 1 gwei
			});

			// Send the raw transaction
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});

		it('should send a signed raw transaction with metadata', async () => {
			// Get current nonce
			const nonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			// Sign a transaction
			const signedTx = await walletClient.signTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce,
				gas: 21000n,
				maxFeePerGas: parseEther('0.000000002'),
				maxPriorityFeePerGas: parseEther('0.000000001'),
			});

			// Send the raw transaction with metadata
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {
					id: 'raw-tx-id',
					title: 'Raw Transaction',
				},
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');
		});
	});

	describe('sendRawTransactionSync', () => {
		it('should send a signed raw transaction and return the receipt', async () => {
			// Get current nonce
			const nonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			// Sign a transaction
			const signedTx = await walletClient.signTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce,
				gas: 21000n,
				maxFeePerGas: parseEther('0.000000002'),
				maxPriorityFeePerGas: parseEther('0.000000001'),
			});

			// Send the raw transaction
			const receipt = await trackedClient.sendRawTransactionSync({
				serializedTransaction: signedTx,
			});

			expect(receipt.status).toBe('success');
			expect(receipt.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
		});
	});

	describe('client access', () => {
		it('should expose the underlying wallet client', () => {
			expect(trackedClient.walletClient).toBe(walletClient);
		});

		it('should expose the public client', () => {
			expect(trackedClient.publicClient).toBe(publicClient);
		});
	});

	describe('error cases', () => {
		it('should throw error when no account is available', async () => {
			// Create a wallet client without an account
			const noAccountWalletClient = createWalletClient({
				chain: foundry,
				transport: http(RPC_URL),
			});

			const noAccountTrackedClient = createTrackedWalletClient<TestMetadata>(
				noAccountWalletClient,
				publicClient,
			);

			await expect(
				//@ts-ignore
				noAccountTrackedClient.sendTransaction({
					to: RECIPIENT_ADDRESS,
					value: parseEther('0.01'),
				}),
			).rejects.toThrow('No account available');
		});
	});

	describe('transaction with account override', () => {
		it('should allow sending transaction with different account', async () => {
			// Create a second account
			const account2 = privateKeyToAccount(TEST_PRIVATE_KEY_2);

			// Create a wallet client without default account
			const noAccountWalletClient = createWalletClient({
				chain: foundry,
				transport: http(RPC_URL),
			});

			const flexibleTrackedClient = createTrackedWalletClient<TestMetadata>(
				noAccountWalletClient,
				publicClient,
			);

			// Send transaction with account specified in the call
			const txHash = await flexibleTrackedClient.sendTransaction({
				account: account2,
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Verify the transaction came from account2
			const tx = await publicClient.getTransaction({hash: txHash});
			expect(tx.from.toLowerCase()).toBe(account2.address.toLowerCase());
		});
	});

	describe('onTransactionBroadcasted', () => {
		it('should emit event when sendTransaction is called', async () => {
			const listener = vi.fn();
			trackedClient.onTransactionBroadcasted(listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					id: 'event-test-id',
					title: 'Event Test',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
				const emittedEvent: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.from.toLowerCase()).toBe(
					account.address.toLowerCase(),
				);
				expect(emittedEvent.metadata?.id).toBe('event-test-id');
				expect(emittedEvent.metadata?.title).toBe('Event Test');
				expect(emittedEvent.metadata?.id).toBe('event-test-id');
				expect(typeof emittedEvent.nonce).toBe('number');
				expect(typeof emittedEvent.broadcastTimestampMs).toBe('number');
	
				// Cleanup
				trackedClient.offTransactionBroadcasted(listener);
			});
	
			it('should emit event when writeContract is called', async () => {
				// Deploy a contract first
				const deployHash = await walletClient.deployContract({
					abi: TEST_CONTRACT_ABI,
					bytecode: TEST_CONTRACT_BYTECODE,
					args: [account.address, parseEther('1000')],
				});
				const receipt = await publicClient.waitForTransactionReceipt({
					hash: deployHash,
				});
				const tokenAddress = receipt.contractAddress!;
	
				const listener = vi.fn();
				trackedClient.onTransactionBroadcasted(listener);
	
				const txHash = await trackedClient.writeContract({
					address: tokenAddress,
					abi: TEST_CONTRACT_ABI,
					functionName: 'transfer',
					args: [RECIPIENT_ADDRESS, parseEther('1')],
					metadata: {
						title: 'Token Transfer Event Test',
					},
				});
	
				expect(listener).toHaveBeenCalledTimes(1);
				const emittedEvent: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.metadata?.title).toBe('Token Transfer Event Test');
	
				// Cleanup
				trackedClient.offTransactionBroadcasted(listener);
			});
	
			it('should emit event when sendRawTransaction is called', async () => {
				const nonce = await publicClient.getTransactionCount({
					address: account.address,
					blockTag: 'pending',
				});
	
				const signedTx = await walletClient.signTransaction({
					to: RECIPIENT_ADDRESS,
					value: parseEther('0.01'),
					nonce,
					gas: 21000n,
					maxFeePerGas: parseEther('0.000000002'),
					maxPriorityFeePerGas: parseEther('0.000000001'),
				});
	
				const listener = vi.fn();
				trackedClient.onTransactionBroadcasted(listener);
	
				const txHash = await trackedClient.sendRawTransaction({
					serializedTransaction: signedTx,
					metadata: {
						id: 'raw-event-test',
					},
				});
	
				expect(listener).toHaveBeenCalledTimes(1);
				const emittedEvent: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.nonce).toBe(nonce);
				expect(emittedEvent.metadata?.id).toBe('raw-event-test');
	
				// Cleanup
				trackedClient.offTransactionBroadcasted(listener);
			});
	
			it('should stop receiving events after offTransactionBroadcasted is called', async () => {
				const listener = vi.fn();
				trackedClient.onTransactionBroadcasted(listener);
	
				// First transaction should trigger event
				await trackedClient.sendTransaction({
					to: RECIPIENT_ADDRESS,
					value: parseEther('0.001'),
				});
				expect(listener).toHaveBeenCalledTimes(1);
	
				// Unsubscribe
				trackedClient.offTransactionBroadcasted(listener);
	
				// Second transaction should NOT trigger event
				await trackedClient.sendTransaction({
					to: RECIPIENT_ADDRESS,
					value: parseEther('0.001'),
				});
				expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
			});
	
			it('should generate trackingId when metadata.id is not provided', async () => {
				const listener = vi.fn();
				trackedClient.onTransactionBroadcasted(listener);
	
				await trackedClient.sendTransaction({
					to: RECIPIENT_ADDRESS,
					value: parseEther('0.001'),
					// No metadata.id provided
				});
	
				const emittedEvent: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
				expect(emittedEvent.metadata).toBeDefined();
	
				// Cleanup
				trackedClient.offTransactionBroadcasted(listener);
			});
		});
	});
