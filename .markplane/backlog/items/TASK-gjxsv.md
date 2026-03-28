---
id: TASK-gjxsv
title: Implement EIP-6963 provider announcer for wallet discovery
status: draft
priority: high
type: feature
effort: medium
epic: EPIC-t34vi
plan: null
depends_on:
- TASK-n4kfy
blocks:
- TASK-inp83
- TASK-ed45v
related: []
assignee: null
tags:
- burner-wallet
- eip-6963
position: a4
created: 2026-03-28
updated: 2026-03-28
---

# Implement EIP-6963 provider announcer for wallet discovery

## Description

Implement EIP-6963 wallet announcement protocol so the burner wallet is automatically discovered by `@etherplay/connect` and other compliant wallet aggregators. This is the key integration point that makes the burner wallet appear in the wallet selection UI without any additional configuration.

EIP-6963 works by:
1. Dispatching an `eip6963:announceProvider` event on `window` with provider info and the EIP-1193 provider
2. Listening for `eip6963:requestProvider` events and responding with announcements
3. Providing wallet metadata (name, icon, uuid, rdns) for display in wallet pickers

The announcer wraps the EIP-1193 provider and handles all discovery protocol details.

## Acceptance Criteria

- [ ] `announceBurnerWallet(provider, options)` function that starts announcements
- [ ] Dispatches `eip6963:announceProvider` CustomEvent with `EIP6963ProviderDetail` payload
- [ ] Listens for `eip6963:requestProvider` and re-announces
- [ ] Provider info includes: uuid, name, icon (data URI), rdns
- [ ] Icon visually indicates this is a burner/development wallet (e.g., flame icon)
- [ ] Returns cleanup function to stop announcements
- [ ] Burner wallet appears in `@etherplay/connect` wallet picker when active

## Notes

The `rdns` (reverse domain name string) should be something like `app.etherplay.burner-wallet` to identify this provider type.

The icon should be a base64-encoded SVG data URI. Consider a flame or match icon to communicate the ephemeral nature.

## References

- [[TASK-n4kfy]] - Depends on EIP-1193 provider
- [EIP-6963 Specification](https://eips.ethereum.org/EIPS/eip-6963)
- [[EPIC-t34vi]] - Parent epic
