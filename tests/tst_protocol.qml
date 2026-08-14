import QtQuick
import QtTest
import "../components/Protocol.js" as Protocol

TestCase {
  name: "QuickchatProtocol"

  function test_parseLineRejectsInvalidInput() {
    compare(Protocol.parseLine("not json"), null)
    compare(Protocol.parseLine("[]"), null)
    compare(Protocol.parseLine('{"type":"ready"}').type, "ready")
  }

  function test_protocolCompatibilityFailsClosed() {
    verify(Protocol.isCompatibleEvent({ protocolVersion: 1 }))
    verify(!Protocol.isCompatibleEvent({ protocolVersion: 2 }))
    verify(!Protocol.isCompatibleEvent({}))
  }

  function test_providerContractUsesCapabilitiesAndNamedModels() {
    var providers = Protocol.normalizeProviders([{
      id: "codex",
      ready: true,
      capabilities: ["answer", "web"],
      models: [{ id: "gpt-5", name: "GPT-5" }]
    }, {
      id: "claude",
      ready: true,
      capabilities: ["answer", "web", "tools"]
    }, {
      id: "opencode",
      ready: true,
      capabilities: ["answer", "web"]
    }])
    compare(providers.length, 3)
    compare(providers[0].value, "codex")
    compare(providers[0].models[0].label, "GPT-5")
    verify(Protocol.providerSupportsWeb(providers, "codex"))
    verify(!Protocol.providerSupportsTools(providers, "codex"))
    verify(Protocol.providerSupportsTools(providers, "claude"))
    verify(!Protocol.providerSupportsTools(providers, "opencode"))
  }

  function test_toolPermissionIsBoundToCurrentTurn() {
    var permission = Protocol.normalizedPermission({
      id: "permission-1", requestId: "turn-1", title: "Run uname",
      kind: "execute", detail: "uname -s", allowOnce: true
    }, "turn-1")
    compare(permission.detail, "uname -s")
    verify(permission.allowOnce)
    compare(Protocol.normalizedPermission({ id: "permission-1", requestId: "other", kind: "execute" }, "turn-1"), null)
    compare(Protocol.normalizedPermission({ id: "permission-1", requestId: "turn-1", kind: "edit" }, "turn-1"), null)
  }

  function test_localActionPermissionIsBoundToCurrentTurn() {
    var permission = Protocol.normalizedPermission({
      id: "permission-2", requestId: "turn-2", title: "Launch Zoom",
      kind: "local_action", detail: "Zoom.desktop", allowOnce: true
    }, "turn-2")
    compare(permission.kind, "local_action")
    compare(permission.title, "Launch Zoom")
    compare(Protocol.normalizedPermission({ id: "permission-2", requestId: "other", kind: "local_action" }, "turn-2"), null)
    compare(Protocol.normalizedPermission({ id: "permission-2", requestId: "turn-2", kind: "arbitrary_action" }, "turn-2"), null)
  }

  function test_defaultSubmitOmitsEmptyModel() {
    var payload = Protocol.submitCommand("1", "Hello", "codex", "", "answer")
    compare(payload.type, "submit")
    compare(payload.provider, "codex")
    verify(payload.model === undefined)
    payload = Protocol.submitCommand("2", "Hello", "claude", " opus ", "web")
    compare(payload.model, "opus")
  }

  function test_markdownImagesRequireExplicitLoading() {
    var output = Protocol.sanitizeMarkdown("![chart](https://example.com/chart.png)")
    verify(output.indexOf("quickchat-image:") >= 0)
    verify(output.indexOf("![") < 0)
    compare(Protocol.imageUrl(output.match(/\((quickchat-image:[^)]+)\)/)[1]), "https://example.com/chart.png")
  }

  function test_remoteImageCompletionReplacesPlaceholder() {
    var remoteUrl = "https://example.com/chart.png"
    var images = [{ id: "placeholder", state: "placeholder", remoteUrl: remoteUrl, alt: "Chart" }]
    var merged = Protocol.mergeImageEvent(images, {
      type: "image",
      id: remoteUrl,
      image: { sourceUrl: remoteUrl, localUrl: "file:///tmp/chart.png", state: "ready", alt: "Chart" }
    }, "request-1")
    compare(merged.length, 1)
    compare(merged[0].source, "file:///tmp/chart.png")
    compare(merged[0].state, "ready")
  }

  function test_localImageInfersReadyState() {
    var image = Protocol.normalizedImage({ localUrl: "file:///tmp/direct.png", alt: "Direct image" })
    compare(image.state, "ready")
    compare(image.source, "file:///tmp/direct.png")
  }

  function test_referenceAndHtmlImagesAreNeutralized() {
    var input = "![plot][chart]\n\n[chart]: https://example.com/plot.png\n<img src=\"https://tracker.example/pixel.png\">"
    var output = Protocol.sanitizeMarkdown(input)
    verify(output.indexOf("quickchat-image:") >= 0)
    verify(output.indexOf("<img") < 0)
    verify(output.indexOf("tracker.example") < 0)
    verify(output.indexOf("https://example.com/plot.png") < 0)
    verify(output.indexOf("![") < 0)
  }

  function test_allCommonMarkImageOpenersAreNeutralized() {
    var cases = [
      "![logo][]\n\n[logo]: https://example.com/logo.png",
      "![logo]\n\n[logo]: https://example.com/logo.png",
      "![nested [label]](https://example.com/nested.png)",
      "![escaped \\] label](https://example.com/escaped.png)",
      "prefix ![unterminated https://127.0.0.1/private"
    ]
    for (var i = 0; i < cases.length; i++) {
      var output = Protocol.sanitizeMarkdown(cases[i])
      verify(output.indexOf("![") < 0, "unsafe image opener survived: " + output)
    }
  }

  function test_herdrOutcomesAreNotPrematurelySuccessful() {
    compare(Protocol.herdrOutcome({ state: "opening" }).state, "preparing")
    compare(Protocol.herdrOutcome({ state: "continued", mode: "native" }).message, "Continued native session in Herdr")
    compare(Protocol.herdrOutcome({ state: "failed", message: "No Herdr" }).state, "error")
    compare(Protocol.herdrOutcome({ state: "unavailable" }).toast, false)
  }

  function test_linkSchemeAllowlist() {
    verify(Protocol.isSafeExternalUrl("https://example.com"))
    verify(Protocol.isSafeExternalUrl("mailto:hello@example.com"))
    verify(!Protocol.isSafeExternalUrl("javascript:alert(1)"))
    verify(!Protocol.isSafeExternalUrl("file:///etc/passwd"))
  }

  function test_codeFencesBecomeCopyableBlocks() {
    var blocks = Protocol.markdownBlocks("Before\n```js\nconst ok = true\n```\nAfter")
    compare(blocks.length, 3)
    compare(blocks[1].kind, "code")
    compare(blocks[1].language, "js")
    compare(blocks[1].text, "const ok = true")
  }

  function test_historyUsesBrokerRecordShapeAndCapsAtThirty() {
    var input = []
    for (var i = 0; i < 31; i++) input.push({
      id: String(i),
      question: "Question " + i,
      answer: "Answer " + i,
      createdAt: "2026-08-11T12:00:00Z",
      session: { resumable: i === 0 }
    })
    var rows = Protocol.normalizedHistory(input)
    compare(rows.length, 30)
    compare(rows[0].timestamp, "2026-08-11T12:00:00Z")
    verify(rows[0].resumable)
  }
}
