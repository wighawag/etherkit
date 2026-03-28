---
id: PLAN-cmxek
title: Import existing work into markplane
status: draft
implements:
- TASK-8xgim
related: []
created: 2026-03-28
updated: 2026-03-28
---

## Context

This plan covers how to bring existing work items into markplane for [[TASK-8xgim]].

## Quick Reference

```bash
# Create a task
markplane add "Task title" --type feature --priority high

# Create an epic and link tasks
markplane epic "Epic title"
markplane link <task-id> <epic-id> -r epic

# Create a plan for a task
markplane plan <task-id>

# View your backlog
markplane ls
```

## Migration Steps

### From GitHub Issues

1. Export issues (or review them manually)
2. Create a markplane task for each active issue
3. Group related tasks under epics
4. Close the GitHub issues with a note pointing to markplane

### From Jira

1. Export active items from your Jira board
2. Map Jira statuses to markplane statuses (backlog, planned, in-progress, done)
3. Create tasks with appropriate types and priorities
4. Link related items using `markplane link`

### From Inline TODOs

1. Search your codebase: `grep -r "TODO\|FIXME\|HACK" src/`
2. Create a task for each actionable TODO
3. Replace the inline comment with a wiki-link reference to the task
4. Use tags to categorize (e.g., `--tags tech-debt`)
