import QtQuick

Item {
  id: root

  required property Item focusRoot
  property Item activeFocusItem: null
  property bool panelActive: false
  property bool modalInteractionActive: false
  property bool workInAppShortcutEnabled: false

  signal workInAppRequested()

  function isEditableTextControl(item) {
    if (!item || item.enabled === false) return false
    return typeof item.text === "string"
      && typeof item.cursorPosition === "number"
      && typeof item.selectionStart === "number"
      && typeof item.selectionEnd === "number"
  }

  function directionForKey(key, modifiers) {
    var unmodified = modifiers === Qt.NoModifier
      || modifiers === Qt.KeypadModifier
    if (!unmodified) return ""
    if (key === Qt.Key_Up || key === Qt.Key_K) return "up"
    if (key === Qt.Key_Down || key === Qt.Key_J) return "down"
    if (key === Qt.Key_Left || key === Qt.Key_H) return "left"
    if (key === Qt.Key_Right || key === Qt.Key_L) return "right"
    return ""
  }

  function shouldHandleNavigationKey(key, modifiers, item) {
    return root.panelActive
      && !root.modalInteractionActive
      && !root.isEditableTextControl(item)
      && root.directionForKey(key, modifiers) !== ""
  }

  function isFocusableCandidate(item) {
    return item
      && item !== root.focusRoot
      && item.visible
      && item.enabled
      && item.activeFocusOnTab
  }

  function focusChainCandidates(current) {
    var candidates = []
    if (!current || typeof current.nextItemInFocusChain !== "function")
      return candidates
    var candidate = current.nextItemInFocusChain(true)
    var remaining = 512
    while (candidate && candidate !== current && remaining > 0) {
      if (root.isFocusableCandidate(candidate)) candidates.push(candidate)
      candidate = candidate.nextItemInFocusChain(true)
      remaining -= 1
    }
    return candidates
  }

  function centerInFocusRoot(item) {
    return item.mapToItem(root.focusRoot, item.width / 2, item.height / 2)
  }

  function spatialCandidate(current, direction) {
    var origin = root.centerInFocusRoot(current)
    var candidates = root.focusChainCandidates(current)
    var best = null
    var bestScore = Number.POSITIVE_INFINITY
    for (var i = 0; i < candidates.length; i++) {
      var point = root.centerInFocusRoot(candidates[i])
      var dx = point.x - origin.x
      var dy = point.y - origin.y
      var primary = 0
      var cross = 0
      if (direction === "up" && dy < -1) {
        primary = -dy; cross = Math.abs(dx)
      } else if (direction === "down" && dy > 1) {
        primary = dy; cross = Math.abs(dx)
      } else if (direction === "left" && dx < -1) {
        primary = -dx; cross = Math.abs(dy)
      } else if (direction === "right" && dx > 1) {
        primary = dx; cross = Math.abs(dy)
      } else continue

      // Prefer the closest control in the intended row/column, with distance
      // in the requested direction breaking ties.
      var score = cross * 4 + primary
      if (score < bestScore) {
        best = candidates[i]
        bestScore = score
      }
    }
    return best
  }

  function orderedCandidate(current, forward) {
    if (!current || typeof current.nextItemInFocusChain !== "function") return null
    var candidate = current.nextItemInFocusChain(forward)
    var remaining = 512
    while (candidate && candidate !== current && remaining > 0) {
      if (root.isFocusableCandidate(candidate)) return candidate
      candidate = candidate.nextItemInFocusChain(forward)
      remaining -= 1
    }
    return null
  }

  function moveFocus(current, direction) {
    if (!current) return false
    var candidate = root.spatialCandidate(current, direction)
    if (!candidate) candidate = root.orderedCandidate(
      current, direction === "right" || direction === "down")
    if (!candidate) return false
    candidate.forceActiveFocus(Qt.TabFocusReason)
    return candidate.activeFocus
  }

  function handleKey(event) {
    var item = root.activeFocusItem
    if (!root.shouldHandleNavigationKey(event.key, event.modifiers, item)) return
    var direction = root.directionForKey(event.key, event.modifiers)
    if (root.moveFocus(item, direction)) event.accepted = true
  }

  Shortcut {
    sequence: "Ctrl+Shift+A"
    context: Qt.WindowShortcut
    enabled: root.panelActive
      && root.workInAppShortcutEnabled
      && !root.modalInteractionActive
    onActivated: root.workInAppRequested()
  }
}
