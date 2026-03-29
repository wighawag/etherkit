# Burner Wallet Refactoring Plan

## Goals

1. **Remove viem dependency** - Use `generateMnemonic` from `eip-1193-accounts-wrapper`
2. **Fix account count to 10** - No dynamic account management
3. **Merge store into provider** - Single ownership, no sync complexity
4. **Clean separation** - Provider (pure EIP-1193) vs Management (state operations)

## New API Design

### Return Shape

```typescript
type BurnerWalletInstance = {
    provider: EIP1193Provider;           // Pure EIP-1193, no extra methods
    walletManager: BurnerWalletManager;  // State control
    cleanup: () => void;                 // Unsubscribe from events
};
```

### WalletManager Interface

```typescript
type BurnerWalletManager = {
    // Mutations
    createNew(): string;                  // Generate fresh mnemonic, returns it
    importMnemonic(mnemonic: string): void;  // Restore from mnemonic
    selectAccount(index: number): void;   // Set accounts[0] for dapps
    clearAll(): void;                     // Wipe everything

    // State access
    get(): BurnerWalletState;
};

type BurnerWalletState = {
    mnemonic: string | null;
    selectedIndex: number;
};
```

**Note:** No `subscribe()` for now - can add later if needed. No address/key derivation - `eip-1193-accounts-wrapper` handles all signing internally when given a mnemonic.

### Provider Behavior

- **`eth_requestAccounts`** → Intercept, auto-create wallet if needed, return addresses with selected first
- **`eth_accounts`** → Intercept, reorder addresses with selected first
- **`accountsChanged` event** → Emit when mnemonic changes OR selection changes
- All other methods → Delegate to inner provider (accounts-wrapper handles signing)

The address reordering is critical because dapps expect `accounts[0]` to be the active account per EIP-1193 convention.

## Architecture Changes

```
Before:
┌─────────────────┐     subscribes      ┌──────────────────┐
│     store.ts    │◄────────────────────│   provider.ts    │
│                 │     getPrivateKeys  │                  │
│ - mnemonic      │────────────────────►│ - inner provider │
│ - accountCount  │                     │ - rebuilds on    │
│ - selectedIndex │                     │   every change   │
└─────────────────┘                     └──────────────────┘
        ▲
        │ external usage
        ▼
┌─────────────────┐
│    init.ts      │ returns {provider, store, cleanup}
└─────────────────┘

After:
┌──────────────────────────────────────────────┐
│                 provider.ts                   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Internal State (was store.ts)          │  │
│  │ - mnemonic, selectedIndex              │  │
│  │ - localStorage persistence             │  │
│  │ - address derivation (cached)          │  │
│  └────────────────────────────────────────┘  │
│                     │                        │
│  ┌──────────────────▼─────────────────────┐  │
│  │ WalletManager object                   │  │
│  │ - createNew(), selectAccount(), etc.   │  │
│  │ - subscribe(), get()                   │  │
│  └────────────────────────────────────────┘  │
│                     │                        │
│  ┌──────────────────▼─────────────────────┐  │
│  │ Provider object                        │  │
│  │ - EIP-1193 request()                   │  │
│  │ - on(), removeListener()               │  │
│  │ - uses accounts-wrapper internally     │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## File Changes

### 1. `package.json`

**Remove:**
```json
"peerDependencies": {
    "viem": "^2.0.0"
}
```

**Update eip-1193-accounts-wrapper** to version that exports `generateMnemonic`.

### 2. `types.ts`

**Remove:**
- `BurnerWalletStore` type (replaced by `BurnerWalletManager`)
- `accountCount` from state (always 10)
- `CreateBurnerWalletStoreOptions` (merge into provider options)

**Add:**
- `BurnerWalletManager` interface
- `ACCOUNT_COUNT = 10` constant

### 3. `store.ts` → DELETE

All logic moves into `provider.ts`.

### 4. `provider.ts`

**Major rewrite:**

```typescript
import {
    generateMnemonic,
    extendProviderWithAccounts
} from 'eip-1193-accounts-wrapper';

const ACCOUNT_COUNT = 10;

