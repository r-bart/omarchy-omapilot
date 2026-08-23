# Release and marketplace checklist

OmaPilot is submitted only from a public GitHub repository whose default branch
is the exact commit validated below. Marketplace validation checks structure
and compatibility; it is not a plugin security review.

## Release preparation

1. Update `manifest.json`, `package.json`, and `package-lock.json` together.
2. Review exact runtime dependencies, licenses, upstream changes, and
   `THIRD_PARTY_NOTICES.md`.
3. On Linux x86-64 with Node 22, run `npm ci`, `npm run check`,
   `./scripts/validate.sh`, and `bash tests/check-ui-contract.sh`.
4. Rebuild twice and confirm that every tracked file under `runtime/dist/` and
   `browser-companion/dist/` is byte-identical.
5. Run `./scripts/package-runtime.sh --output-dir dist/release` twice and compare
   archive hashes. Inspect the archive, `sbom.cdx.json`, `provenance.json`, and
   `SHA256SUMS`.
6. Render `preview.png` with `npm run preview`, inspect it, and verify the same
   surface in the live Omarchy shell.
7. Validate a clean archive of the exact candidate commit with Omarchy Quattro.
   This `0.2.0` candidate is pinned to Quattro commit
   `ef6d9e6605b121df15bf310e630e04f0c1119fc8`.
8. Push the exact candidate to `dev`, merge it to the default `main` branch only
   after review and green CI, then rerun the marketplace validator and security
   baseline against that public `main` commit.

The packaging workflow builds artifacts for review; it does not create or
publish a GitHub Release.

## Marketplace submission

The current publishing target is <https://omarchyplugins.com>. The repository
is prepared with:

- Repository: `https://github.com/spencerbull/omarchy-omapilot`
- Plugin ID: `io.github.spencerbull.omapilot`
- Category: `Widgets`
- Tags: `ai`, `bar`, `quickshell`
- Root preview: `preview.png`
- License: MIT, with external dependencies documented in
  `THIRD_PARTY_NOTICES.md`

The official automated baseline limits scanned text files to 512 KiB each and
8 MiB in aggregate. OmaPilot's generated broker and Codex ACP launchers are
expected to produce a truthful `review-required` result for bundled executable
binaries; that disposition requires marketplace maintainer review but is not a
selectively blocking finding. Any `needs-fixes` result or incomplete scan blocks
submission readiness.

The exact proposed issue is in [`marketplace-submission.md`](marketplace-submission.md).
Do not create it until the owner reviews that exact title/body, confirms all
five checklist statements (including preview ownership), and explicitly
approves submission.
