---
id: EPIC-t34vi
title: EIP-6963 Burner Wallet Package (@etherkit/burner-wallet)
status: now
priority: medium
started: null
target: null
related: []
tags: []
created: 2026-03-28
updated: 2026-03-28
---

# EIP-6963 Burner Wallet Package (@etherkit/burner-wallet)

## Objective

Create a standalone burner wallet package that implements EIP-6963 for wallet discovery, enabling automatic detection by `@etherplay/connect` and other wallet aggregators. The burner wallet provides a low-friction development and testing experience by generating ephemeral private keys stored in localStorage.

## Key Results

- [ ] KR1: Burner wallet appears as a selectable option in wallet pickers via EIP-6963 discovery
- [ ] KR2: Package structure allows extraction to standalone npm package without breaking changes
- [ ] KR3: Minimal custom code by leveraging existing npm packages for core functionality

## Architecture Overview

The package leverages existing npm packages to minimize custom code:
- `eip-1193` - Types for EIP-1193 provider interface
- `remote-procedure-call` - JSON-RPC HTTP client for the base provider
- `eip-1193-accounts-wrapper` - Wraps the base provider with account/signing capabilities

```mermaid
graph TD
    subgraph NPM[External NPM Packages]
        RPC[remote-procedure-call]
        EIP1193Types[eip-1193 types]
        Wrapper[eip-1193-accounts-wrapper]
    end

    subgraph BurnerWallet[@etherkit/burner-wallet]
        EIP6963[EIP-6963 Announcer]
        
        subgraph Core[Core Provider]
            EventEmitter[Event Emitter Layer]
            ProviderWithAccounts[Extended Provider]
            HTTPProvider[HTTP Provider via RPC]
        end
        
        KeyStorage[BurnerKeyStorage]
    end

    RPC -->|creates| HTTPProvider
    EIP1193Types -->|types| BurnerWallet
    Wrapper -->|wraps| HTTPProvider
    Wrapper -->|becomes| ProviderWithAccounts
    KeyStorage -->|provides privateKeys| Wrapper
    EventEmitter -->|wraps| ProviderWithAccounts
    EIP6963 -->|announces| Core
    HTTPProvider -->|RPC calls| Network[Ethereum Network]
```

## Key Design Decisions

1. **EIP-6963 First**: The wallet announces itself via the EIP-6963 protocol, making it discoverable by any compliant wallet aggregator
2. **Leverage Existing Packages**: Use `eip-1193-accounts-wrapper` for all signing/account operations instead of reimplementing
3. **Minimal Custom Code**: Only implement what's not provided by dependencies (key storage, event emitting, EIP-6963 announcement)
4. **Standalone Package Structure**: Code lives in `packages/burner-wallet/` and can be published as `@etherkit/burner-wallet`
5. **Configurable Storage**: Default localStorage implementation for key persistence

## Tasks

- [[TASK-5hxm2]] - Set up @etherkit/burner-wallet package structure
- [[TASK-rg8ru]] - Implement BurnerKeyStorage for key generation and persistence
- [[TASK-n4kfy]] - Implement BurnerWalletProvider with event support
- [[TASK-gjxsv]] - Implement EIP-6963 provider announcer for wallet discovery
- [[TASK-e8k3i]] - Create burner wallet icon and branding assets
- [[TASK-inp83]] - Add burner wallet initialization to template web app
- [[TASK-mayki]] - Write unit tests for burner wallet provider
- [[TASK-ed45v]] - Document burner wallet package API and usage
- [[TASK-v8j3h]] - Add optional BurnerWalletManager UI component

## Notes

- `eip-1193-accounts-wrapper` handles: `eth_accounts`, `eth_requestAccounts`, `eth_sendTransaction`, `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v4`
- EIP-6963 dispatches `eip6963:announceProvider` and listens for `eip6963:requestProvider` events
- Security consideration: burner wallets store private keys in localStorage - this is acceptable for development/testing but should display appropriate warnings
