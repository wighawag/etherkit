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
	type TrackedWalletClientAutoPopulate,
	type TrackedTransaction,
	type KnownTrackedTransaction,
	type UnknownTrackedTransaction,
	type PopulatedMetadata,
	type FunctionCallMetadata,
} from '../src/index.js';
import {RPC_URL} from './prool/url.js';
import {TEST_CONTRACT_ABI, TEST_CONTRACT_BYTECODE} from './utils/data.js';
import {TestTransactionMetadata} from './utils/types.js';

/**
 * Optional metadata type for tests - allows metadata to be omitted
 */
type TestMetadata = TestTransactionMetadata | undefined;

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
	let trackedClient: TrackedWalletClient<
		TestMetadata,
		Transport,
		Chain,
		Account
	>;
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

		trackedClient = createTrackedWalletClient<TestMetadata>().using(
			walletClient,
			publicClient,
		);
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

			const noAccountTrackedClient =
				createTrackedWalletClient<TestMetadata>().using(
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

			const flexibleTrackedClient =
				createTrackedWalletClient<TestMetadata>().using(
					noAccountWalletClient,
					publicClient,
				);

			// Send transaction with account specified in the call
			const txHash = await flexibleTrackedClient.sendTransaction({
				account: account2,
				chain: foundry,
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Verify the transaction came from account2
			const tx = await publicClient.getTransaction({hash: txHash});
			expect(tx.from.toLowerCase()).toBe(account2.address.toLowerCase());
		});
	});

	describe('on/off event subscription', () => {
		it('should emit event when sendTransaction is called', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					id: 'event-test-id',
					title: 'Event Test',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];
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
			trackedClient.off('transaction:broadcasted', listener);
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
			trackedClient.on('transaction:broadcasted', listener);

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
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];
			expect(emittedEvent.hash).toBe(txHash);
			expect(emittedEvent.metadata?.title).toBe('Token Transfer Event Test');

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);
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
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {
					id: 'raw-event-test',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];
			expect(emittedEvent.hash).toBe(txHash);
			expect(emittedEvent.nonce).toBe(nonce);
			expect(emittedEvent.metadata?.id).toBe('raw-event-test');

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);
		});

		it('should stop receiving events after off is called', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			// First transaction should trigger event
			await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
			});
			expect(listener).toHaveBeenCalledTimes(1);

			// Unsubscribe
			trackedClient.off('transaction:broadcasted', listener);

			// Second transaction should NOT trigger event
			await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
			});
			expect(listener).toHaveBeenCalledTimes(1); // Still 1, not 2
		});

		it('should have undefined metadata when not provided (with optional TMetadata)', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
				// No metadata provided - with TMetadata = TransactionMetadata | undefined, this is allowed
			});

			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];
			// When TMetadata includes undefined and metadata is not provided, it will be undefined
			expect(emittedEvent.metadata).toBeUndefined();

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);
		});
	});
});

