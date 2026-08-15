# Release and marketplace checklist

Quickchat is submitted only from a public GitHub repository whose default branch is the exact commit validated below. The marketplace validates metadata, not plugin security.

## Release preparation

1. Update the manifest and package versions together.
2. Review ACP package versions, upstream source, licenses, and release notes; update `THIRD_PARTY_NOTICES.md` and the locked runtime metadata deliberately.
3. Run `npm ci`, the broker check suite, QML checks, and `./scripts/validate.sh`.
4. Build with `npm run build`, then run `./scripts/package-runtime.sh --output-dir dist/release` twice and compare archive hashes.
5. Inspect archive contents, `sbom.cdx.json`, `provenance.json`, and `SHA256SUMS`. Test extraction and broker startup on a clean x86-64 Omarchy Quattro environment.
6. Confirm the checked-in bundles reproduce from source without a diff. Upload the archive, checksum file, SBOM, and provenance to a GitHub draft release.
7. Install the exact public release revision with the commands in the README and verify startup, missing/corrupt-runtime failure, update, and removal.

The packaging workflow builds artifacts for review; it does not create or publish a GitHub Release.

## Required product evidence

- Add a verified screenshot from the live Quattro shell using the active
  Omarchy theme and update the README preview section.
- Verify open, compose, provider/model selection, automatic web/tool use and permission enforcement, stream/stop, Markdown, safe links, images, history/clear, dictation, Herdr continuation, keyboard navigation, narrow geometry, theme reload, shell reload, and all missing/error states.
- Record the exact Omarchy Quattro commit used for validation.
- Complete independent security, implementation, and design review with no unresolved actionable findings.
- Run `bash tests/check-ui-contract.sh` on a workstation with the pinned Quattro QML imports, Qt 6 tools, Quickshell, and a Wayland compositor. Hosted CI cannot substitute for this required environment gate.

## Marketplace submission

The target is <https://omarchyplugins.com>. Its current publishing guide requires a public GitHub repository, root manifest, README, license, safe install/removal, and optional preview before submitting the repository URL through its GitHub issue form.

Submission metadata:

- Repository: `https://github.com/spencerbull/omarchy-quickchat`
- Plugin ID: `io.github.spencerbull.quickchat`
- Category: Widgets
- Tags: `ai`, `bar`, `quickshell`
- Preview: verified implementation screenshot

Do not submit while `TODO.md` has an incomplete public-release or live-verification gate. The marketplace's agent instructions also require showing the exact issue title/body to the owner and receiving explicit approval before creating the issue.
