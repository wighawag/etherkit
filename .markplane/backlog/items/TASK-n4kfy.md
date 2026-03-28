---
id: TASK-n4kfy
title: Implement BurnerWalletProvider with event support
status: draft
priority: high
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-rg8ru
blocks:
- TASK-gjxsv
- TASK-mayki
related: []
assignee: null
tags:
- burner-wallet
- eip-1193
position: a3
created: 2026-03-28
updated: 2026-03-28
---

# Implement BurnerWalletProvider with event support

## Description

Create a thin wrapper that combines existing packages to create a full EIP-1193 provider for the burner wallet. The heavy lifting is done by:

- `remote-procedure-call` - Creates the HTTP JSON-RPC base provider
- `eip-1193-accounts-wrapper` - Handles all account methods and signing

This task only needs to:
1. Create an HTTP provider using `remote-procedure-call` pointing to the configured RPC URL
2. Wrap it with `eip-1193-accounts-wrapper` passing private keys from `BurnerKeyStorage`
3. Add an event emitter layer for EIP-1193 events (`accountsChanged`, `chainChanged`, `connect`, `disconnect`)
4. Handle `eth_requestAccounts` to auto-create account if none exist

## Acceptance Criteria

- [ ] `createBurnerWalletProvider(options)` factory function that returns EIP-1193 provider
- [ ] Constructor accepts RPC URL configuration
- [ ] Uses `remote-procedure-call` for HTTP JSON-RPC transport
- [ ] Uses `eip-1193-accounts-wrapper` for account/signing operations
- [ ] `eth_requestAccounts` auto-creates account via `BurnerKeyStorage` if none exist
- [ ] Provider emits `accountsChanged` when accounts are added/removed
- [ ] Provider emits `connect` on initialization with chainId
- [ ] Provider implements full `EIP1193Provider` interface from `eip-1193` package

## Notes

Since `eip-1193-accounts-wrapper` already handles:
- `eth_accounts`, `eth_requestAccounts` (returns configured accounts)
- `eth_sendTransaction` (signs and broadcasts)
- `personal_sign`, `eth_sign`, `eth_signTypedData_v4` (signing)
- All other methods pass through to base provider

The main work is wiring these together and adding the event emitter pattern.

## References

- [[TASK-rg8ru]] - Depends on BurnerKeyStorage
- [EIP-1193 Specification](https://eips.ethereum.org/EIPS/eip-1193)
- [[EPIC-t34vi]] - Parent epic
