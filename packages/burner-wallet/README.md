# @etherkit/burner-wallet

A wallet for a chain that has no users yet. It generates a mnemonic, keeps it in `localStorage`, derives accounts from it, signs locally, and announces itself over EIP-6963 so any wallet picker finds it. Point it at a dev node over HTTP, or at a chain running inside the same tab.

> **Warning:** the mnemonic is stored unencrypted in `localStorage`. This is for development, testing and throwaway play. Never use it with real funds.

## Installation

```bash
npm install @etherkit/burner-wallet viem
# or
pnpm add @etherkit/burner-wallet viem
```

`viem` is a peer dependency (HD derivation and signing) and must be installed alongside this package.

## Quick start

```ts
import {initBurnerWallet} from '@etherkit/burner-wallet';

const {provider, walletManager, cleanup} = initBurnerWallet({
	nodeURL: 'http://localhost:8545',
});

// The wallet is now announced, and any EIP-6963 picker can find it.
const accounts = await provider.request({method: 'eth_requestAccounts'});
```

There is no separate "create wallet" step: the first `eth_requestAccounts` (or `eth_accounts`) generates a mnemonic if there is none, so a fresh browser can connect without a setup screen. `walletManager.createNew()` is there for when you want to force one.

### Vite app integration

```ts
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_BURNER_WALLET) {
	initBurnerWallet({
		nodeURL: import.meta.env.VITE_RPC_URL ?? 'http://localhost:8545',
	});
}
```

### A chain inside the tab

