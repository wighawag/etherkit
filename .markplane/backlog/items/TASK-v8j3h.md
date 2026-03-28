---
id: TASK-v8j3h
title: Add optional BurnerWalletManager UI component for account management
status: draft
priority: low
type: feature
effort: medium
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-inp83
blocks: []
related: []
assignee: null
tags:
- burner-wallet
- ui
position: a5
created: 2026-03-28
updated: 2026-03-28
---

# Add optional BurnerWalletManager UI component for account management

## Description

Create an optional UI component that allows users to manage burner wallet accounts. This is useful for development/testing scenarios where developers need to switch between multiple accounts or create new ones on the fly.

The component should be framework-agnostic or provide adapters for common frameworks (React, Svelte, etc.).

## Acceptance Criteria

- [ ] UI component displays current burner accounts
- [ ] Ability to create new burner account
- [ ] Ability to switch active account
- [ ] Ability to remove/burn individual accounts
- [ ] Ability to clear all burner accounts
- [ ] Component is optional and doesn't add to bundle if not used
- [ ] Works with template web app styling

## Notes

This is a low priority enhancement. The core burner wallet functionality works without this UI - accounts can be managed programmatically. This UI is for developer convenience during testing.

Consider making it a separate entry point or sub-package to enable tree-shaking.

## References

- [[TASK-inp83]] - Depends on template integration
- [[EPIC-t34vi]] - Parent epic