export function createBurnerWalletProvider(options: {
    nodeURL: string;
    storagePrefix?: string;
}): {
    provider: EIP1193Provider;
    walletManager: BurnerWalletManager;
    cleanup: () => void;
} {
    // Internal state
    let mnemonic: string | null = null;
    let selectedIndex = 0;

    // Load/save localStorage
    function load() { ... }
    function save() { ... }

    // Build inner provider - eip-1193-accounts-wrapper handles signing
    function buildInner() {
        const rpcProvider = createCurriedJSONRPC(nodeURL);
        return extendProviderWithAccounts(rpcProvider, {
            mnemonic,
            count: ACCOUNT_COUNT,
            selectedIndex,
        });
    }

    let inner = buildInner();

    // WalletManager object
    const walletManager: BurnerWalletManager = {
        createNew() {
            mnemonic = generateMnemonic();
            selectedIndex = 0;
            save();
            inner = buildInner();
            emitAccountsChanged();
            return mnemonic;
        },
        selectAccount(index) {
            selectedIndex = index;
            save();
            inner = buildInner();
            emitAccountsChanged();
        },
        get: () => ({ mnemonic, selectedIndex }),
        // importMnemonic, clearAll...
    };

    // Reorder addresses with selectedIndex first
    function getOrderedAddresses(addresses: string[]): string[] {
        if (selectedIndex === 0 || selectedIndex >= addresses.length) return addresses;
        const result = [...addresses];
        const [selected] = result.splice(selectedIndex, 1);
        result.unshift(selected);
        return result;
    }

    // Provider (pure EIP-1193)
    const provider: EIP1193Provider = {
        async request(args) {
            if (args.method === 'eth_requestAccounts') {
                if (!mnemonic) walletManager.createNew();
                const accounts = await inner.request(args);
                return getOrderedAddresses(accounts);
            }
            if (args.method === 'eth_accounts') {
                const accounts = await inner.request(args);
                return getOrderedAddresses(accounts);
            }
            return inner.request(args);
        },
        on(...) { ... },
        removeListener(...) { ... },
    };

    return { provider, walletManager, cleanup: () => {} };
}
```

Key improvements:
- No subscription between store and provider
- `inner` rebuilt only on explicit walletManager actions
- Clear data flow: walletManager action → state change → provider updated

### 5. `init.ts`

Simplify to just wire things together:

```typescript
export function initBurnerWallet(options: InitBurnerWalletOptions): BurnerWalletInstance {
    const { provider, walletManager, cleanup: providerCleanup } = createBurnerWalletProvider({
        nodeURL: options.nodeURL,
        storagePrefix: options.storagePrefix,
    });

    const announcerCleanup = announceBurnerWallet(provider, options);

    return {
        provider,
        walletManager,
        cleanup: () => {
            announcerCleanup();
            providerCleanup();
        },
    };
}
```

### 6. `index.ts`

Update exports:
- Remove `createBurnerWalletStore` export
- Add `BurnerWalletManager` type export
- Remove store-related types

### 7. Tests

Update all tests to use new API:
- `store.test.ts` → `wallet-manager.test.ts` (or merge into provider tests)
- `provider.test.ts` → update to test via walletManager interface

### 8. `README.md`

Update API documentation and examples.

## Migration Impact

**Breaking changes:**
- `store` property removed from return value, replaced with `walletManager`
- `addAccount()` removed (always 10 accounts)
- `getPrivateKeys()` removed from public API
- Type renames: `BurnerWalletStore` → `BurnerWalletManager`

**Preserved:**
- `initBurnerWallet()` main entry point
- `createBurnerWalletProvider()` for advanced usage
- localStorage keys unchanged (migration-compatible)
- EIP-6963 announcement unchanged

## Dependency Change

```diff
- import {generateMnemonic, mnemonicToAccount, english} from 'viem/accounts';
+ import {generateMnemonic, mnemonicToPrivateKeys} from 'eip-1193-accounts-wrapper';
```

Note: Verify `eip-1193-accounts-wrapper` exports what we need:
- `generateMnemonic()` - confirmed available per user
- Need: function to derive N private keys from mnemonic

## Resolved Questions

1. **Key derivation**: Keep internal for now. The `eip-1193-accounts-wrapper` handles signing internally. May need viem as regular dependency for mnemonic → keys derivation, but NOT as peer dependency.

2. **importMnemonic()**: Yes, keep it in walletManager for restore scenarios.

---

## Complete File Implementations

### File 1: `types.ts` (complete replacement)

```typescript
// packages/burner-wallet/src/types.ts

