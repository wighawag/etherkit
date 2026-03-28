---
id: TASK-ha67q
title: Implement BurnerKeyManager for private key generation and account management
status: cancelled
priority: high
type: feature
effort: medium
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-rg8ru
blocks: []
related: []
assignee: null
tags:
- burner-wallet
- crypto
position: a2
created: 2026-03-28
updated: 2026-03-28
---

# Implement BurnerKeyManager for private key generation and account management

## Description

Implement a key manager that handles private key generation, account management, and signing operations using viem. The key manager is responsible for:

- Generating new random private keys for burner accounts
- Loading existing accounts from storage on initialization
- Providing viem `Account` objects for signing operations
- Managing multiple accounts with ability to switch active account
- Removing/burning individual accounts

The key manager uses the storage layer for persistence but handles all cryptographic operations through viem.

## Acceptance Criteria

- [ ] `BurnerKeyManager` class with storage dependency injection
- [ ] `createAccount()` generates a new random private key and persists it
- [ ] `getAccounts()` returns list of all stored account addresses
- [ ] `getAccount(address)` returns viem `Account` for signing
- [ ] `removeAccount(address)` removes account from storage
- [ ] `clear()` removes all burner accounts
- [ ] Automatically loads accounts from storage on construction
- [ ] Event emitter pattern for account changes (accountsChanged)

## Notes

Use viem's `generatePrivateKey()` and `privateKeyToAccount()` for key operations. The key manager does not expose raw private keys through its API - only viem Account objects.

## References

- [[TASK-rg8ru]] - Depends on storage interface
- [viem Account docs](https://viem.sh/docs/accounts/local)
- [[EPIC-t34vi]] - Parent epic
