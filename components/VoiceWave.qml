import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons

// A living ribbon of light along the bottom edge.
//
// Deliberately NOT a level meter. The broker reports recording/transcribing/idle
// with no amplitude, so a bar-graph VU would be inventing data — it would read as
// "this is your voice" while being pure decoration. This says "listening", not
// "73% loud".
//
// Two earlier shapes were rejected for concrete reasons:
//
//   * scrolling a static path and masking the ends was cheap, but the mask could
//     not stay aligned with a blur-padded effect rect, which clipped the ribbon
//     into a hard vertical edge;
//   * rebuilding ~170 points every frame at 60fps cost ~25% of a core for
//     decoration.
//
// So the taper is baked into the geometry — no mask, nothing to misalign, and
// autoPadding is free to grow for the bloom — while the phase advances on a
// timer rather than a per-frame binding. Three layers at different frequencies
// and drift directions keep it from ever repeating exactly.
Item {
  id: root

  property color accent: Color.accent
  property real level: 0.5          // 0..1, swells the ribbon
  property real intensity: 1        // overall opacity multiplier
  property bool motionEnabled: true

  readonly property var layers: [
    { frequency: 1.3, drift:  1.00, weight: 1.00, thickness: 3.0, amplitude: 1.00 },
    { frequency: 2.1, drift: -0.62, weight: 0.74, thickness: 2.2, amplitude: 0.78 },
    { frequency: 3.4, drift:  0.41, weight: 0.52, thickness: 1.6, amplitude: 0.55 }
  ]
  readonly property int samples: 44

  property real phase: 0

  // 30fps rather than a 60fps binding. The ribbon drifts slowly, so half the
  // updates are indistinguishable and cost half the CPU.
  Timer {
    interval: 33
    repeat: true
    running: root.motionEnabled && root.visible
    onTriggered: root.phase = (root.phase + 0.028) % (Math.PI * 2)
  }

  function wavePoints(layer) {
    var points = []
    var w = root.width
    var h = root.height
    if (w <= 0 || h <= 0) return points
    var mid = h * 0.5
    var peak = mid * 0.86 * layer.amplitude * (0.3 + root.level * 0.7)
    for (var i = 0; i <= root.samples; i++) {
      var t = i / root.samples
      // Raised-cosine envelope: zero at both ends, full in the middle. Baked in,
      // so the ribbon disperses instead of terminating — and because it lives in
      // the geometry there is no mask to fall out of alignment.
      var envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * t)
      // Two summed harmonics per layer so no single sine is recognisable.
      var wave = Math.sin(t * Math.PI * 2 * layer.frequency + root.phase * layer.drift)
        + 0.35 * Math.sin(t * Math.PI * 2 * layer.frequency * 2.3 - root.phase * layer.drift * 1.7)
      points.push(Qt.point(t * w, mid + wave * peak * envelope * 0.74))
    }
    return points
  }

  Item {
    id: waves
    anchors.fill: parent
    visible: false

    Repeater {
      model: root.layers

      Shape {
        required property var modelData
        anchors.fill: parent
        preferredRendererType: Shape.CurveRenderer
        opacity: modelData.weight

        ShapePath {
          strokeColor: root.accent
          strokeWidth: Math.max(1.2, Style.spaceReal(modelData.thickness))
          fillColor: "transparent"
          capStyle: ShapePath.RoundCap
          joinStyle: ShapePath.RoundJoin

          PathPolyline {
            path: root.phase >= 0 && root.width > 0 && root.height > 0
              ? root.wavePoints(modelData) : []
          }
        }
      }
    }
  }

  // autoPadding on: the bloom needs room to spread past the item bounds, and
  // denying it is exactly what produced the hard edge.
  MultiEffect {
    anchors.fill: waves
    source: waves
    autoPaddingEnabled: true
    blurEnabled: true
    blur: 1
    blurMax: 26
    blurMultiplier: 1.0
    brightness: 0.75
    colorization: 1
    colorizationColor: root.accent
    opacity: root.intensity
  }

  // The bloom alone is atmosphere without a subject: over a light window it
  // washes out entirely. This crisp pass gives the ribbon a readable edge so the
  // motion is legible rather than merely sensed.
  ShaderEffectSource {
    anchors.fill: waves
    sourceItem: waves
    hideSource: false
    opacity: root.intensity * 0.7
  }
}
