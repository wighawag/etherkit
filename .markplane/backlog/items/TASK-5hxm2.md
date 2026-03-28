---
id: TASK-5hxm2
title: Set up @etherkit/burner-wallet package structure
status: draft
priority: high
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on: []
blocks:
- TASK-rg8ru
related: []
assignee: null
tags:
- burner-wallet
- package
position: a0
created: 2026-03-28
updated: 2026-03-28
---

# Set up @etherkit/burner-wallet package structure

## Description

Create the initial package structure for the burner wallet in a way that enables future extraction as a standalone npm package. The package should be self-contained within `packages/burner-wallet/` and leverage existing npm packages for core functionality:

- `eip-1193` - Types for EIP-1193 provider interface
- `remote-procedure-call` - JSON-RPC HTTP client for the base provider
- `eip-1193-accounts-wrapper` - Wraps the base provider with account/signing capabilities

The package structure must support:
- Clean separation of concerns (storage, provider, announcer)
- TypeScript with proper type exports
- ESM module format
- Easy extraction to standalone repository later

## Acceptance Criteria

- [ ] Package directory exists at `packages/burner-wallet/`
- [ ] `package.json` with name `@etherkit/burner-wallet`
- [ ] Dependencies include: `eip-1193`, `remote-procedure-call`, `eip-1193-accounts-wrapper`
- [ ] TypeScript configuration extends workspace tsconfig
- [ ] Entry point exports are defined in `package.json`
- [ ] Basic directory structure: `src/`, with files for storage, provider, and announcer
- [ ] Package builds successfully with workspace tooling

## Notes

The architecture leverages existing packages to minimize custom code:
- `remote-procedure-call` creates the HTTP JSON-RPC client
- `eip-1193-accounts-wrapper` handles all signing/account methods
- This package only needs to add: key storage, event emitting, and EIP-6963 announcement

## References

- [[EPIC-t34vi]] - Parent epic for burner wallet feature
