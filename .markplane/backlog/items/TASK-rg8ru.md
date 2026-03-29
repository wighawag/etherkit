---
id: TASK-rg8ru
title: Implement BurnerKeyStorage for key generation and persistence
status: done
priority: high
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-5hxm2
blocks:
- TASK-n4kfy
related: []
assignee: null
tags:
- burner-wallet
- storage
- crypto
position: a1
created: 2026-03-28
updated: 2026-03-28
---

# Implement BurnerKeyStorage for key generation and persistence

## Description

Implement a unified key storage class that handles private key generation, persistence in localStorage, and loading. This consolidates what was previously separate storage and key manager layers, since `eip-1193-accounts-wrapper` handles all signing operations.

The class handles:
- Generating new random private keys using viem's `generatePrivateKey()`
- Persisting private keys to localStorage between page loads
- Loading existing keys from storage on initialization
- Providing keys as `0x${string}[]` array for `eip-1193-accounts-wrapper`
- Managing multiple accounts with ability to add/remove
- Clear method for wiping all burner data (important for security)
- Optional storage key prefix to avoid collisions

## Acceptance Criteria

- [ ] `BurnerKeyStorage` class with configurable localStorage key prefix (default: `burner-wallet:`)
- [ ] `createAccount()` generates a new random private key using viem and persists it
- [ ] `getPrivateKeys()` returns array of `0x${string}` private keys for use with `eip-1193-accounts-wrapper`
- [ ] `getAddresses()` returns list of all stored account addresses
- [ ] `removeAccount(address)` removes a specific account's private key from storage
- [ ] `clear()` removes all burner accounts from storage
- [ ] Automatically loads accounts from storage on construction
- [ ] Console warning displayed about localStorage security limitations

## Notes

Security consideration: private keys are stored in plain text in localStorage. This is acceptable for development/testing scenarios but should not be used for production wallets with real funds.

Since `eip-1193-accounts-wrapper` handles all signing via viem internally, this class only needs to generate, store, and provide private keys - no signing logic required.

## References

- [[TASK-5hxm2]] - Package structure must exist first
- [[EPIC-t34vi]] - Parent epic
- [viem generatePrivateKey](https://viem.sh/docs/accounts/local#generating-private-keys)
