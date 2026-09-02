import {describe, it, expect} from 'vitest';
import type {Account, Chain, PublicClient, Transport, WalletClient} from 'viem';
import {
	createTrackedWalletClient,
	type PopulatedMetadata,
	type TrackedTransaction,
	type TrackedWalletClient,
	type TrackedWalletClientType,
} from '../src/index.js';
import type {TestTransactionMetadata} from './utils/types.js';

/**
 * Type-level contract for the opaque transaction source.
 *
 * These assertions are enforced by `pnpm typecheck` (tsc over src + test), not
 * at runtime: the function below is never called. `@ts-expect-error` fails the
 * typecheck if the marked line ever stops being an error.
 */

type TestMetadata = TestTransactionMetadata | undefined;
type TestSource = 'connected-wallet' | 'local-signer' | 'payer-wallet';

declare const walletClient: WalletClient<Transport, Chain, Account>;
declare const publicClient: PublicClient;

function typeLevelAssertions() {
	// --- default TSource: existing usage compiles unchanged -------------------
	const untyped = createTrackedWalletClient<TestMetadata>().using(
		walletClient,
		publicClient,
	);
	const stillAssignable: TrackedWalletClient<
		TestMetadata,
		Transport,
		Chain,
		Account
	> = untyped;
	const stillAssignableAlias: TrackedWalletClientType<
		TestMetadata,
		false,
		Transport,
		Chain,
		Account
	> = untyped;
	untyped.on('transaction:broadcasted', (tx) => {
		// with the default, the source is present and typed undefined
		const source: undefined = tx.source;
		return source;
	});

	// auto-populate mode, no source
	const autoPopulate = createTrackedWalletClient({
		populateMetadata: true,
	}).using(walletClient, publicClient);
	autoPopulate.on('transaction:fetched', (tx) => {
		const metadata: PopulatedMetadata = tx.metadata;
		const source: undefined = tx.source;
		return [metadata, source];
	});

	// --- non-undefined TSource: the option is required ------------------------
	const sourced = createTrackedWalletClient<TestMetadata, TestSource>({
		source: 'local-signer',
	}).using(walletClient, publicClient);
	sourced.on(
		'transaction:broadcasted',
		(tx: TrackedTransaction<TestMetadata, TestSource>) => {
			const source: TestSource = tx.source;
			return source;
		},
	);
	sourced.on('transaction:fetched', (tx) => {
		const source: TestSource = tx.source;
		return source;
	});
	const sourcedAlias: TrackedWalletClientType<
		TestMetadata,
		false,
		Transport,
		Chain,
		Account,
		TestSource
	> = sourced;

	// thunk form is accepted
	createTrackedWalletClient<TestMetadata, TestSource>({
		source: () => 'payer-wallet',
	});

	// auto-populate mode with a source
	createTrackedWalletClient<PopulatedMetadata, TestSource>({
		populateMetadata: true,
		source: 'connected-wallet',
	});

	// @ts-expect-error - the options argument is required when TSource excludes undefined
	createTrackedWalletClient<TestMetadata, TestSource>();

	// @ts-expect-error - the source option is required when TSource excludes undefined
	createTrackedWalletClient<TestMetadata, TestSource>({});

	// @ts-expect-error - the source must match the declared TSource
	createTrackedWalletClient<TestMetadata, TestSource>({source: 'not-a-route'});

	// @ts-expect-error - required in auto-populate mode too
	createTrackedWalletClient<PopulatedMetadata, TestSource>({
		populateMetadata: true,
	});

	// @ts-expect-error - no source option when TSource is left at its default
	createTrackedWalletClient<TestMetadata>({source: 'local-signer'});

	// TSource is never inferred from the option value: passing a source without
	// declaring the type arguments must fail loudly, rather than silently
	// widening TSource to string and collapsing TMetadata to unknown.
	// @ts-expect-error - TSource (and TMetadata) must be declared explicitly
	createTrackedWalletClient({source: 'local-signer'});

	// @ts-expect-error - same in auto-populate mode: no silent PopulatedMetadata -> unknown
	createTrackedWalletClient({populateMetadata: true, source: 'local-signer'});

	return [stillAssignable, stillAssignableAlias, sourcedAlias];
}

describe('source type-level contract', () => {
	it('is enforced by tsc (see pnpm typecheck)', () => {
		expect(typeof typeLevelAssertions).toBe('function');
	});
});
