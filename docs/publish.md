# Automated Release & Publication Workflow

This repository uses **`semantic-release`** to automate semantic versioning, changelog generation, Git tagging, npm package publishing, and GitHub Releases.

---

## How It Works

The release pipeline executes automatically on every push or merge to the **`main`** branch. The workflow analyzes commit messages since the last release tag to determine the appropriate SemVer bump (Patch, Minor, or Major).

### Commit Message Standards (Conventional Commits)

To trigger an automated release, commits must adhere strictly to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

| Prefix | Description & Example | Resulting Release Type |
|---|---|---|
| `fix:` | `fix: resolve fallback synchronization edge case` | **Patch** (e.g. `2.0.0` -> `2.0.1`) |
| `feat:` | `feat: support per-agent reasoning effort configuration` | **Minor** (e.g. `2.0.0` -> `2.1.0`) |
| `feat!:` or `BREAKING CHANGE:` | `feat!: overhaul profile storage schema and API` | **Major** (e.g. `2.0.0` -> `3.0.0`) |

> Commits with prefixes such as `docs:`, `test:`, `ci:`, `chore:`, or `refactor:` do not trigger a release independently, but will be included in the generated changelog when a subsequent release is published.

---

## Pipeline Environment & Secrets

The GitHub Actions workflow (`.github/workflows/publish.yml`) requires:
- **Node.js**: Major version 24 (or `>=22.14.0` in CI environments).
- **Secrets**:
  - `NPM_TOKEN`: npm authentication token with package publication permissions.
  - `GITHUB_TOKEN`: Automatically provisioned by GitHub Actions for creating Git tags, releases, and attaching artifacts.

---

## Publication Steps

1. Create a focused branch for your changes.
2. Commit your changes using the appropriate Conventional Commit prefix.
3. Open a pull request against `main`.
4. Once verified and merged into `main`, GitHub Actions automatically:
   - Runs full typecheck and test verification (`npm test`).
   - Executes `npm run build` and `scripts/package-release.mjs`.
   - Generates release archives (`sdd-profile-manager-vX.Y.Z.zip`, `.tar.gz`, `SHA256SUMS.txt`).
   - Publishes the updated package to npm.
   - Creates a GitHub Release with the compiled artifacts and changelog.

---

## Triggering an On-Demand Release

If unreleased commits exist on `main` that do not carry release prefixes, an empty release commit can be pushed to trigger publication:

```bash
git commit --allow-empty -m "fix: trigger release for pending changes"
git push origin main
```