export type Hex = `0x${string}`;

export const ACCOUNT_COUNT = 10;

export type BurnerWalletState = {
    /** The mnemonic phrase - null if not yet created */
    mnemonic: string | null;
    /** Currently selected account index (0-based) */
    selectedIndex: number;
};

export type BurnerWalletManager = {
    /** Generate new wallet with fresh 12-word mnemonic, returns the mnemonic */
    createNew: () => string;

    /** Import existing mnemonic, resets selectedIndex to 0 */
    importMnemonic: (mnemonic: string) => void;

    /** Select account by index (0-9), affects address ordering */
    selectAccount: (index: number) => void;

    /** Clear everything - mnemonic and selection */
    clearAll: () => void;

    /** Get current state snapshot */
    get: () => BurnerWalletState;
};

export type CreateBurnerWalletProviderOptions = {
    /** Ethereum JSON-RPC endpoint URL */
    nodeURL: string;
    /** localStorage key prefix (default: 'burner-wallet:') */
    storagePrefix?: string;
};

export type BurnerWalletProviderResult = {
    /** EIP-1193 provider - pure, no extra methods */
    provider: import('eip-1193').EIP1193Provider;
    /** Wallet state management */
    walletManager: BurnerWalletManager;
    /** Cleanup function */
    cleanup: () => void;
};
```

### File 2: `provider.ts` (complete replacement)

```typescript
// packages/burner-wallet/src/provider.ts

import type {
    EIP1193Provider,
    EIP1193ProviderWithoutEvents,
    EIP1193Account,
    EIP1193ChainId,
    EIP1193ConnectInfoMessage,
    EIP1193ProviderRpcError,
    EIP1193Message,
} from 'eip-1193';
import {createCurriedJSONRPC} from 'remote-procedure-call';
import {extendProviderWithAccounts, generateMnemonic} from 'eip-1193-accounts-wrapper';
import {
    ACCOUNT_COUNT,
    type BurnerWalletManager,
    type BurnerWalletState,
    type CreateBurnerWalletProviderOptions,
    type BurnerWalletProviderResult,
} from './types.js';

type EventName = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect' | 'message';

type EventListener =
    | ((accounts: EIP1193Account[]) => unknown)
    | ((chainId: EIP1193ChainId) => unknown)
    | ((info: EIP1193ConnectInfoMessage) => unknown)
    | ((error: EIP1193ProviderRpcError) => unknown)
    | ((message: EIP1193Message) => unknown);

