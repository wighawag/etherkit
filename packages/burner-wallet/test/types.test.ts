/**
 * Type tests. The assertions are checked by `pnpm typecheck` (tsc over test/**); vitest only runs
 * the file so it is not silently skipped. Values are `undefined as unknown as T` placeholders and
 * nothing here is ever called.
 */
import {describe, expect, it} from 'vitest';
import type {
	EIP1193CoreProvider,
	EIP1193HttpNodeProvider,
	EIP1193NodeProvider as NodeProviderFromEIP1193,
	EIP1193WindowWalletProvider,
} from 'eip-1193';
import type {WalletInfo} from '@etherplay/wallet-connector';
import {
	announceBurnerWallet,
	createBurnerWalletProvider,
	type BurnerWalletNodeProvider,
	type EIP6963ProviderInfo,
} from '../src/index.js';

describe('createBurnerWalletProvider types', () => {
	it('points at any eip-1193 0.7 node provider, and hands back a window wallet', () => {
		const _neverCalled = () => {
			createBurnerWalletProvider({
				nodeURL: undefined as unknown as NodeProviderFromEIP1193,
			});
			createBurnerWalletProvider({
				nodeURL: undefined as unknown as EIP1193HttpNodeProvider,
			});
			const {provider} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			// what an EIP-6963 consumer (e.g. @etherplay/wallet-connector-ethereum) expects
			const asWindowWallet: EIP1193WindowWalletProvider = provider;
			// and what a read-only consumer (e.g. @etherkit/tx-observer) expects
			const asCore: EIP1193CoreProvider = provider;
			// a 6963 consumer may announce a window wallet of its own
			announceBurnerWallet(undefined as unknown as EIP1193WindowWalletProvider);
			const node: BurnerWalletNodeProvider =
				undefined as unknown as NodeProviderFromEIP1193;
			return [asWindowWallet, asCore, node];
		};
		expect(_neverCalled).toBeTypeOf('function');
	});
});

describe('EIP6963ProviderInfo', () => {
	it('is a WalletInfo, autoApproves included, so walletPrompts reads it', () => {
		// If the field is renamed or retyped on either side this stops compiling.
		const asWalletInfo: WalletInfo =
			undefined as unknown as EIP6963ProviderInfo;
		const autoApproves: WalletInfo['autoApproves'] =
			undefined as unknown as EIP6963ProviderInfo['autoApproves'];
		const back: EIP6963ProviderInfo['autoApproves'] =
			undefined as unknown as WalletInfo['autoApproves'];
		expect([asWalletInfo, autoApproves, back]).toBeDefined();
	});
});