describe('TrackedWalletClient with populateMetadata', () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
	let autoPopulateClient: TrackedWalletClientAutoPopulate<
		PopulatedMetadata,
		Transport,
		Chain,
		Account
	>;
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

		// Create client with populateMetadata: true
		autoPopulateClient = createTrackedWalletClient({
			populateMetadata: true,
		}).using(walletClient, publicClient);
	});

	describe('writeContract with auto-populate', () => {
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

		it('should auto-populate operation, functionName and args in metadata', async () => {
			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const txHash = await autoPopulateClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('10')],
				// No metadata needed - operation, functionName and args are auto-populated
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');

			// Verify metadata was auto-populated with FunctionCallMetadata
			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<FunctionCallMetadata> =
				listener.mock.calls[0][0];
			expect(emittedEvent.metadata.type).toBe('functionCall');
			expect(emittedEvent.metadata.functionName).toBe('transfer');
			expect(emittedEvent.metadata.args).toEqual([
				RECIPIENT_ADDRESS,
				parseEther('10'),
			]);

			// Cleanup
			autoPopulateClient.off('transaction:broadcasted', listener);
		});

		it('should throw if functionName is provided in metadata', async () => {
			await expect(
				autoPopulateClient.writeContract({
					address: tokenAddress,
					abi: TEST_CONTRACT_ABI,
					functionName: 'transfer',
					args: [RECIPIENT_ADDRESS, parseEther('5')],
					// @ts-expect-error - TypeScript should prevent this, but we test runtime behavior
					metadata: {functionName: 'shouldNotBeAllowed'},
				}),
			).rejects.toThrow('Cannot specify functionName in metadata');
		});

		it('should throw if args is provided in metadata', async () => {
			await expect(
				autoPopulateClient.writeContract({
					address: tokenAddress,
					abi: TEST_CONTRACT_ABI,
					functionName: 'transfer',
					args: [RECIPIENT_ADDRESS, parseEther('5')],
					// @ts-expect-error - TypeScript should prevent this, but we test runtime behavior
					metadata: {args: ['shouldNotBeAllowed']},
				}),
			).rejects.toThrow('Cannot specify args in metadata');
		});

		it('should throw if type is provided in metadata', async () => {
			await expect(
				autoPopulateClient.writeContract({
					address: tokenAddress,
					abi: TEST_CONTRACT_ABI,
					functionName: 'transfer',
					args: [RECIPIENT_ADDRESS, parseEther('5')],
					// @ts-expect-error - TypeScript should prevent this, but we test runtime behavior
					metadata: {type: 'shouldNotBeAllowed'},
				}),
			).rejects.toThrow('Cannot specify type in metadata');
		});
	});

	describe('writeContractSync with auto-populate', () => {
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

		it('should auto-populate operation, functionName and args in metadata', async () => {
			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const receipt = await autoPopulateClient.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('10')],
			});

			expect(receipt.status).toBe('success');

			// Verify metadata was auto-populated with FunctionCallMetadata
			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<FunctionCallMetadata> =
				listener.mock.calls[0][0];
			expect(emittedEvent.metadata.type).toBe('functionCall');
			expect(emittedEvent.metadata.functionName).toBe('transfer');
			expect(emittedEvent.metadata.args).toEqual([
				RECIPIENT_ADDRESS,
				parseEther('10'),
			]);

			// Cleanup
			autoPopulateClient.off('transaction:broadcasted', listener);
		});
	});

	describe('sendTransaction still requires full metadata', () => {
		it('should require full metadata for sendTransaction using unknown operation', async () => {
			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const txHash = await autoPopulateClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					type: 'unknown',
					name: 'ETH transfer',
					data: [],
				},
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			const receipt = await publicClient.waitForTransactionReceipt({
				hash: txHash,
			});
			expect(receipt.status).toBe('success');

			// Verify metadata was passed through
			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent = listener.mock
				.calls[0][0] as TrackedTransaction<PopulatedMetadata>;
			expect(emittedEvent.metadata).toEqual({
				type: 'unknown',
				name: 'ETH transfer',
				data: [],
			});

			// Cleanup
			autoPopulateClient.off('transaction:broadcasted', listener);
		});
	});

	describe('extended metadata with populateMetadata', () => {
		// Extended metadata that includes FunctionCallMetadata as part of a union
		type ExtendedFunctionCallMetadata = FunctionCallMetadata & {
			purpose: string;
			priority?: number;
		};
		type ExtendedMetadata =
			| ExtendedFunctionCallMetadata
			| {
					type: 'unknown';
					name: string;
					data: any[];
					purpose: string;
					priority?: number;
			  };

		let extendedClient: TrackedWalletClientAutoPopulate<
			ExtendedMetadata,
			Transport,
			Chain,
			Account
		>;
		let tokenAddress: Address;

		beforeAll(async () => {
			extendedClient = createTrackedWalletClient<ExtendedMetadata>({
				populateMetadata: true,
			}).using(walletClient, publicClient);

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

		it('should require extended fields but auto-populate operation, functionName and args', async () => {
			const listener = vi.fn();
			extendedClient.on('transaction:broadcasted', listener);

			const txHash = await extendedClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('5')],
				metadata: {
					purpose: 'Token swap', // Required extended field
					priority: 1, // Optional extended field
				},
			});

			expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

			// Verify metadata includes both auto-populated and user-provided fields
			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<ExtendedFunctionCallMetadata> =
				listener.mock.calls[0][0];
			expect(emittedEvent.metadata.type).toBe('functionCall');
			expect(emittedEvent.metadata.functionName).toBe('transfer');
			expect(emittedEvent.metadata.args).toEqual([
				RECIPIENT_ADDRESS,
				parseEther('5'),
			]);
			expect(emittedEvent.metadata.purpose).toBe('Token swap');
			expect(emittedEvent.metadata.priority).toBe(1);

			// Cleanup
			extendedClient.off('transaction:broadcasted', listener);
		});
	});
});

