---
id: TASK-ed45v
title: Document burner wallet package API and usage
status: done
priority: medium
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-gjxsv
blocks: []
related: []
assignee: null
tags:
- burner-wallet
- documentation
position: aU
created: 2026-03-28
updated: 2026-03-28
---

# Document burner wallet package API and usage

## Description

Create README documentation for `@etherkit/burner-wallet` package covering installation, configuration, and usage. The documentation should help developers quickly integrate the burner wallet into their applications.

## Acceptance Criteria

- [ ] README.md with package overview and use case
- [ ] Installation instructions
- [ ] Basic usage example with code snippet
- [ ] Configuration options documented (RPC URL, storage prefix, etc.)
- [ ] Security warnings about localStorage key storage
- [ ] API reference for main exports

## Notes

Include clear warnings that burner wallets should not be used with real funds. The security model (localStorage, unencrypted keys) should be clearly explained.

## References

- [[TASK-gjxsv]] - Depends on full implementation being complete
- [[EPIC-t34vi]] - Parent epic
