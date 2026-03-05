import {
	initTransactionProcessor,
	type TransactionIntent,
	type TransactionIntentEvent,
} from '../../src/index.js';
import {
	createMockProvider,
	type MockProviderController,
	type MockProviderConfig,
} from '../mocks/MockEIP1193Provider.js';
import {
	createBroadcastedTx,
	createMockTx,
	resetHashCounter,
	type TEST_ACCOUNT,
} from '../fixtures/transactions.js';
import {createIntent, resetIntentIdCounter} from '../fixtures/intents.js';

/**
 * Test setup interface
 */
export interface TestSetup {
	processor: ReturnType<typeof initTransactionProcessor>;
	controller: MockProviderController;
	emissions: TransactionIntent[];
	emissionEvents: TransactionIntentEvent[];
	cleanup: () => void;
}

/**
 * Create a complete test setup with processor and mock provider
 */
export function createTestSetup(
	config: MockProviderConfig & {finality?: number} = {},
): TestSetup {
	const {finality = 12, ...providerConfig} = config;

	// Reset counters for clean test state
	resetHashCounter();
	resetIntentIdCounter();

	const {provider, controller} = createMockProvider(providerConfig);

	const processor = initTransactionProcessor({
		finality,
		provider,
	});

	const emissions: TransactionIntent[] = [];
	const emissionEvents: TransactionIntentEvent[] = [];
	const cleanupListener = processor.onOperationUpdated((event) => {
		emissions.push(structuredClone(event.intent));
		emissionEvents.push(structuredClone(event));
		return () => {};
	});

	return {
		processor,
		controller,
		emissions,
		emissionEvents,
		cleanup: cleanupListener,
	};
}

let counter = 0;
/**
 * Helper to create and add an intent with a single tx to the processor
 */
export function addSingleTxIntent(
	setup: TestSetup,
	txOverrides: Parameters<typeof createBroadcastedTx>[0] = {},
	intentOverrides: Partial<TransactionIntent> = {},
): {
	intent: TransactionIntent;
	intentId: string;
	addToMempool: () => void;
} {
	const tx = createBroadcastedTx(txOverrides);
	const mockTx = createMockTx({
		hash: tx.hash,
		from: tx.from,
		nonce: tx.nonce ?? 0,
	});

	const intent = createIntent({
		...intentOverrides,
		transactions: [tx],
	});

	const intentId = `intent-${++counter}`;
	setup.processor.addMultiple({[intentId]: intent});

	return {
		intent,
		intentId,
		addToMempool: () => setup.controller.addToMempool(mockTx),
	};
}

/**
 * Helper to add a replacement transaction to an existing intent
 */
export function addReplacementTx(
	setup: TestSetup,
	intentId: string,
	intent: TransactionIntent,
	txOverrides: Parameters<typeof createBroadcastedTx>[0] = {},
): {newTx: ReturnType<typeof createBroadcastedTx>; addToMempool: () => void} {
	const newTx = createBroadcastedTx(txOverrides);
	const mockTx = createMockTx({
		hash: newTx.hash,
		from: newTx.from,
		nonce: newTx.nonce ?? 0,
	});

	// Add the new tx to the intent via processor.add using the same intent ID
	setup.processor.addMultiple({
		[intentId]: {
			...intent,
			transactions: [newTx],
		},
	});

	return {
		newTx,
		addToMempool: () => setup.controller.addToMempool(mockTx),
	};
}

/**
 * Wait for a specific number of emissions
 */
