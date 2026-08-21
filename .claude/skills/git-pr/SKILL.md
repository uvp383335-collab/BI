---
name: git-pr
description: Manage, review, and prepare Git changes and pull requests for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever reviewing git changes, preparing commits, creating pull requests, analyzing branches, checking diffs, validating changed files, or preparing PR descriptions.
---

# Git & Pull Request Standards

## 1. Purpose

Use Git and pull-request practices that keep changes:

- Small
- Focused
- Traceable
- Reviewable
- Safe
- Reversible
- Consistent with the project

The primary goals are:

1. Protect existing functionality.
2. Keep commits understandable.
3. Keep PRs focused.
4. Prevent unrelated changes.
5. Make reviews easier.
6. Preserve a clear project history.

---

# 2. Before Making Changes

Before modifying code:

1. Check the current branch.
2. Check working-tree status.
3. Inspect recent commits.
4. Understand whether existing uncommitted changes exist.
5. Do not overwrite or discard user changes.
6. Understand the current branch's relationship to its base branch.

Use:

```bash
git status
git branch --show-current
git log --oneline -10