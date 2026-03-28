---
id: TASK-e8k3i
title: Create burner wallet icon and branding assets
status: done
priority: medium
type: feature
effort: small
epic: EPIC-t34vi
plan: null
depends_on: []
blocks: []
related: []
assignee: null
tags:
- burner-wallet
- design
position: aR
created: 2026-03-28
updated: 2026-03-28
---

# Create burner wallet icon and branding assets

## Description

Create visual assets for the burner wallet that will be displayed in wallet pickers via EIP-6963 discovery. The icon should clearly communicate that this is an ephemeral/development wallet, not a production wallet with real funds.

The icon will be embedded as a base64-encoded data URI in the EIP-6963 announcement payload.

## Acceptance Criteria

- [ ] SVG icon created (recommended size: 128x128 or scalable)
- [ ] Icon visually communicates "burner" or "ephemeral" concept (e.g., flame, match, hourglass)
- [ ] Icon is distinct from production wallets to avoid confusion
- [ ] Icon exported as base64 data URI suitable for EIP-6963
- [ ] Icon works well at small sizes (32x32 in wallet pickers)

## Notes

Consider using a flame or match icon to communicate the "burner" concept. The icon should be simple and recognizable at small sizes.

EIP-6963 expects the icon as a data URI, e.g., `data:image/svg+xml;base64,...`

## References

- [[EPIC-t34vi]] - Parent epic
- [EIP-6963 Specification](https://eips.ethereum.org/EIPS/eip-6963)
