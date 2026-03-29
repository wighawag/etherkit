import type {EIP1193Provider} from 'eip-1193';
import {BURNER_WALLET_ICON_DATA_URI} from './icon.js';

export type EIP6963ProviderInfo = {
	uuid: string;
	name: string;
	icon: string;
	rdns: string;
};

export type EIP6963ProviderDetail = {
	info: EIP6963ProviderInfo;
	provider: EIP1193Provider;
};

export type EIP6963AnnounceProviderEvent = CustomEvent<EIP6963ProviderDetail>;

function generateUUID(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback for environments without crypto.randomUUID
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Returns a stable UUID for this session/origin.
 * Per EIP-6963, UUID "SHOULD" be stable across a session to avoid
 * confusing aggregators that cache by UUID.
 */
function getStableUUID(storagePrefix: string): string {
	const key = storagePrefix + 'eip6963-uuid';
	try {
		const stored = localStorage.getItem(key);
		if (stored) {
			return stored;
		}
		const newUUID = generateUUID();
		localStorage.setItem(key, newUUID);
		return newUUID;
	} catch {
		// localStorage unavailable, fall back to session-unstable UUID
		return generateUUID();
	}
}

export type AnnounceBurnerWalletOptions = {
	name?: string;
	icon?: string;
	rdns?: string;
	uuid?: string;
	/** Storage prefix for persisting UUID. Defaults to 'burner-wallet:' */
	storagePrefix?: string;
};

export function announceBurnerWallet(
	provider: EIP1193Provider,
	options?: AnnounceBurnerWalletOptions
): () => void {
	const storagePrefix = options?.storagePrefix ?? 'burner-wallet:';
	const info: EIP6963ProviderInfo = {
		uuid: options?.uuid ?? getStableUUID(storagePrefix),
		name: options?.name ?? 'Burner Wallet',
		icon: options?.icon ?? BURNER_WALLET_ICON_DATA_URI,
		rdns: options?.rdns ?? 'app.etherplay.burner-wallet',
	};

	const detail: EIP6963ProviderDetail = {
		info,
		provider,
	};

	function announce() {
		window.dispatchEvent(
			new CustomEvent('eip6963:announceProvider', {
				detail: Object.freeze(detail),
			})
		);
	}

	function onRequestProvider() {
		announce();
	}

	// Announce immediately
	announce();

	// Re-announce when requested
	window.addEventListener('eip6963:requestProvider', onRequestProvider);

	// Return cleanup function
	return () => {
		window.removeEventListener(
			'eip6963:requestProvider',
			onRequestProvider
		);
	};
}