export async function waitForEmissions(
	setup: TestSetup,
	count: number,
	timeoutMs: number = 1000,
): Promise<void> {
	const startCount = setup.emissions.length;
	const targetCount = startCount + count;
	const startTime = Date.now();

	while (setup.emissions.length < targetCount) {
		if (Date.now() - startTime > timeoutMs) {
			throw new Error(
				`Timeout waiting for emissions: expected ${targetCount}, got ${setup.emissions.length}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/**
 * Process and wait for all pending state changes
 */
export async function processAndWait(setup: TestSetup): Promise<void> {
	await setup.processor.process();
	// Small delay to ensure all async operations complete
	await new Promise((resolve) => setTimeout(resolve, 1));
}

/**
 * Get the latest emitted intent from emissions
 */
export function getLatestEmission(
	setup: TestSetup,
): TransactionIntent | undefined {
	if (setup.emissions.length === 0) {
		return undefined;
	}
	return setup.emissions[setup.emissions.length - 1];
}

/**
 * Get the latest emitted intent for a specific intent ID
 */
export function getLatestEmissionForIntent(
	setup: TestSetup,
	intentId: string,
): TransactionIntent | undefined {
	// Search backwards through emissions to find the latest for this intentId
	for (let i = setup.emissionEvents.length - 1; i >= 0; i--) {
		if (setup.emissionEvents[i].id === intentId) {
			return setup.emissionEvents[i].intent;
		}
	}
	return undefined;
}

/**
 * Scenario: Basic transaction lifecycle
 * - Create intent with single tx
 * - Add to mempool
 * - Process to detect in mempool
 * - Include in block
 * - Process to detect inclusion
 * - Advance to finality
 */
export async function runBasicLifecycleScenario(
	setup: TestSetup,
	nonce: number = 0,
): Promise<{
	intent: TransactionIntent;
	phases: {
		added: TransactionIntent | undefined;
		broadcasted: TransactionIntent | undefined;
		included: TransactionIntent | undefined;
		finalized: TransactionIntent | undefined;
	};
}> {
	const {intent, addToMempool} = addSingleTxIntent(setup, {nonce});
	const phases: {
		added: TransactionIntent | undefined;
		broadcasted: TransactionIntent | undefined;
		included: TransactionIntent | undefined;
		finalized: TransactionIntent | undefined;
	} = {
		added: undefined,
		broadcasted: undefined,
		included: undefined,
		finalized: undefined,
	};

	// Phase 1: Added but not yet in mempool
	await processAndWait(setup);
	// Should be NotFound since not in mempool yet
	phases.added = setup.emissions[setup.emissions.length - 1];

	// Phase 2: Add to mempool and process
	addToMempool();
	await processAndWait(setup);
	phases.broadcasted = setup.emissions[setup.emissions.length - 1];

	// Phase 3: Include in block
	setup.controller.includeTx(intent.transactions[0].hash, 'success');
	await processAndWait(setup);
	phases.included = setup.emissions[setup.emissions.length - 1];

	// Phase 4: Advance to finality
	setup.controller.advanceBlocks(12);
	await processAndWait(setup);
	phases.finalized = setup.emissions[setup.emissions.length - 1];

	return {intent, phases};
}

/**
 * Scenario: Gas bump replacement
 * - Create intent with TX1
 * - User bumps gas, adds TX2 with same nonce
 * - TX2 gets included, TX1 dropped
 */
export async function runGasBumpScenario(
	setup: TestSetup,
	nonce: number = 5,
): Promise<{
	intent: TransactionIntent;
	tx1Hash: `0x${string}`;
	tx2Hash: `0x${string}`;
	finalEmission: TransactionIntent | undefined;
}> {
	// Create initial tx
	const {
		intent,
		intentId,
		addToMempool: addTx1ToMempool,
	} = addSingleTxIntent(setup, {
		nonce,
	});
	const tx1Hash = intent.transactions[0].hash;

	// Add TX1 to mempool and process
	addTx1ToMempool();
	await processAndWait(setup);

	// Create replacement TX2 with higher gas
	const {newTx: tx2, addToMempool: addTx2ToMempool} = addReplacementTx(
		setup,
		intentId,
		intent,
		{
			nonce,
			from: intent.transactions[0].from,
		},
	);
	const tx2Hash = tx2.hash;

	// Remove TX1 from mempool (replaced), add TX2
	setup.controller.removeFromMempool(tx1Hash);
	addTx2ToMempool();
	await processAndWait(setup);

	// Include TX2
	setup.controller.includeTx(tx2Hash, 'success');
	await processAndWait(setup);

	return {
		intent,
		tx1Hash,
		tx2Hash,
		finalEmission: setup.emissions[setup.emissions.length - 1],
	};
}

/**
 * Scenario: Dropped transaction
 * - Create intent with tx
 * - Tx disappears from mempool
 * - Another tx consumes the nonce externally
 * - Tx becomes dropped
 */
export async function runDroppedScenario(
	setup: TestSetup,
	nonce: number = 5,
): Promise<{
	intent: TransactionIntent;
	finalEmission: TransactionIntent | undefined;
}> {
	const {intent, addToMempool} = addSingleTxIntent(setup, {nonce});
	const txHash = intent.transactions[0].hash;
	const account = intent.transactions[0].from;

	// Add to mempool and process
	addToMempool();
	await processAndWait(setup);

	// Remove from mempool
	setup.controller.removeFromMempool(txHash);
	await processAndWait(setup);

	// Advance blocks and set account nonce higher (external tx consumed it)
	setup.controller.advanceBlocks(15); // Past finality
	setup.controller.setAccountNonce(account, nonce + 1);
	await processAndWait(setup);

	return {
		intent,
		finalEmission: setup.emissions[setup.emissions.length - 1],
	};
}
