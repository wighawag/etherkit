// @vitest-environment jsdom
import {describe, it, expect, afterEach, vi} from 'vitest';
import {announceBurnerWallet} from '../src/announcer.js';
import type {EIP1193Provider} from 'eip-1193';

function createMockProvider(): EIP1193Provider {
	return {
		request: vi.fn(),
		on: vi.fn().mockReturnThis(),
		removeListener: vi.fn().mockReturnThis(),
	} as unknown as EIP1193Provider;
}

describe('announceBurnerWallet', () => {
	let cleanups: (() => void)[] = [];

	afterEach(() => {
		for (const cleanup of cleanups) {
			cleanup();
		}
		cleanups = [];
	});

	it('dispatches eip6963:announceProvider event', () => {
		const provider = createMockProvider();
		const listener = vi.fn();
		window.addEventListener('eip6963:announceProvider', listener);

		cleanups.push(announceBurnerWallet(provider));

		expect(listener).toHaveBeenCalledTimes(1);
		const event = listener.mock.calls[0][0] as CustomEvent;
		expect(event.detail.provider).toBe(provider);
		expect(event.detail.info.name).toBe('Burner Wallet');
		expect(event.detail.info.rdns).toBe('app.etherplay.burner-wallet');
		expect(event.detail.info.uuid).toBeTruthy();
		expect(event.detail.info.icon).toContain('data:image/svg+xml');

		window.removeEventListener('eip6963:announceProvider', listener);
	});

	it('re-announces on eip6963:requestProvider', () => {
		const provider = createMockProvider();
		const listener = vi.fn();
		window.addEventListener('eip6963:announceProvider', listener);

		cleanups.push(announceBurnerWallet(provider));
		expect(listener).toHaveBeenCalledTimes(1);

		window.dispatchEvent(new Event('eip6963:requestProvider'));
		expect(listener).toHaveBeenCalledTimes(2);

		window.removeEventListener('eip6963:announceProvider', listener);
	});

	it('accepts custom options', () => {
		const provider = createMockProvider();
		const listener = vi.fn();
		window.addEventListener('eip6963:announceProvider', listener);

		cleanups.push(
			announceBurnerWallet(provider, {
				name: 'Custom Burner',
				rdns: 'com.example.burner',
				uuid: 'test-uuid-123',
			})
		);

		const event = listener.mock.calls[0][0] as CustomEvent;
		expect(event.detail.info.name).toBe('Custom Burner');
		expect(event.detail.info.rdns).toBe('com.example.burner');
		expect(event.detail.info.uuid).toBe('test-uuid-123');

		window.removeEventListener('eip6963:announceProvider', listener);
	});

	it('returns cleanup function that stops re-announcements', () => {
		const provider = createMockProvider();
		const listener = vi.fn();
		window.addEventListener('eip6963:announceProvider', listener);

		const cleanup = announceBurnerWallet(provider);
		expect(listener).toHaveBeenCalledTimes(1);

		cleanup();

		window.dispatchEvent(new Event('eip6963:requestProvider'));
		expect(listener).toHaveBeenCalledTimes(1);

		window.removeEventListener('eip6963:announceProvider', listener);
	});

	it('detail object is frozen', () => {
		const provider = createMockProvider();
		const listener = vi.fn();
		window.addEventListener('eip6963:announceProvider', listener);

		cleanups.push(announceBurnerWallet(provider));

		const event = listener.mock.calls[0][0] as CustomEvent;
		expect(Object.isFrozen(event.detail)).toBe(true);

		window.removeEventListener('eip6963:announceProvider', listener);
	});
});
