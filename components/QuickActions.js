.pragma library

var maximumActions = 5
var defaultIcon = "\ueb7f"
var catalog = [
  {
    id: "summarize-window",
    label: "Summarize the active window",
    icon: "\uec10",
    prompt: "Summarize the active window and call out anything that needs my attention."
  },
  {
    id: "work-in-app",
    label: "Work in an app…",
    icon: "\ueb7f",
    prompt: "In the active app, "
  }
]

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/^\s+|\s+$/g, "")
}

function actionCopy(action) {
  return {
    id: String(action.id || ""),
    label: String(action.label || ""),
    icon: String(action.icon || defaultIcon),
    prompt: String(action.prompt || "")
  }
}

function defaultActions(showSummarize, showWorkInApp) {
  var result = []
  for (var i = 0; i < catalog.length; i++) {
    var action = catalog[i]
    if (action.id === "summarize-window" && showSummarize === false) continue
    if (action.id === "work-in-app" && showWorkInApp === false) continue
    result.push(actionCopy(action))
  }
  return result
}

function normalizedActions(input) {
  var source = Array.isArray(input) ? input : []
  var result = []
  var ids = ({})
  for (var i = 0; i < source.length && result.length < maximumActions; i++) {
    var raw = source[i] && typeof source[i] === "object" ? source[i] : {}
    var label = trimmed(raw.label).slice(0, 48)
    var prompt = String(raw.prompt === undefined || raw.prompt === null ? "" : raw.prompt)
      .slice(0, 1200)
    if (label === "" || trimmed(prompt) === "") continue
    var baseId = trimmed(raw.id).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 72)
    if (baseId === "") baseId = "action-" + String(i + 1)
    var id = baseId
    var suffix = 2
    while (ids[id]) {
      id = baseId.slice(0, 64) + "-" + String(suffix)
      suffix++
    }
    ids[id] = true
    result.push({
      id: id,
      label: label,
      icon: trimmed(raw.icon).slice(0, 8) || defaultIcon,
      prompt: prompt
    })
  }
  return result
}

function parsedActions(serialized) {
  if (Array.isArray(serialized)) return normalizedActions(serialized)
  var value = trimmed(serialized)
  if (value === "") return null
  try {
    var parsed = JSON.parse(value)
    return Array.isArray(parsed) ? normalizedActions(parsed) : null
  } catch (error) {
    return null
  }
}

function actionsFromSettings(serialized, showSummarize, showWorkInApp) {
  var parsed = parsedActions(serialized)
  return parsed === null
    ? defaultActions(showSummarize, showWorkInApp)
    : parsed
}

function serializedActions(actions) {
  return JSON.stringify(normalizedActions(actions))
}

function addAction(actions, label, prompt, token) {
  var result = normalizedActions(actions)
  if (result.length >= maximumActions) return result
  result.push({
    id: "custom-" + String(token || Date.now()).replace(/[^A-Za-z0-9_-]/g, "-"),
    label: trimmed(label),
    icon: defaultIcon,
    prompt: String(prompt || "")
  })
  return normalizedActions(result)
}

function updateAction(actions, index, label, prompt) {
  var result = normalizedActions(actions)
  var selected = Number(index)
  if (!isFinite(selected) || selected < 0 || selected >= result.length) return result
  var updated = actionCopy(result[selected])
  updated.label = trimmed(label)
  updated.prompt = String(prompt || "")
  if (updated.label === "" || trimmed(updated.prompt) === "") return result
  result[selected] = updated
  return normalizedActions(result)
}

function removeAction(actions, index) {
  var result = normalizedActions(actions)
  var selected = Number(index)
  if (!isFinite(selected) || selected < 0 || selected >= result.length) return result
  result.splice(selected, 1)
  return result
}

function moveAction(actions, index, delta) {
  var result = normalizedActions(actions)
  var selected = Number(index)
  var destination = selected + Number(delta)
  if (!isFinite(selected) || !isFinite(destination)
      || selected < 0 || selected >= result.length
      || destination < 0 || destination >= result.length) return result
  var moved = result[selected]
  result.splice(selected, 1)
  result.splice(destination, 0, moved)
  return result
}

function promptFor(actions, actionId) {
  var source = normalizedActions(actions)
  var selected = String(actionId || "")
  for (var i = 0; i < source.length; i++)
    if (source[i].id === selected) return source[i].prompt
  return ""
}
