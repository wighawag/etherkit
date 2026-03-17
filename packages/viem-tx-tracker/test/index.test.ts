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
			await new Promise((resolve) => setTimeout(resolve, 500));

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
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(fetchedListener).toHaveBeenCalledTimes(1);

			// Unsubscribe
			trackedClient.off('transaction:fetched', fetchedListener);

			// Second transaction
			const txHash2 = await trackedClient.sendTransaction({
				to: RECIPIENT_ADDRESS,
				value: parseEther('0.001'),
			});

			// Wait for potential async fetch
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(fetchedListener).toHaveBeenCalledTimes(1); // Still 1, not 2

			await publicClient.waitForTransactionReceipt({hash: txHash1});
			await publicClient.waitForTransactionReceipt({hash: txHash2});
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
