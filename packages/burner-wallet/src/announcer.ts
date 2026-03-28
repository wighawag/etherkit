import type {EIP1193Provider} from 'eip-1193';

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

// Simple flame SVG icon as a data URI for the burner wallet
const DEFAULT_ICON =
	'data:image/svg+xml;base64,' +
	btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#ff6b35"/>
      <stop offset="100%" stop-color="#ffd700"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="#1a1a2e"/>
  <path d="M32 8c0 0-16 14-16 28a16 16 0 0 0 32 0C48 22 32 8 32 8zm0 40a8 8 0 0 1-8-8c0-6 8-16 8-16s8 10 8 16a8 8 0 0 1-8 8z" fill="url(#flame)"/>
</svg>`);

function generateUUID(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback for environments without crypto.randomUUID
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
		/[xy]/g,
		(c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		}
	);
}

export type AnnounceBurnerWalletOptions = {
	name?: string;
	icon?: string;
	rdns?: string;
	uuid?: string;
};

export function announceBurnerWallet(
	provider: EIP1193Provider,
	options?: AnnounceBurnerWalletOptions
): () => void {
	const info: EIP6963ProviderInfo = {
		uuid: options?.uuid ?? generateUUID(),
		name: options?.name ?? 'Burner Wallet',
		icon: options?.icon ?? DEFAULT_ICON,
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
