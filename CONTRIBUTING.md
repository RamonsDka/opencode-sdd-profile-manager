# Contributing

Thanks for your interest in contributing to `opencode-sdd-profile-manager`.

## Ground Rules

- All changes must start from a linked GitHub issue.
- PRs without an issue will not be reviewed or approved.
- Keep changes as small and focused as possible.
- If a change is broad, invasive, or touches multiple concerns, explain clearly why that scope is necessary.

## Contribution Flow

1. Open or pick an existing GitHub issue describing the problem or proposal.
2. Fork the repository.
3. Create a branch from your fork.
4. Implement the smallest viable change that solves the issue.
5. Open a Pull Request back to this repository and link the issue.

## Branch Naming

Use one of these formats:

- `feat/short_description`
- `fix/short_description`

> Note: `feat:short_description` / `fix:short_description` is not a valid Git branch name because `:` is not allowed in refs.

Examples:

- `feat/profile-import`
- `fix/fallback-activation-error`

## Pull Request Requirements

Every PR must include:

- Linked issue (`Closes #123`, `Fixes #123`, or `Related to #123`)
- Clear summary of the change
- Short justification when the diff is larger than the minimum necessary
- Test notes or validation notes when relevant

## Review Policy

PRs may be rejected when:

- They are not linked to an issue
- They include unrelated changes
- They introduce more scope than necessary without justification
- They are hard to review because the intent is unclear

## Commit Guidance

This repository uses conventional commits for releases. Please prefer commit messages such as:

- `fix: correct fallback activation`
- `feat: add profile import`
- `docs: clarify plugin installation`

## Before Opening a PR

- Rebase or sync your branch with the latest target branch
- Remove unrelated edits
- Make sure the issue link and rationale are present in the PR description
