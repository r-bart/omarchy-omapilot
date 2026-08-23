# Third-party notices

OmaPilot's source is MIT licensed. Release bundles include third-party software governed by its own license.

| Component | Pinned release | License | Source |
| --- | --- | --- | --- |
| Pi Coding Agent | `@earendil-works/pi-coding-agent@0.84.2` | MIT | <https://github.com/earendil-works/pi> |
| Codex ACP | `@agentclientprotocol/codex-acp@1.1.14` | Apache-2.0 | <https://github.com/agentclientprotocol/codex-acp> |
| OpenCode ACP | Supplied by the user's installed OpenCode harness | See installed OpenCode distribution | <https://opencode.ai> |

The exact transitive dependency graph and declared licenses for each runtime
archive are recorded in its generated CycloneDX `sbom.cdx.json`. The broker's
complete embedded-payload license inventory is shipped as
`runtime/dist/omapilot-broker.THIRD_PARTY_LICENSES.txt`; adapter notices are
shipped beside the generated launcher. This notice is attribution, not a
replacement for those license texts.