`nodeURL` takes an EIP-1193 object as well as a URL, because a chain running in the page (such as [`webevm`](https://github.com/wighawag/webevm)) has no URL to give. Anything with an async `request({method, params})` works, and nothing else is ever called on it: no events, no other methods.

```ts
const node = await createNode({chainId: 31337});

const {provider, walletManager} = initBurnerWallet({
	nodeURL: {request: (args) => node.request(args)},
	accountCount: 1,
	storagePrefix: 'embedded-wallet:31337:',
});
```

Such a node typically holds no keys and answers `eth_accounts`, `eth_sendTransaction` and `eth_sign` with `-32601`. That is exactly the split this package is for: accounts and signing belong to the wallet, and the node only ever sees `eth_sendRawTransaction` and reads.

Namespace `storagePrefix` per chain if you run more than one. Two chains are two histories, and a mnemonic shared between them puts one chain's accounts in the other's picker.

### One account, and no account picker

Ten accounts are derived by default, and a wallet offering several makes a connecting app show an account picker: a second dialog between a player and a game they have already chosen to play. Where there is nothing to choose, derive one:

```ts
initBurnerWallet({nodeURL, accountCount: 1});
```

This bounds derivation rather than filtering it. Account *n* is the same address whatever the count, so lowering the count keeps the account already in use, and the accounts beyond the bound are never derived at all.

> **Do not hide accounts by wrapping the provider.** Connectors such as `EthereumWalletProvider` in `@etherplay/wallet-connector-ethereum` call `on` and `removeListener` as well as `request`, so a wrapper forwarding only `request` throws `removeListener is not a function`. It throws from inside the connection, as a failed transaction, after the send is already signed. Pass the provider itself and set `accountCount`.

## API reference

### `initBurnerWallet(options)`

Creates the provider and announces it over EIP-6963 in one call.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nodeURL` | `string \| BurnerWalletNodeProvider` | (required) | JSON-RPC endpoint URL, or a node object with an async `request` |
| `accountCount` | `number` | `10` | Accounts derived from the mnemonic. Integer >= 1; pass `1` for no account picker |
| `storagePrefix` | `string` | `'burner-wallet:'` | `localStorage` key prefix |
| `impersonateAddresses` | `Hex[]` | none | Addresses to impersonate; needs a node supporting `hardhat_impersonateAccount` |
| `name` | `string` | `'Burner Wallet'` | Wallet name shown in pickers |
| `icon` | `string` | flame SVG data URI | Icon shown in pickers |
| `rdns` | `string` | `'app.etherplay.burner-wallet'` | Reverse DNS identifier |
| `uuid` | `string` | generated and persisted | EIP-6963 instance id |

**Returns** `{provider, walletManager, cleanup}`. `cleanup()` stops the announcements and drops every event listener.

Give `name`, `rdns` and `uuid` whenever an app announces a second burner. Without them both entries are called "Burner Wallet" and the player is choosing between two identical names pointing at two different chains.

### `createBurnerWalletProvider(options)`

The same thing without the announcement, for when you hand the provider to a connector directly.

```ts
import {createBurnerWalletProvider} from '@etherkit/burner-wallet';

const {provider, walletManager, cleanup} = createBurnerWalletProvider({
	nodeURL: 'http://localhost:8545',
});
```

Takes `nodeURL`, `accountCount`, `storagePrefix` and `impersonateAddresses` from the table above, and returns the same three things. `provider` is a plain EIP-1193 provider: `request`, `on`, `removeListener`, and nothing else bolted on.

### `walletManager`

State, separate from the provider so a settings screen can drive the wallet without going through RPC.

```ts
const mnemonic = walletManager.createNew(); // fresh 12 words, returns them
walletManager.importMnemonic('word1 word2 ... word12'); // throws if invalid, changing nothing
walletManager.selectAccount('0x...'); // make this address accounts[0]
walletManager.clearAll(); // forget the mnemonic and the selection
walletManager.get(); // {mnemonic, selectedAddress}
```

```ts
type BurnerWalletState = {
	mnemonic: string | null;
	selectedAddress: Hex | null;
};
```

`importMnemonic` derives the accounts before it commits anything, so a mnemonic it rejects leaves the wallet exactly as it was: same accounts signing, same mnemonic stored, same thing reported by `get()`, and no `accountsChanged`.

`selectAccount` reorders rather than re-derives: per EIP-1193 the active account is `accounts[0]`, so the selected address is moved to the front of `eth_accounts` and `eth_requestAccounts`, and `accountsChanged` is emitted. Every one of these methods emits `accountsChanged`, which is how a connected app learns the account changed under it.

### `announceBurnerWallet(provider, options?)`

Announces any EIP-1193 provider over EIP-6963. `initBurnerWallet` calls it for you.

```ts
const stop = announceBurnerWallet(provider, {name: 'My Burner Wallet'});
```

Announces immediately and again on every `eip6963:requestProvider`, and returns a function that stops listening. Takes `name`, `icon`, `rdns`, `uuid` and `storagePrefix`. With no `uuid` it generates one and persists it at `<storagePrefix>eip6963-uuid`, because EIP-6963 wants the id stable across a session.

### Other exports

`ACCOUNT_COUNT` (the default ten), `ACCOUNT_DERIVATION_PATH` (the BIP-44 path, for telling a user where to import the mnemonic), `BURNER_WALLET_SVG` and `BURNER_WALLET_ICON_DATA_URI` (the flame icon, for reusing it in your own picker entry), and the types `Hex`, `BurnerWalletNodeProvider` (formerly `EIP1193NodeProvider`, kept as a deprecated alias), `BurnerWalletNode`, `BurnerWalletState`, `BurnerWalletManager`, `CreateBurnerWalletProviderOptions`, `BurnerWalletProviderResult`, `InitBurnerWalletOptions`, `BurnerWalletInstance`, `EIP6963ProviderInfo`, `EIP6963ProviderDetail`, `AnnounceBurnerWalletOptions`.

## Events

| Event | When |
|-------|------|
| `connect` | Once, shortly after creation, carrying the node's `chainId`. Registering a listener synchronously after the call is soon enough |
| `accountsChanged` | On `createNew`, `importMnemonic`, `selectAccount` and `clearAll` |

`chainChanged`, `disconnect` and `message` can be subscribed to, because connectors subscribe to them unconditionally, but this wallet never emits them: it is bound to one node for its lifetime, and a burner that has lost its node has lost its chain rather than changed it. For the same reason it answers `wallet_switchEthereumChain` and `wallet_addEthereumChain` itself: `null` for its node's chain, and an error for any other (4902 for a switch, 4200 for an add), rather than forwarding them to a node that does not know them.

## Account derivation

Accounts are derived from one mnemonic at **`m/44'/60'/0'/0/{index}`**, exported as `ACCOUNT_DERIVATION_PATH`. That is the path `anvil`, `hardhat node` and MetaMask use, so pointing this wallet at a dev node started with the same mnemonic gives you the same list of addresses in the same order, and the mnemonic imports into any other tool unchanged.

Concretely, with the standard test mnemonic, `eth_accounts` returns `0xf39F...2266`, `0x7099...79C8`, `0x3C44...93BC` and so on: the accounts the node prints at startup, already funded.

> **Changed in 0.1.0.** Earlier versions walked BIP-44's *account* level (`m/44'/60'/{index}'/0/0`). Account 0 is identical under both, which is what made it hard to notice, but accounts 1 and up were addresses no other tool would show you. If you are carrying an older burner with funds on its second or later account, move them before upgrading, or re-derive the old addresses from the mnemonic at the old path.

## Impersonation

Given `impersonateAddresses`, the wallet calls `hardhat_impersonateAccount` for each at first use and reports the ones the node accepted, ahead of the derived accounts, in `eth_accounts`. Transactions from an impersonated address go to the node unsigned; transactions from a derived address are signed locally as usual. Addresses the node refuses are silently absent, and the list is never persisted, so it has to be passed on every creation.

## Using it with a connector

Hand over the provider object itself:

```ts
new EthereumWalletProvider(provider);
```

Connectors follow account and chain changes, so they need `on` and `removeListener` alongside `request`. Anything less breaks late and confusingly: see the warning under [One account, and no account picker](#one-account-and-no-account-picker), which is also the reason `accountCount` exists.

## `localStorage` schema

```json
{
	"burner-wallet:mnemonic": "word1 word2 ... word12",
	"burner-wallet:selected": "0x...",
	"burner-wallet:eip6963-uuid": "..."
}
```

`selected` appears only once an account has been selected, and `eip6963-uuid` only when announcing without an explicit `uuid`. All three are prefixed by `storagePrefix`. Writes are wrapped in try/catch, so the wallet still works where `localStorage` is unavailable (SSR, hardened browser settings); it simply forgets everything on reload.

## Architecture

- **One mnemonic, HD-derived accounts.** No per-account key material is stored: the mnemonic is the whole of the state, plus which address is selected.
- **Signing is local, the node only executes.** Sends become `eth_sendRawTransaction`, which is the same path a real wallet takes, so nothing in an app behaves differently because the chain is a dev node.
- **Transport-agnostic.** A URL or an object with `request`; the wallet does not care which, and a chain in the tab is not a special case.
- **No framework.** No DOM beyond `localStorage`, `window` for the EIP-6963 announcement, and no reactive runtime.

Dependencies: [`remote-procedure-call`](https://www.npmjs.com/package/remote-procedure-call) (JSON-RPC transport), [`eip-1193-accounts-wrapper`](https://www.npmjs.com/package/eip-1193-accounts-wrapper) (accounts, signing, impersonation), [`viem`](https://viem.sh) (mnemonic generation and HD derivation).

## Security

- The mnemonic is plain text in `localStorage`, readable by any script on the origin.
- It persists across reloads and is scoped to the origin.
- `walletManager.clearAll()` wipes it.
- `personal_sign` signs without asking. There is no confirmation dialog anywhere in this package, by design: that is what makes it usable for a game, and what makes it unsuitable for value.

## License

MIT