export function createBurnerWalletProvider(
    options: CreateBurnerWalletProviderOptions,
): BurnerWalletProviderResult {
    const {nodeURL, storagePrefix = 'burner-wallet:'} = options;
    const eventListeners = new Map<EventName, Set<EventListener>>();

    // ==================== Internal State ====================
    let mnemonic: string | null = null;
    let selectedIndex = 0;

    // ==================== localStorage ====================
    function load(): void {
        try {
            const storedMnemonic = localStorage.getItem(storagePrefix + 'mnemonic');
            const storedSelected = localStorage.getItem(storagePrefix + 'selected');

            if (storedMnemonic) {
                mnemonic = storedMnemonic;
                selectedIndex = storedSelected ? parseInt(storedSelected, 10) : 0;
            }
        } catch {
            // localStorage unavailable (SSR, etc)
        }
    }

    function save(): void {
        try {
            if (mnemonic) {
                localStorage.setItem(storagePrefix + 'mnemonic', mnemonic);
                localStorage.setItem(storagePrefix + 'selected', String(selectedIndex));
            } else {
                localStorage.removeItem(storagePrefix + 'mnemonic');
                localStorage.removeItem(storagePrefix + 'selected');
            }
        } catch {
            // localStorage unavailable
        }
    }

    // ==================== Event Handling ====================
    function emit(eventName: EventName, data: unknown): void {
        const set = eventListeners.get(eventName);
        if (set) {
            for (const listener of set) {
                (listener as (data: unknown) => unknown)(data);
            }
        }
    }

    async function emitAccountsChanged(): Promise<void> {
        if (!mnemonic) {
            emit('accountsChanged', []);
            return;
        }
        // Get accounts from inner provider and reorder
        const accounts = await inner.request({method: 'eth_accounts'});
        emit('accountsChanged', getOrderedAddresses(accounts as string[]));
    }

    // ==================== Inner Provider ====================
    function buildInner(): EIP1193ProviderWithoutEvents {
        const rpcProvider = createCurriedJSONRPC(nodeURL);
        if (!mnemonic) {
            // No mnemonic yet - return bare RPC provider
            return rpcProvider as EIP1193ProviderWithoutEvents;
        }
        return extendProviderWithAccounts(rpcProvider, {
            accounts: {
                mnemonic,
                count: ACCOUNT_COUNT,
            },
        });
    }

    let inner = buildInner();

    // ==================== Address Ordering ====================
    /**
     * Reorder addresses so selectedIndex is first.
     * Per EIP-1193, accounts[0] is the "active" account.
     */
    function getOrderedAddresses(addresses: string[]): string[] {
        if (addresses.length === 0) return [];
        if (selectedIndex === 0 || selectedIndex >= addresses.length) return addresses;
        const result = [...addresses];
        const [selected] = result.splice(selectedIndex, 1);
        result.unshift(selected);
        return result;
    }

    // ==================== WalletManager ====================
    const walletManager: BurnerWalletManager = {
        createNew(): string {
            mnemonic = generateMnemonic();
            selectedIndex = 0;
            save();
            inner = buildInner();
            emitAccountsChanged();
            return mnemonic;
        },

        importMnemonic(newMnemonic: string): void {
            // Validate by building provider (will throw if invalid)
            mnemonic = newMnemonic;
            selectedIndex = 0;
            inner = buildInner();  // This validates the mnemonic
            save();
            emitAccountsChanged();
        },

        selectAccount(index: number): void {
            if (index < 0 || index >= ACCOUNT_COUNT) {
                throw new Error(`Invalid index: ${index}. Must be 0-${ACCOUNT_COUNT - 1}`);
            }
            selectedIndex = index;
            save();
            // No need to rebuild inner - just reorder addresses
            emitAccountsChanged();
        },

        clearAll(): void {
            mnemonic = null;
            selectedIndex = 0;
            save();
            inner = buildInner();
            emitAccountsChanged();
        },

        get(): BurnerWalletState {
            return {mnemonic, selectedIndex};
        },
    };

    // ==================== Provider ====================
    const provider: EIP1193Provider = {
        async request(args: {method: string; params?: readonly unknown[]}) {
            // Auto-create wallet on first connection
            if (args.method === 'eth_requestAccounts') {
                if (!mnemonic) {
                    walletManager.createNew();
                }
                const accounts = await inner.request(args as any);
                return getOrderedAddresses(accounts as string[]);
            }

            // Return ordered addresses
            if (args.method === 'eth_accounts') {
                const accounts = await inner.request(args as any);
                return getOrderedAddresses(accounts as string[]);
            }

            // All other methods delegate to inner provider
            return inner.request(args as any);
        },

        on(eventName: string, listener: (...args: any[]) => any) {
            const name = eventName as EventName;
            if (!eventListeners.has(name)) {
                eventListeners.set(name, new Set());
            }
            eventListeners.get(name)!.add(listener as EventListener);
            return provider;
        },

        removeListener(eventName: string, listener: (...args: any[]) => any) {
            const set = eventListeners.get(eventName as EventName);
            if (set) {
                set.delete(listener as EventListener);
            }
            return provider;
        },
    } as EIP1193Provider;

    // ==================== Initialize ====================
    load();
    if (mnemonic) {
        inner = buildInner();
    }

    // Emit connect event asynchronously
    setTimeout(() => {
        provider
            .request({method: 'eth_chainId'})
            .then((chainId: EIP1193ChainId) => {
                emit('connect', {chainId});
            })
            .catch(() => {
                // Connection failed silently
            });
    }, 0);

    return {
        provider,
        walletManager,
        cleanup: () => {
            eventListeners.clear();
        },
    };
}
```

### File 3: `init.ts` (complete replacement)

```typescript
// packages/burner-wallet/src/init.ts

import type {EIP1193Provider} from 'eip-1193';
import {createBurnerWalletProvider} from './provider.js';
import type {BurnerWalletManager} from './types.js';
import {
    announceBurnerWallet,
    type AnnounceBurnerWalletOptions,
} from './announcer.js';

export type InitBurnerWalletOptions = {
    /** Ethereum JSON-RPC endpoint URL */
    nodeURL: string;
    /** localStorage key prefix (default: 'burner-wallet:') */
    storagePrefix?: string;
} & AnnounceBurnerWalletOptions;

