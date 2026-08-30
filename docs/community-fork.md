# Community fork maintenance

This document defines how `r-bart/omarchy-omapilot` remains useful as an
installable downstream build without obscuring OmaPilot's upstream ownership or
making future contributions harder to review.

## Ownership and compatibility

- OmaPilot was created by Spencer Bull and retains the permanent plugin ID
  `io.github.spencerbull.omapilot`.
- The community build is maintained by `@r-bart`. Selected-text actions are a
  downstream contribution intended to be offered back upstream.
- The fork does not rename plugin, IPC, runtime, or user-data identifiers. A
  user must install either upstream or the community build, not both.

## Branches

- `main` is the public, stable, installable community release.
- `develop` integrates reviewed work for the next community release.
- `feat/*` and `fix/*` isolate individual changes.
- The `origin` remote tracks `spencerbull/omarchy-omapilot`; the `fork` remote
  tracks `r-bart/omarchy-omapilot`.

Only merge `develop` into `main` when the release checklist is green. Keep
`main` free of experiments and unreviewed generated files.

## Contributing upstream

Do not open a cumulative pull request from downstream `main`. Start a focused
branch from the relevant `origin/main` or `origin/dev`, then cherry-pick or
rebuild the smallest coherent change from `develop`. Run the upstream-required
checks on that branch and open a narrowly scoped pull request against Spencer's
repository. This lets the community build move independently without asking
upstream to accept unrelated downstream history.

## Versioning

Community releases use SemVer prerelease identifiers that cannot be confused
with upstream releases:

```text
0.2.1-rbart.1
v0.2.1-rbart.1
```

Increment the final number for another community build of the same intended
upstream patch. Move the base version only when the upstream baseline or the
downstream compatibility target changes. Keep `manifest.json`, `package.json`,
and `package-lock.json` identical.

## Release flow

1. Update version and release documentation on `develop`.
2. Run every required gate in `docs/test-matrix.md` and `docs/release.md`.
3. Commit and push the exact green candidate to `fork/develop`.
4. Open and merge a pull request from `develop` to `main` in the fork.
5. Check out the resulting `main`, rerun release metadata and plugin validation,
   and confirm the worktree is clean.
6. Create the matching annotated tag and GitHub Release from that exact commit.
7. Attach only artifacts generated from that commit, with their checksums,
   SBOM, and provenance.

The Remotion demo project and rendered social video live outside the plugin
repository. A release may link to or attach the video, but the plugin source
tree does not carry editing projects or large raw captures.
