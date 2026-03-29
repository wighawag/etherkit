# @etherkit/burner-wallet

EIP-6963 burner wallet provider for Ethereum development and testing. Uses a mnemonic-based HD wallet with reactive store pattern, automatically discoverable by wallet aggregators like `@etherplay/connect`.

> **Warning:** Mnemonic phrases are stored unencrypted in localStorage. This package is intended for development and testing only. Do not use with real funds.

## Installation

```bash
npm install @etherkit/burner-wallet viem
# or
pnpm add @etherkit/burner-wallet viem
```

> **Note:** `viem` is a peer dependency and must be installed alongside this package.

## Quick Start

```ts
import {initBurnerWallet} from '@etherkit/burner-wallet';

// Initialize and announce via EIP-6963
const {provider, store, cleanup} = initBurnerWallet({
  nodeURL: 'http://localhost:8545',
});

// The wallet is now discoverable by any EIP-6963 compliant wallet picker
```

### Vite App Integration

```ts
// Only enable in development
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_BURNER_WALLET) {
  initBurnerWallet({
    nodeURL: import.meta.env.VITE_RPC_URL ?? 'http://localhost:8545',
  });
}
```

## API Reference

### `initBurnerWallet(options)`

Convenience function that creates a store, provider, and announces it via EIP-6963 in one call.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nodeURL` | `string` | (required) | Ethereum JSON-RPC endpoint URL |
| `storagePrefix` | `string` | `'burner-wallet:'` | localStorage key prefix |
| `name` | `string` | `'Burner Wallet'` | Wallet name shown in pickers |
| `icon` | `string` | flame SVG | Data URI for wallet icon |
| `rdns` | `string` | `'app.etherplay.burner-wallet'` | Reverse DNS identifier |
| `uuid` | `string` | auto-generated | Unique wallet instance ID |

**Returns:** `{ provider, store, cleanup }`

### `createBurnerWalletStore(options?)`

Creates a reactive store that manages the mnemonic and derived accounts.

```ts
import {createBurnerWalletStore} from '@etherkit/burner-wallet';

const store = createBurnerWalletStore({
  storagePrefix: 'my-app:'
});

// Create a new wallet (generates 12-word mnemonic)
const mnemonic = store.createWallet();

// Or import existing mnemonic
store.importMnemonic('word1 word2 ... word12');

// Add more accounts
store.addAccount();  // Returns new account index

// Select account
store.selectAccount(0);

// Get current state
const state = store.get();
console.log(state.addresses);       // ['0x...', '0x...']
console.log(state.selectedAddress); // '0x...'

// Subscribe to changes (Svelte store compatible)
const unsubscribe = store.subscribe(state => {
  console.log('Accounts:', state.addresses);
});

// Clear everything
store.clearAll();
```

**State Shape:**

```ts
type BurnerWalletState = {
  mnemonic: string | null;       // 12-word phrase or null
  accountCount: number;          // Number of derived accounts
  selectedIndex: number;         // Currently selected account index
  addresses: Hex[];              // All derived addresses
  selectedAddress: Hex | null;   // Currently selected address
};
```

### `createBurnerWalletProvider(options)`

Creates an EIP-1193 provider using an existing store.

```ts
import {createBurnerWalletStore, createBurnerWalletProvider} from '@etherkit/burner-wallet';

const store = createBurnerWalletStore();
const {provider, cleanup} = createBurnerWalletProvider({
  nodeURL: 'http://localhost:8545',
  store,
});

// Use as a standard EIP-1193 provider
const accounts = await provider.request({method: 'eth_requestAccounts'});

// When done, clean up the store subscription
cleanup();
```

**Returns:** `{ provider, cleanup }` - Provider instance and cleanup function to unsubscribe from store updates.

- `eth_requestAccounts` auto-creates a wallet if none exists
- Emits `accountsChanged` when store state changes
- Emits `connect` with `chainId` on initialization

### `announceBurnerWallet(provider, options?)`

Announces a provider via EIP-6963 for wallet discovery.

```ts
import {announceBurnerWallet} from '@etherkit/burner-wallet';

const cleanup = announceBurnerWallet(provider, {
  name: 'My Burner Wallet',
});

// Stop announcements
cleanup();
```

## Framework Integration

### Svelte

```svelte
<script>
  import { store } from './wallet';
  
  // $store auto-subscribes
</script>

<select bind:value={$store.selectedIndex} 
        onchange={() => store.selectAccount($store.selectedIndex)}>
  {#each $store.addresses as addr, i}
    <option value={i}>{addr}</option>
  {/each}
</select>

<button onclick={() => store.addAccount()}>+ Add Account</button>
```

### React (with use-stores)

```tsx
import { useStore } from 'use-stores';
import { store } from './wallet';

function WalletSelector() {
  const state = useStore(store);
  // state.addresses, state.selectedAddress, etc.
}
```

## Architecture

This package provides:

- **Mnemonic-based HD wallet** - Single 12-word mnemonic, accounts derived sequentially (BIP-44 path: `m/44'/60'/0'/0/{index}`)
- **Reactive store** - Compatible with Svelte's `$store` syntax and React's `use-stores`
- **Framework-agnostic core** - No DOM/HTML dependencies in core modules

Dependencies:
- **`remote-procedure-call`** - HTTP JSON-RPC transport
- **`eip-1193-accounts-wrapper`** - Account management and transaction signing
- **`viem`** - HD wallet derivation (mnemonic generation, key derivation)

## Security

- Mnemonic is stored **in plain text** in `localStorage`
- Keys persist across page reloads but are scoped to the origin
- Use `store.clearAll()` to wipe the mnemonic and all derived data
- Never use with wallets holding real value

## localStorage Schema

```json
{
  "burner-wallet:mnemonic": "word1 word2 ... word12",
  "burner-wallet:count": 3,
  "burner-wallet:selected": 0
}
```

## License

MIT