export type BurnerWalletInstance = {
    provider: EIP1193Provider;
    walletManager: BurnerWalletManager;
    cleanup: () => void;
};

/**
 * Initialize a burner wallet and announce it via EIP-6963.
 *
 * Usage in a Vite app:
 * ```ts
 * import {initBurnerWallet} from '@etherkit/burner-wallet';
 *
 * if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_BURNER_WALLET) {
 *   initBurnerWallet({nodeURL: import.meta.env.VITE_RPC_URL});
 * }
 * ```
 */
export function initBurnerWallet(
    options: InitBurnerWalletOptions,
): BurnerWalletInstance {
    const {provider, walletManager, cleanup: providerCleanup} = createBurnerWalletProvider({
        nodeURL: options.nodeURL,
        storagePrefix: options.storagePrefix,
    });

    const announcerCleanup = announceBurnerWallet(provider, options);

    return {
        provider,
        walletManager,
        cleanup: () => {
            announcerCleanup();
            providerCleanup();
        },
    };
}
```

### File 4: `index.ts` (complete replacement)

```typescript
// packages/burner-wallet/src/index.ts

export {createBurnerWalletProvider} from './provider.js';
export type {
    Hex,
    BurnerWalletState,
    BurnerWalletManager,
    CreateBurnerWalletProviderOptions,
    BurnerWalletProviderResult,
    ACCOUNT_COUNT,
} from './types.js';
export {BURNER_WALLET_SVG, BURNER_WALLET_ICON_DATA_URI} from './icon.js';
export {announceBurnerWallet} from './announcer.js';
export type {
    EIP6963ProviderInfo,
    EIP6963ProviderDetail,
    AnnounceBurnerWalletOptions,
} from './announcer.js';
export {initBurnerWallet} from './init.js';
export type {InitBurnerWalletOptions, BurnerWalletInstance} from './init.js';
```

### File 5: `package.json` changes

```diff
  "dependencies": {
    "eip-1193": "^0.6.5",
-   "eip-1193-accounts-wrapper": "^0.0.13",
+   "eip-1193-accounts-wrapper": "^0.0.14",
    "remote-procedure-call": "^0.1.0"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^4.0.18",
    "as-soon": "^0.1.5",
    "jsdom": "^29.0.1",
    "prettier": "^3.8.0",
    "typescript": "^5.3.3",
    "viem": "^2.41.2",
    "vitest": "^4.0.18"
  },
- "peerDependencies": {
-   "viem": "^2.0.0"
- },
```

**Note:** The exact version of `eip-1193-accounts-wrapper` depends on which version exports `generateMnemonic`. Keep `viem` in devDependencies for tests if needed.

### File 6: Delete `store.ts`

Simply delete the file. All functionality is now in `provider.ts`.

---

## localStorage Schema (unchanged)

```json
{
  "burner-wallet:mnemonic": "word1 word2 ... word12",
  "burner-wallet:selected": 0
}
```

**Note:** Removed `burner-wallet:count` since account count is now fixed at 10.

---

## Test File Changes

### `provider.test.ts` updates needed:

1. Replace `store` with `walletManager` in all tests
2. Remove tests for `addAccount()` (no longer exists)
3. Update state assertions: no `addresses`, no `accountCount`
4. Test `selectAccount()` affects address ordering

### `store.test.ts` → DELETE or rename to `wallet-manager.test.ts`

If keeping as separate test file, test walletManager methods via `createBurnerWalletProvider()`:

```typescript
import {createBurnerWalletProvider} from '../src/provider.js';

describe('walletManager', () => {
    it('createNew generates mnemonic', () => {
        const {walletManager} = createBurnerWalletProvider({nodeURL: 'http://localhost:8545'});
        const mnemonic = walletManager.createNew();
        expect(mnemonic.split(' ')).toHaveLength(12);
        expect(walletManager.get().mnemonic).toBe(mnemonic);
    });

    it('selectAccount updates selectedIndex', () => {
        const {walletManager} = createBurnerWalletProvider({nodeURL: 'http://localhost:8545'});
        walletManager.createNew();
        walletManager.selectAccount(5);
        expect(walletManager.get().selectedIndex).toBe(5);
    });

    // ... etc
});
```
