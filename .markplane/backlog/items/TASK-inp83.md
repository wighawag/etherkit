---
id: TASK-inp83
title: Add burner wallet initialization to template web app
status: done
priority: medium
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-gjxsv
blocks:
- TASK-v8j3h
related: []
assignee: null
tags:
- burner-wallet
- integration
position: aS
created: 2026-03-28
updated: 2026-03-28
---

# Add burner wallet initialization to template web app

## Description

Integrate `@etherkit/burner-wallet` into the template web application so that the burner wallet appears as a selectable option in wallet pickers. The integration should be minimal and optional, allowing developers to easily enable/disable burner wallet functionality.

## Acceptance Criteria

- [ ] Burner wallet initializes on app startup when enabled
- [ ] Burner wallet appears in `@etherplay/connect` wallet picker via EIP-6963 discovery
- [ ] Configuration option to enable/disable burner wallet (e.g., environment variable)
- [ ] Burner wallet only enabled in development/test environments by default
- [ ] RPC URL is configurable for the burner wallet provider

## Notes

The burner wallet should be disabled by default in production builds to prevent users from accidentally using it with real funds. Consider using an environment variable like `VITE_ENABLE_BURNER_WALLET=true`.

## References

- [[TASK-gjxsv]] - Depends on EIP-6963 announcer
- [[EPIC-t34vi]] - Parent epic
