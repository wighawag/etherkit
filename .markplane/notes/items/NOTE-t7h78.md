---
id: NOTE-t7h78
title: Project decisions
status: active
type: decision
related: []
tags:
- onboarding
created: 2026-03-28
updated: 2026-03-28
---

## Purpose

A running log of key project decisions. Each entry captures the context, options considered, and rationale — so future-you (or teammates) can understand *why* things are the way they are.

## Template

When adding a new decision, copy this template:

```markdown
### Decision Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded
**Context:** What prompted this decision?
**Options considered:**
1. Option A — pros/cons
2. Option B — pros/cons

**Decision:** What was decided and why.
**Consequences:** What follows from this decision.
```

---

### Use markplane for project management

**Date:** 2026-03-28
**Status:** Accepted
**Context:** Needed a lightweight, AI-friendly project tracking system that lives in the repo alongside the code. Related to [[EPIC-wg99x]].
**Options considered:**
1. GitHub Issues — good integration but separate from codebase context
2. Jira — powerful but heavyweight, poor AI integration
3. Markplane — markdown-first, lives in repo, AI-native

**Decision:** Adopted markplane. Files are the source of truth, git is the changelog. AI tools can read and update items directly.
**Consequences:** Team needs to learn markplane CLI. All project tracking happens through `.markplane/` directory.
