/**
 * Type tests for the provider slots. The assertions are checked by `pnpm typecheck` (tsc over
 * test/**); vitest only runs the file so it is not silently skipped. Values are
 * `undefined as unknown as T` placeholders, and nothing here is ever called.
 *
 * The observer only reads chain state, so both slots (`createTransactionObserver({provider})` and
 * `setProvider`) are `EIP1193CoreProvider`: a browser wallet, a JSON-RPC node and a plain HTTP
 * node must all fit. If a slot reverts to the wallet surface (`EIP1193ProviderWithoutEvents`
 * since eip-1193 0.7), the node lines below stop compiling.
 */
import {describe, expect, it} from 'vitest';
import type {
	EIP1193CoreProvider,
	EIP1193HttpNodeProvider,
	EIP1193NodeProvider,
	EIP1193Provider,
	EIP1193WalletProvider,
} from 'eip-1193';
import {createTransactionObserver} from '../../src/index.js';

describe('provider slots', () => {
	it('accept a wallet, a node and an HTTP node', () => {
		const _neverCalled = () => {
			const providers = [
				undefined as unknown as EIP1193WalletProvider,
				undefined as unknown as EIP1193Provider,
				undefined as unknown as EIP1193NodeProvider,
				undefined as unknown as EIP1193HttpNodeProvider,
				undefined as unknown as EIP1193CoreProvider,
			] as const;
			createTransactionObserver({finality: 1, provider: providers[0]});
			createTransactionObserver({finality: 1, provider: providers[2]});
			const observer = createTransactionObserver({
				finality: 1,
				provider: providers[3],
			});
			observer.setProvider(providers[0]);
			observer.setProvider(providers[1]);
			observer.setProvider(providers[2]);
			observer.setProvider(providers[3]);
			observer.setProvider(providers[4]);
		};
		expect(_neverCalled).toBeTypeOf('function');
	});
});