describe('TrackedTransaction Discriminated Union', () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
	let trackedClient: TrackedWalletClient<
		TestMetadata,
		Transport,
		Chain,
		Account
	>;
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

		trackedClient = createTrackedWalletClient<TestMetadata>().using(
			walletClient,
			publicClient,
		);
	});

	describe('transaction:broadcasted with known=false (sendTransaction/writeContract)', () => {
		it('should emit UnknownTrackedTransaction with known=false for sendTransaction', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					id: 'unknown-tx-test',
					title: 'Unknown TX Test',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			// Type narrowing should work
			expect(emittedEvent.known).toBe(false);
			if (!emittedEvent.known) {
				// TypeScript knows this is UnknownTrackedTransaction
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.to).toBe(RECIPIENT_ADDRESS);
				expect(emittedEvent.value).toBe(parseEther('0.01'));
				expect(typeof emittedEvent.nonce).toBe('number');
				expect(emittedEvent.metadata?.id).toBe('unknown-tx-test');
			}

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);

			// Wait for receipt to ensure tx is processed
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include intended gas params in UnknownTrackedTransaction', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				maxFeePerGas: parseEther('0.000000002'), // 2 gwei
				maxPriorityFeePerGas: parseEther('0.000000001'), // 1 gwei
			});

			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			expect(emittedEvent.known).toBe(false);
			if (!emittedEvent.known) {
				expect(emittedEvent.txType).toBe('eip1559');
				if (emittedEvent.txType === 'eip1559') {
					expect(emittedEvent.gasParameters.maxFeePerGas).toBe(
						parseEther('0.000000002'),
					);
					expect(emittedEvent.gasParameters.maxPriorityFeePerGas).toBe(
						parseEther('0.000000001'),
					);
				}
			}

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should emit UnknownTrackedTransaction with known=false for writeContract', async () => {
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
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				metadata: {
					title: 'Token Transfer',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			expect(emittedEvent.known).toBe(false);
			if (!emittedEvent.known) {
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.to).toBe(tokenAddress);
				expect(emittedEvent.value).toBe(0n);
				expect(emittedEvent.metadata?.title).toBe('Token Transfer');
			}

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('transaction:broadcasted with known=true (sendRawTransaction)', () => {
		it('should emit KnownTrackedTransaction with known=true for sendRawTransaction', async () => {
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
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {
					id: 'known-tx-test',
				},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			// Type narrowing should work
			expect(emittedEvent.known).toBe(true);
			if (emittedEvent.known) {
				// TypeScript knows this is KnownTrackedTransaction
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.to?.toLowerCase()).toBe(
					RECIPIENT_ADDRESS.toLowerCase(),
				);
				expect(emittedEvent.value).toBe(parseEther('0.01'));
				expect(emittedEvent.gasParameters.gas).toBe(21000n);
				expect(emittedEvent.nonce).toBe(nonce);
				expect(emittedEvent.metadata?.id).toBe('known-tx-test');
				expect(emittedEvent.txType).toBe('eip1559');
				if (emittedEvent.txType === 'eip1559') {
					expect(emittedEvent.gasParameters.maxFeePerGas).toBe(
						parseEther('0.000000002'),
					);
					expect(emittedEvent.gasParameters.maxPriorityFeePerGas).toBe(
						parseEther('0.000000001'),
					);
				}
			}

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include all transaction data from parsed raw tx', async () => {
			const nonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			const signedTx = await walletClient.signTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.05'),
				data: '0x1234',
				nonce,
				gas: 30000n,
				maxFeePerGas: parseEther('0.000000003'),
				maxPriorityFeePerGas: parseEther('0.000000002'),
			});

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			expect(emittedEvent.known).toBe(true);
			if (emittedEvent.known) {
				expect(emittedEvent.hash).toBe(txHash);
				expect(emittedEvent.to?.toLowerCase()).toBe(
					RECIPIENT_ADDRESS.toLowerCase(),
				);
				expect(emittedEvent.value).toBe(parseEther('0.05'));
				expect(emittedEvent.data).toBe('0x1234');
				expect(emittedEvent.gasParameters.gas).toBe(30000n);
				expect(emittedEvent.nonce).toBe(nonce);
				expect(emittedEvent.from.toLowerCase()).toBe(
					account.address.toLowerCase(),
				);
			}

			// Cleanup
			trackedClient.off('transaction:broadcasted', listener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('transaction:fetched event', () => {
		it('should emit KnownTrackedTransaction via transaction:fetched for sendTransaction', async () => {
			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();

			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {
					id: 'fetched-event-test',
				},
			});

			// Wait for the async fetch to complete
			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			// transaction:broadcasted should have known=false
			expect(broadcastListener).toHaveBeenCalledTimes(1);
			const broadcastEvent: TrackedTransaction<TestMetadata> =
				broadcastListener.mock.calls[0][0];
			expect(broadcastEvent.known).toBe(false);

			// transaction:fetched should have known=true with full data
			expect(fetchedListener).toHaveBeenCalledTimes(1);
			const fetchedEvent: KnownTrackedTransaction<TestMetadata> =
				fetchedListener.mock.calls[0][0];
			expect(fetchedEvent.known).toBe(true);
			expect(fetchedEvent.hash).toBe(txHash);
			expect(fetchedEvent.metadata?.id).toBe('fetched-event-test');
			expect(typeof fetchedEvent.gasParameters.gas).toBe('bigint');
			expect(typeof fetchedEvent.nonce).toBe('number');
			expect(fetchedEvent.txType).toBeDefined();

			// Cleanup
			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should emit transaction:fetched for sendRawTransaction', async () => {
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

			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();

			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {
					id: 'raw-fetched-test',
				},
			});

			// For raw transactions, both events should fire immediately
			// (no async fetch needed)
			expect(broadcastListener).toHaveBeenCalledTimes(1);
			expect(fetchedListener).toHaveBeenCalledTimes(1);

			// Both should have the same known tx data
			const broadcastEvent: TrackedTransaction<TestMetadata> =
				broadcastListener.mock.calls[0][0];
			const fetchedEvent: KnownTrackedTransaction<TestMetadata> =
				fetchedListener.mock.calls[0][0];

			expect(broadcastEvent.known).toBe(true);
			expect(fetchedEvent.known).toBe(true);
			expect(broadcastEvent.hash).toBe(fetchedEvent.hash);

			// Cleanup
			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should allow unsubscribing from transaction:fetched', async () => {
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:fetched', fetchedListener);

			// First transaction
			const txHash1 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
			});

			// Wait for async fetch
			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			// Unsubscribe
			trackedClient.off('transaction:fetched', fetchedListener);

			// Second transaction
			const txHash2 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
			});

			// Asserting an absence: give the fetch every chance to fire first by
			// waiting for the tx to be mined, then a further grace period.
			await publicClient.waitForTransactionReceipt({hash: txHash2});
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(fetchedListener).toHaveBeenCalledTimes(1); // Still 1, not 2

			await publicClient.waitForTransactionReceipt({hash: txHash1});
		});
	});

	describe('txType discriminated union', () => {
		it('should correctly identify eip1559 transactions', async () => {
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
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			expect(emittedEvent.known).toBe(true);
			if (emittedEvent.known) {
				expect(emittedEvent.txType).toBe('eip1559');

				// Type narrowing on txType
				if (emittedEvent.txType === 'eip1559') {
					// TypeScript knows maxFeePerGas and maxPriorityFeePerGas exist
					expect(typeof emittedEvent.gasParameters.maxFeePerGas).toBe('bigint');
					expect(typeof emittedEvent.gasParameters.maxPriorityFeePerGas).toBe(
						'bigint',
					);
				}
			}

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should preserve accessList for eip1559 transactions', async () => {
			const nonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});

			// EIP-1559 with access list
			const signedTx = await walletClient.signTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce,
				gas: 30000n,
				maxFeePerGas: parseEther('0.000000002'),
				maxPriorityFeePerGas: parseEther('0.000000001'),
				accessList: [
					{
						address: RECIPIENT_ADDRESS,
						storageKeys: [
							'0x0000000000000000000000000000000000000000000000000000000000000001',
						],
					},
				],
			});

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			const emittedEvent: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];

			expect(emittedEvent.known).toBe(true);
			if (emittedEvent.known) {
				expect(emittedEvent.txType).toBe('eip1559');
				if (emittedEvent.txType === 'eip1559') {
					expect(emittedEvent.accessList).toBeDefined();
					expect(emittedEvent.accessList?.length).toBeGreaterThan(0);
				}
			}

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});
});

