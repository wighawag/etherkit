---
id: TASK-mayki
title: Write unit tests for burner wallet provider
status: draft
priority: medium
type: feature
effort: medium
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-n4kfy
blocks: []
related: []
assignee: null
tags:
- burner-wallet
- testing
position: aT
created: 2026-03-28
updated: 2026-03-28
---

# Write unit tests for burner wallet provider

## Description

Write tests for `@etherkit/burner-wallet` package. Since `eip-1193-accounts-wrapper` already has its own test suite for account/signing operations, focus on testing the integration layer and burner-specific functionality.

## Acceptance Criteria

- [ ] Tests for `BurnerKeyStorage`: key generation, persistence, loading, removal
- [ ] Tests for provider factory: correct wiring of components
- [ ] Tests for event emission: `accountsChanged`, `connect` events
- [ ] Tests for `eth_requestAccounts` auto-account-creation behavior
- [ ] Tests run in CI pipeline

## Notes

Use vitest for testing (consistent with other packages in the monorepo). Consider using a mock localStorage for storage tests.

Since `eip-1193-accounts-wrapper` handles signing logic, we don't need to test signing operations - just test that keys are passed correctly to the wrapper.

## References

- [[TASK-n4kfy]] - Depends on provider implementation
- [[EPIC-t34vi]] - Parent epic
