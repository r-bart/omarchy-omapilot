# Release and marketplace checklist

Quickchat is submitted only from a public GitHub repository whose default branch is the exact commit validated below. The marketplace validates metadata, not plugin security.

## Release preparation

1. Update the manifest and package versions together.
2. Review ACP package versions, upstream source, licenses, and release notes; update `THIRD_PARTY_NOTICES.md` and the locked runtime metadata deliberately.
3. Run `npm ci`, the broker check suite, QML checks, and `./scripts/validate.sh`.
4. Build with `npm run build`, then run `./scripts/package-runtime.sh --output-dir dist/release` twice and compare archive hashes.
5. Inspect archive contents, `sbom.cdx.json`, `provenance.json`, and `SHA256SUMS`. Test extraction and broker startup on a clean x86-64 Omarchy Quattro environment.
6. Upload the archive, checksum file, SBOM, and provenance to a GitHub draft release. Update the repository runtime release lock with the final immutable asset URL and SHA-256, then rebuild/retest that commit.
7. Place the prebuilt runtime in the release revision, install from the public repository with the commands in the README, and verify startup, missing/corrupt-runtime failure, update, and removal.

The packaging workflow builds artifacts for review; it does not create or publish a GitHub Release.

## Required product evidence

- Add verified light/dark screenshots from the live Quattro shell and update the README preview section.
- Verify open, compose, provider/model selection, Answer/Web enforcement, stream/stop, Markdown, safe links, images, history/clear, dictation, Herdr continuation, keyboard navigation, narrow geometry, theme reload, shell reload, and all missing/error states.
- Record the exact Omarchy Quattro commit used for validation.
- Complete independent security, implementation, and design review with no unresolved actionable findings.

## Marketplace submission

The target is <https://omarchyplugins.com>. Its current publishing guide requires a public GitHub repository, root manifest, README, license, safe install/removal, and optional preview before submitting the repository URL through its GitHub issue form.

Submission metadata:

- Repository: `https://github.com/spencerbull/omarchy-quickchat`
- Plugin ID: `io.github.spencerbull.quickchat`
- Category: AI
- Suggested tags: `ai`, `bar-widget`, `acp`, `codex`, `claude`, `opencode`, `dictation`
- Preview: verified implementation screenshot

Do not submit while `TODO.md` has an incomplete public-release or live-verification gate.