/**
 * The source is an opaque marker of which signing route produced a transaction.
 * The tracker carries it and never interprets it.
 */
describe('transaction source', () => {
	type TestSource = 'connected-wallet' | 'local-signer' | 'payer-wallet';

	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
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
	});

	function clientWithSource(
		source: TestSource | (() => TestSource),
	): TrackedWalletClient<TestMetadata, Transport, Chain, Account, TestSource> {
		return createTrackedWalletClient<TestMetadata, TestSource>({
			source,
		}).using(walletClient, publicClient);
	}

	async function signRawTransaction() {
		const nonce = await publicClient.getTransactionCount({
			address: account.address,
			blockTag: 'pending',
		});
		return await walletClient.signTransaction({
			to: RECIPIENT_ADDRESS,
			value: parseEther('0.01'),
			nonce,
			gas: 21000n,
			maxFeePerGas: parseEther('0.000000002'),
			maxPriorityFeePerGas: parseEther('0.000000001'),
		});
	}

	describe('value source', () => {
		it('should include the source in transaction:broadcasted', async () => {
			const trackedClient = clientWithSource('local-signer');
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {id: 'source-broadcasted'},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata, TestSource> =
				listener.mock.calls[0][0];
			expect(event.source).toBe('local-signer');
			// source is a sibling of metadata, never nested inside it
			expect(event.metadata).toEqual({id: 'source-broadcasted'});

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include the source in transaction:fetched (survives the unknown-to-known rebuild)', async () => {
			const trackedClient = clientWithSource('payer-wallet');
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {id: 'source-fetched'},
			});

			// Wait for the async fetch to complete
			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			const event: KnownTrackedTransaction<TestMetadata, TestSource> =
				fetchedListener.mock.calls[0][0];
			expect(event.known).toBe(true);
			expect(event.hash).toBe(txHash);
			expect(event.source).toBe('payer-wallet');

			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include the source on both events for sendRawTransaction', async () => {
			const trackedClient = clientWithSource('connected-wallet');
			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {id: 'source-raw'},
			});

			expect(broadcastListener).toHaveBeenCalledTimes(1);
			expect(fetchedListener).toHaveBeenCalledTimes(1);

			const broadcastEvent: TrackedTransaction<TestMetadata, TestSource> =
				broadcastListener.mock.calls[0][0];
			const fetchedEvent: KnownTrackedTransaction<TestMetadata, TestSource> =
				fetchedListener.mock.calls[0][0];
			expect(broadcastEvent.source).toBe('connected-wallet');
			expect(fetchedEvent.source).toBe('connected-wallet');

			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include the source for writeContractSync', async () => {
			const trackedClient = clientWithSource('local-signer');
			const deployHash = await walletClient.deployContract({
				abi: TEST_CONTRACT_ABI,
				bytecode: TEST_CONTRACT_BYTECODE,
				args: [account.address, parseEther('1000')],
			});
			const deployReceipt = await publicClient.waitForTransactionReceipt({
				hash: deployHash,
			});
			const tokenAddress = deployReceipt.contractAddress!;

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			await trackedClient.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('10')],
				metadata: {id: 'source-write-contract'},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata, TestSource> =
				listener.mock.calls[0][0];
			expect(event.source).toBe('local-signer');

			trackedClient.off('transaction:broadcasted', listener);
		});

		it('should include the source in auto-populate mode, on both events', async () => {
			const trackedClient = createTrackedWalletClient<
				PopulatedMetadata,
				TestSource
			>({
				populateMetadata: true,
				source: 'payer-wallet',
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {type: 'unknown', name: 'transfer', data: []},
			});

			// Wait for the async fetch to complete
			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata, TestSource> =
				listener.mock.calls[0][0];
			expect(event.source).toBe('payer-wallet');

			// the auto-populate builder rebuilds the fetched tx in its own copy of
			// the code path, so it is checked separately from the standard builder
			const fetchedEvent: KnownTrackedTransaction<
				PopulatedMetadata,
				TestSource
			> = fetchedListener.mock.calls[0][0];
			expect(fetchedEvent.known).toBe(true);
			expect(fetchedEvent.hash).toBe(txHash);
			expect(fetchedEvent.source).toBe('payer-wallet');

			trackedClient.off('transaction:broadcasted', listener);
			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should include the source on the auto-populate sendRawTransaction path', async () => {
			const trackedClient = createTrackedWalletClient<
				PopulatedMetadata,
				TestSource
			>({
				populateMetadata: true,
				source: 'connected-wallet',
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {type: 'unknown', name: 'raw-transfer', data: []},
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata, TestSource> =
				listener.mock.calls[0][0];
			expect(event.known).toBe(true);
			expect(event.source).toBe('connected-wallet');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('thunk source', () => {
		it('should not evaluate the thunk at construction, only at dispatch', async () => {
			const thunk = vi.fn(() => 'local-signer' as const);

			const trackedClient = createTrackedWalletClient<TestMetadata, TestSource>(
				{source: thunk},
			).using(walletClient, publicClient);

			// Constructing the client (and the builder) must not call the thunk
			expect(thunk).not.toHaveBeenCalled();

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			expect(thunk).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata, TestSource> =
				listener.mock.calls[0][0];
			expect(event.source).toBe('local-signer');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('should re-evaluate the thunk on every send', async () => {
			const sources: TestSource[] = ['connected-wallet', 'payer-wallet'];
			let index = 0;
			const trackedClient = createTrackedWalletClient<TestMetadata, TestSource>(
				{
					source: () => sources[index++],
				},
			).using(walletClient, publicClient);

			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash1 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});
			const txHash2 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			expect(listener).toHaveBeenCalledTimes(2);
			const first: TrackedTransaction<TestMetadata, TestSource> =
				listener.mock.calls[0][0];
			const second: TrackedTransaction<TestMetadata, TestSource> =
				listener.mock.calls[1][0];
			expect(first.source).toBe('connected-wallet');
			expect(second.source).toBe('payer-wallet');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash1});
			await publicClient.waitForTransactionReceipt({hash: txHash2});
		});

		it('should re-evaluate the thunk for sendRawTransaction too', async () => {
			const thunk = vi.fn(() => 'payer-wallet' as const);
			const trackedClient = createTrackedWalletClient<TestMetadata, TestSource>(
				{source: thunk},
			).using(walletClient, publicClient);

			const fetchedListener = vi.fn();
			trackedClient.on('transaction:fetched', fetchedListener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			expect(thunk).toHaveBeenCalledTimes(1);
			const event: KnownTrackedTransaction<TestMetadata, TestSource> =
				fetchedListener.mock.calls[0][0];
			expect(event.source).toBe('payer-wallet');

			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('default (no source)', () => {
		it('should carry an undefined source when TSource is left at its default', async () => {
			const trackedClient = createTrackedWalletClient<TestMetadata>().using(
				walletClient,
				publicClient,
			);

			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			const broadcastEvent: TrackedTransaction<TestMetadata> =
				broadcastListener.mock.calls[0][0];
			const fetchedEvent: KnownTrackedTransaction<TestMetadata> =
				fetchedListener.mock.calls[0][0];
			// the field is present and undefined, not missing
			expect('source' in broadcastEvent).toBe(true);
			expect('source' in fetchedEvent).toBe(true);
			expect(broadcastEvent.source).toBeUndefined();
			expect(fetchedEvent.source).toBeUndefined();

			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});
});

/**
 * The correlation is an opaque, per-call marker tying a send back to the
 * caller-side request that issued it. The tracker carries it and never
 * interprets it, and it must never reach the underlying viem call.
 */
describe('transaction correlation', () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
	let account: ReturnType<typeof privateKeyToAccount>;
	let trackedClient: TrackedWalletClient<
		TestMetadata,
		Transport,
		Chain,
		Account
	>;
	let tokenAddress: Address;

	beforeAll(async () => {
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

		trackedClient = createTrackedWalletClient<TestMetadata>().using(
			walletClient,
			publicClient,
		);

		const deployHash = await walletClient.deployContract({
			abi: TEST_CONTRACT_ABI,
			bytecode: TEST_CONTRACT_BYTECODE,
			args: [account.address, parseEther('1000')],
		});
		const deployReceipt = await publicClient.waitForTransactionReceipt({
			hash: deployHash,
		});
		tokenAddress = deployReceipt.contractAddress!;
	});

	async function signRawTransaction() {
		const nonce = await publicClient.getTransactionCount({
			address: account.address,
			blockTag: 'pending',
		});
		return await walletClient.signTransaction({
			to: RECIPIENT_ADDRESS,
			value: parseEther('0.01'),
			nonce,
			gas: 21000n,
			maxFeePerGas: parseEther('0.000000002'),
			maxPriorityFeePerGas: parseEther('0.000000001'),
		});
	}

	/**
	 * A wallet client that records the parameter object it is handed, then
	 * delegates to the real one. This is the only way to see what the tracker
	 * actually forwards to viem.
	 */
	function createSpyingWalletClient() {
		const calls: {method: string; args: Record<string, unknown>}[] = [];

		const record =
			<TArgs extends Record<string, unknown>, TResult>(
				method: string,
				delegate: (args: TArgs) => Promise<TResult>,
			) =>
			(args: TArgs) => {
				calls.push({method, args});
				return delegate(args);
			};

		const spy = {
			...walletClient,
			writeContract: record('writeContract', (args: any) =>
				walletClient.writeContract(args),
			),
			writeContractSync: record('writeContractSync', (args: any) =>
				walletClient.writeContractSync(args),
			),
			sendTransaction: record('sendTransaction', (args: any) =>
				walletClient.sendTransaction(args),
			),
			sendTransactionSync: record('sendTransactionSync', (args: any) =>
				walletClient.sendTransactionSync(args),
			),
			sendRawTransaction: record('sendRawTransaction', (args: any) =>
				walletClient.sendRawTransaction(args),
			),
			sendRawTransactionSync: record('sendRawTransactionSync', (args: any) =>
				walletClient.sendRawTransactionSync(args),
			),
		} as unknown as WalletClient<Transport, Chain, Account>;

		const spyTracked = createTrackedWalletClient<TestMetadata>().using(
			spy,
			publicClient,
		);

		// the two builders are hand-duplicated near-clones, so the auto-populate
		// one has to be spied on separately: a missed destructure there would not
		// show up in the standard one
		const spyAutoTracked = createTrackedWalletClient({
			populateMetadata: true,
		}).using(spy, publicClient);

		return {calls, spyTracked, spyAutoTracked};
	}

	/**
	 * Assert that what the tracker handed viem is free of the correlation.
	 * `in` rather than `=== undefined`: a forwarded-but-undefined key is still a
	 * key the wallet did not ask for.
	 */
	function expectNoCorrelationForwarded(
		calls: {method: string; args: Record<string, unknown>}[],
		expectedMethods: string[],
	) {
		// a control: if the spy were mis-wired, calls would be empty and every
		// assertion below would vacuously pass
		expect(calls.map((c) => c.method)).toEqual(expectedMethods);
		for (const call of calls) {
			expect('correlation' in call.args).toBe(false);
			expect(call.args.correlation).toBeUndefined();
		}
	}

	describe('reaches transaction:broadcasted unchanged', () => {
		it('for sendTransaction', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-send-transaction',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-send-transaction');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for sendTransactionSync', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			await trackedClient.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-send-transaction-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-send-transaction-sync');

			trackedClient.off('transaction:broadcasted', listener);
		});

		it('for writeContract', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-write-contract',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-write-contract');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for writeContractSync', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			await trackedClient.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-write-contract-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-write-contract-sync');

			trackedClient.off('transaction:broadcasted', listener);
		});

		it('for sendRawTransaction', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				correlation: 'op-send-raw',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-send-raw');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for sendRawTransactionSync', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			await trackedClient.sendRawTransactionSync({
				serializedTransaction: signedTx,
				correlation: 'op-send-raw-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-send-raw-sync');

			trackedClient.off('transaction:broadcasted', listener);
		});

		it('for writeContract in auto-populate mode', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const txHash = await autoPopulateClient.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-auto-write-contract',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata> =
				listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-auto-write-contract');
			// the auto-populated metadata is untouched by the correlation
			expect(event.metadata).toEqual({
				type: 'functionCall',
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
			});

			autoPopulateClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for writeContractSync in auto-populate mode', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			await autoPopulateClient.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-auto-write-contract-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata> =
				listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-auto-write-contract-sync');

			autoPopulateClient.off('transaction:broadcasted', listener);
		});

		it('for sendTransactionSync in auto-populate mode', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			await autoPopulateClient.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {type: 'unknown', name: 'transfer', data: []},
				correlation: 'op-auto-send-transaction-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata> =
				listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-auto-send-transaction-sync');

			autoPopulateClient.off('transaction:broadcasted', listener);
		});

		it('for sendRawTransactionSync in auto-populate mode', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			await autoPopulateClient.sendRawTransactionSync({
				serializedTransaction: signedTx,
				metadata: {type: 'unknown', name: 'raw-transfer', data: []},
				correlation: 'op-auto-send-raw-sync',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata> =
				listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-auto-send-raw-sync');

			autoPopulateClient.off('transaction:broadcasted', listener);
		});

		it('for sendRawTransaction in auto-populate mode', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const listener = vi.fn();
			autoPopulateClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			const txHash = await autoPopulateClient.sendRawTransaction({
				serializedTransaction: signedTx,
				metadata: {type: 'unknown', name: 'raw-transfer', data: []},
				correlation: 'op-auto-send-raw',
			});

			expect(listener).toHaveBeenCalledTimes(1);
			const event: TrackedTransaction<PopulatedMetadata> =
				listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-auto-send-raw');

			autoPopulateClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('reaches transaction:fetched unchanged', () => {
		it('survives the unknown-to-known rebuild for sendTransaction', async () => {
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-fetched',
			});

			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			const event: KnownTrackedTransaction<TestMetadata> =
				fetchedListener.mock.calls[0][0];
			expect(event.known).toBe(true);
			expect(event.hash).toBe(txHash);
			expect(event.correlation).toBe('op-fetched');

			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('is carried on both events for sendRawTransaction', async () => {
			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
				correlation: 'op-raw-both-events',
			});

			expect(broadcastListener).toHaveBeenCalledTimes(1);
			expect(fetchedListener).toHaveBeenCalledTimes(1);
			expect(broadcastListener.mock.calls[0][0].correlation).toBe(
				'op-raw-both-events',
			);
			expect(fetchedListener.mock.calls[0][0].correlation).toBe(
				'op-raw-both-events',
			);

			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('survives the rebuild in auto-populate mode too', async () => {
			const autoPopulateClient = createTrackedWalletClient({
				populateMetadata: true,
			}).using(walletClient, publicClient);

			const fetchedListener = vi.fn();
			autoPopulateClient.on('transaction:fetched', fetchedListener);

			const txHash = await autoPopulateClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {type: 'unknown', name: 'transfer', data: []},
				correlation: 'op-auto-fetched',
			});

			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			const event: KnownTrackedTransaction<PopulatedMetadata> =
				fetchedListener.mock.calls[0][0];
			expect(event.hash).toBe(txHash);
			expect(event.correlation).toBe('op-auto-fetched');

			autoPopulateClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('when not supplied', () => {
		it('is undefined on both events, and not an error', async () => {
			const broadcastListener = vi.fn();
			const fetchedListener = vi.fn();
			trackedClient.on('transaction:broadcasted', broadcastListener);
			trackedClient.on('transaction:fetched', fetchedListener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
			});

			await vi.waitFor(() => expect(fetchedListener).toHaveBeenCalledTimes(1), {
				timeout: 10000,
				interval: 50,
			});

			const broadcastEvent: TrackedTransaction<TestMetadata> =
				broadcastListener.mock.calls[0][0];
			const fetchedEvent: KnownTrackedTransaction<TestMetadata> =
				fetchedListener.mock.calls[0][0];
			expect(broadcastEvent.correlation).toBeUndefined();
			expect(fetchedEvent.correlation).toBeUndefined();

			trackedClient.off('transaction:broadcasted', broadcastListener);
			trackedClient.off('transaction:fetched', fetchedListener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('is undefined for sendRawTransaction as well', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const signedTx = await signRawTransaction();
			const txHash = await trackedClient.sendRawTransaction({
				serializedTransaction: signedTx,
			});

			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBeUndefined();

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	/**
	 * The regression that would otherwise surface as a wallet rejecting an
	 * unknown field: the correlation must be destructured out of the args before
	 * the rest is spread into viem's own call.
	 */
	describe('is not forwarded to the underlying viem call', () => {
		it('for sendTransaction and sendTransactionSync', async () => {
			const {calls, spyTracked} = createSpyingWalletClient();

			const txHash = await spyTracked.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-not-forwarded-send',
			});
			await spyTracked.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-not-forwarded-send-sync',
			});

			expectNoCorrelationForwarded(calls, [
				'sendTransaction',
				'sendTransactionSync',
			]);
			for (const call of calls) {
				// the spy really did see the forwarded parameter object
				expect(typeof call.args.nonce).toBe('number');
			}

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for writeContract and writeContractSync', async () => {
			const {calls, spyTracked} = createSpyingWalletClient();

			const txHash = await spyTracked.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-not-forwarded-write',
			});
			await spyTracked.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-not-forwarded-write-sync',
			});

			expectNoCorrelationForwarded(calls, [
				'writeContract',
				'writeContractSync',
			]);
			for (const call of calls) {
				expect(typeof call.args.nonce).toBe('number');
			}

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		// These two cannot leak by construction: the raw wrappers hand viem a fresh
		// {serializedTransaction} literal rather than spreading the caller's args.
		// Kept as a guard in case that ever becomes a spread.
		it('for sendRawTransaction and sendRawTransactionSync', async () => {
			const {calls, spyTracked} = createSpyingWalletClient();

			const signedTx = await signRawTransaction();
			const txHash = await spyTracked.sendRawTransaction({
				serializedTransaction: signedTx,
				correlation: 'op-not-forwarded-raw',
			});
			await publicClient.waitForTransactionReceipt({hash: txHash});

			const signedTx2 = await signRawTransaction();
			await spyTracked.sendRawTransactionSync({
				serializedTransaction: signedTx2,
				correlation: 'op-not-forwarded-raw-sync',
			});

			expectNoCorrelationForwarded(calls, [
				'sendRawTransaction',
				'sendRawTransactionSync',
			]);
			for (const call of calls) {
				expect(call.args.serializedTransaction).toBeDefined();
			}
		});

		// The auto-populate builder is a hand-duplicated clone of the standard one,
		// so every wrapper of it that spreads rest args into viem is checked too.
		it('for the auto-populate writeContract and writeContractSync', async () => {
			const {calls, spyAutoTracked} = createSpyingWalletClient();

			const txHash = await spyAutoTracked.writeContract({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-not-forwarded-auto-write',
			});
			await spyAutoTracked.writeContractSync({
				address: tokenAddress,
				abi: TEST_CONTRACT_ABI,
				functionName: 'transfer',
				args: [RECIPIENT_ADDRESS, parseEther('1')],
				correlation: 'op-not-forwarded-auto-write-sync',
			});

			expectNoCorrelationForwarded(calls, [
				'writeContract',
				'writeContractSync',
			]);
			// the auto-populated metadata is not forwarded either
			for (const call of calls) {
				expect('metadata' in call.args).toBe(false);
				expect(typeof call.args.nonce).toBe('number');
			}

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('for the auto-populate sendTransaction and sendTransactionSync', async () => {
			const {calls, spyAutoTracked} = createSpyingWalletClient();

			const txHash = await spyAutoTracked.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {type: 'unknown', name: 'transfer', data: []},
				correlation: 'op-not-forwarded-auto-send',
			});
			await spyAutoTracked.sendTransactionSync({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {type: 'unknown', name: 'transfer', data: []},
				correlation: 'op-not-forwarded-auto-send-sync',
			});

			expectNoCorrelationForwarded(calls, [
				'sendTransaction',
				'sendTransactionSync',
			]);
			for (const call of calls) {
				expect(typeof call.args.nonce).toBe('number');
			}

			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('is independent of metadata', () => {
		it('does not appear in metadata, and both are kept separate', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				metadata: {id: 'meaning-of-the-tx', title: 'Deposit'},
				correlation: 'op-independent',
			});

			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-independent');
			// the correlation is a sibling of metadata, never nested inside it:
			// metadata is what consumers persist
			expect(event.metadata).toEqual({
				id: 'meaning-of-the-tx',
				title: 'Deposit',
			});
			expect(event.metadata).not.toHaveProperty('correlation');

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});

		it('is carried even when no metadata is supplied', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-without-metadata',
			});

			const event: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			expect(event.correlation).toBe('op-without-metadata');
			expect(event.metadata).toBeUndefined();

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash});
		});
	});

	describe('across concurrent sends', () => {
		it('emits two events with the respective correlations, in order', async () => {
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			const txHash1 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-first',
			});
			const txHash2 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				correlation: 'op-second',
			});

			expect(listener).toHaveBeenCalledTimes(2);
			const first: TrackedTransaction<TestMetadata> = listener.mock.calls[0][0];
			const second: TrackedTransaction<TestMetadata> =
				listener.mock.calls[1][0];
			expect(first.correlation).toBe('op-first');
			expect(second.correlation).toBe('op-second');
			expect(first.hash).toBe(txHash1);
			expect(second.hash).toBe(txHash2);

			trackedClient.off('transaction:broadcasted', listener);
			await publicClient.waitForTransactionReceipt({hash: txHash1});
			await publicClient.waitForTransactionReceipt({hash: txHash2});
		});

		it('keeps the correlations apart when two sends share a nonce', async () => {
			// The failure mode that motivates the field: a replacement and its
			// original are two distinct operations at the SAME (from, nonce), so a
			// map keyed on from:nonce cannot tell them apart.
			const listener = vi.fn();
			trackedClient.on('transaction:broadcasted', listener);

			// The test node mines instantly, so a transaction can only be left
			// pending by sending it one nonce ahead of an unfilled gap. That gap is
			// filled at the end, which drains the pool and mines the replacement.
			const gapNonce = await publicClient.getTransactionCount({
				address: account.address,
				blockTag: 'pending',
			});
			const nonce = gapNonce + 1;

			const originalHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.01'),
				nonce,
				maxFeePerGas: parseEther('0.000000002'),
				maxPriorityFeePerGas: parseEther('0.000000001'),
				correlation: 'op-original',
			});
			// same nonce, higher fee: a replacement of the above
			const replacementHash = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.02'),
				nonce,
				maxFeePerGas: parseEther('0.000000200'),
				maxPriorityFeePerGas: parseEther('0.000000100'),
				correlation: 'op-replacement',
			});

			expect(listener).toHaveBeenCalledTimes(2);
			const original: TrackedTransaction<TestMetadata> =
				listener.mock.calls[0][0];
			const replacement: TrackedTransaction<TestMetadata> =
				listener.mock.calls[1][0];

			// identical (from, nonce): only the correlation tells them apart
			expect(original.from).toBe(replacement.from);
			expect(original.nonce).toBe(replacement.nonce);
			expect(original.correlation).toBe('op-original');
			expect(replacement.correlation).toBe('op-replacement');
			expect(original.hash).not.toBe(replacement.hash);

			trackedClient.off('transaction:broadcasted', listener);

			// fill the gap so the queued replacement can be mined
			const fillerHash = await walletClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
				nonce: gapNonce,
			});
			await publicClient.waitForTransactionReceipt({hash: fillerHash});
			await publicClient.waitForTransactionReceipt({hash: replacementHash});
			expect(replacementHash).not.toBe(originalHash);
		});
	});
});

