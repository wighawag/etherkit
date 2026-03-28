// Flame SVG icon for the burner wallet, designed to be recognizable at small sizes (32x32+).
// Dark circle background with gradient flame to communicate ephemeral/burner concept.
export const BURNER_WALLET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#ff6b35"/>
      <stop offset="100%" stop-color="#ffd700"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="#1a1a2e"/>
  <path d="M32 8c0 0-16 14-16 28a16 16 0 0 0 32 0C48 22 32 8 32 8zm0 40a8 8 0 0 1-8-8c0-6 8-16 8-16s8 10 8 16a8 8 0 0 1-8 8z" fill="url(#flame)"/>
</svg>`;

export const BURNER_WALLET_ICON_DATA_URI =
	'data:image/svg+xml;base64,' + btoa(BURNER_WALLET_SVG);
