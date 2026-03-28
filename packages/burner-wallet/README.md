# @etherkit/burner-wallet

EIP-6963 burner wallet provider for Ethereum development and testing. Generates ephemeral private keys stored in localStorage, automatically discoverable by wallet aggregators like `@etherplay/connect`.

> **Warning:** Private keys are stored unencrypted in localStorage. This package is intended for development and testing only. Do not use with real funds.

## Installation

```bash
npm install @etherkit/burner-wallet
# or
pnpm add @etherkit/burner-wallet
```

## Quick Start

```ts
import {initBurnerWallet} from '@etherkit/burner-wallet';

// Initialize and announce via EIP-6963
const {provider, storage, cleanup} = initBurnerWallet({
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

Convenience function that creates a provider and announces it via EIP-6963 in one call.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nodeURL` | `string` | (required) | Ethereum JSON-RPC endpoint URL |
| `storageKey` | `string` | `'burner-wallet:'` | localStorage key prefix |
| `name` | `string` | `'Burner Wallet'` | Wallet name shown in pickers |
| `icon` | `string` | flame SVG | Data URI for wallet icon |
| `rdns` | `string` | `'app.etherplay.burner-wallet'` | Reverse DNS identifier |
| `uuid` | `string` | auto-generated | Unique wallet instance ID |

**Returns:** `{ provider, storage, cleanup }`

### `createBurnerWalletProvider(options)`

Creates an EIP-1193 provider without announcing it.

```ts
import {createBurnerWalletProvider} from '@etherkit/burner-wallet';

const provider = createBurnerWalletProvider({
  nodeURL: 'http://localhost:8545',
});

// Use as a standard EIP-1193 provider
const accounts = await provider.request({method: 'eth_requestAccounts'});
```

- `eth_requestAccounts` auto-creates a burner account if none exist
- Emits `accountsChanged` when accounts change
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

### `BurnerKeyStorage`

Manages private key generation and localStorage persistence.

```ts
import {BurnerKeyStorage} from '@etherkit/burner-wallet';

const storage = new BurnerKeyStorage('my-prefix:');
const privateKey = storage.createAccount();
const addresses = storage.getAddresses();
const keys = storage.getPrivateKeys();
storage.removeAccount(addresses[0]);
storage.clear();
```

## Architecture

This package is a thin integration layer over:

- **`remote-procedure-call`** - HTTP JSON-RPC transport
- **`eip-1193-accounts-wrapper`** - Account management and transaction signing
- **`viem`** - Key generation and address derivation

## Security

- Private keys are stored **in plain text** in `localStorage`
- Keys persist across page reloads but are scoped to the origin
- Use `storage.clear()` to wipe all keys
- Never use with wallets holding real value

## License

MIT