/**
 * The two builders are hand-duplicated near-clones. Anything a consumer can
 * observe must be identical between them, or a feature flag silently changes
 * behaviour that has nothing to do with the flag.
 */
describe('builder parity', () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient<Transport, Chain, Account>;
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
	});

	async function signRawTransaction() {
		const nonce = await publicClient.getTransactionCount({
			address: account.address,
			blockTag: 'pending',
		});
		return await walletClient.signTransaction({
			to: RECIPIENT_ADDRESS,
			value: parseEther('0.01'),
			nonce,
			gas: 21000n,
			maxFeePerGas: parseEther('0.000000002'),
			maxPriorityFeePerGas: parseEther('0.000000001'),
		});
	}

	/**
	 * sendRawTransaction used to emit transaction:fetched on the standard
	 * builder but not on the auto-populate one, so a consumer that persisted on
	 * transaction:fetched silently lost every raw transaction, but only when
	 * populateMetadata was on. The flag has nothing to do with raw sends.
	 */
	it('emits the same events for sendRawTransaction in both modes', async () => {
		const standardClient = createTrackedWalletClient<TestMetadata>().using(
			walletClient,
			publicClient,
		);
		const autoPopulateClient = createTrackedWalletClient({
			populateMetadata: true,
		}).using(walletClient, publicClient);

		const standardEvents: string[] = [];
		const autoEvents: string[] = [];
		standardClient.on('transaction:broadcasted', () =>
			standardEvents.push('broadcasted'),
		);
		standardClient.on('transaction:fetched', () =>
			standardEvents.push('fetched'),
		);
		autoPopulateClient.on('transaction:broadcasted', () =>
			autoEvents.push('broadcasted'),
		);
		autoPopulateClient.on('transaction:fetched', () =>
			autoEvents.push('fetched'),
		);

		const signedTx = await signRawTransaction();
		const standardHash = await standardClient.sendRawTransaction({
			serializedTransaction: signedTx,
		});
		await publicClient.waitForTransactionReceipt({hash: standardHash});

		const signedTx2 = await signRawTransaction();
		const autoHash = await autoPopulateClient.sendRawTransaction({
			serializedTransaction: signedTx2,
			metadata: {type: 'unknown', name: 'raw-transfer', data: []},
		});
		await publicClient.waitForTransactionReceipt({hash: autoHash});

		expect(standardEvents).toEqual(['broadcasted', 'fetched']);
		// the flag must not change which events a raw send produces
		expect(autoEvents).toEqual(standardEvents);
	});

	it('carries the correlation onto both events in both modes', async () => {
		const standardClient = createTrackedWalletClient<TestMetadata>().using(
			walletClient,
			publicClient,
		);
		const autoPopulateClient = createTrackedWalletClient({
			populateMetadata: true,
		}).using(walletClient, publicClient);

		const standardFetched = vi.fn();
		const autoFetched = vi.fn();
		standardClient.on('transaction:fetched', standardFetched);
		autoPopulateClient.on('transaction:fetched', autoFetched);

		const signedTx = await signRawTransaction();
		const standardHash = await standardClient.sendRawTransaction({
			serializedTransaction: signedTx,
			correlation: 'op-parity-standard',
		});
		await publicClient.waitForTransactionReceipt({hash: standardHash});

		const signedTx2 = await signRawTransaction();
		const autoHash = await autoPopulateClient.sendRawTransaction({
			serializedTransaction: signedTx2,
			metadata: {type: 'unknown', name: 'raw-transfer', data: []},
			correlation: 'op-parity-auto',
		});
		await publicClient.waitForTransactionReceipt({hash: autoHash});

		expect(standardFetched).toHaveBeenCalledTimes(1);
		expect(autoFetched).toHaveBeenCalledTimes(1);
		expect(standardFetched.mock.calls[0][0].correlation).toBe(
			'op-parity-standard',
		);
		expect(autoFetched.mock.calls[0][0].correlation).toBe('op-parity-auto');
		expect(autoFetched.mock.calls[0][0].known).toBe(true);
	});
});
