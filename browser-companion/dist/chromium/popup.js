const api = globalThis.browser ?? globalThis.chrome;
const button = document.querySelector("#enable");
const status = document.querySelector("#status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Requesting site access…";
  try {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string" || tab.incognito)
      throw new Error("This tab cannot be enabled.");
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Browser and extension pages cannot be enabled.");
    const origin = url.origin;
    const granted = await api.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Site access was not granted.");
    const result = await api.runtime.sendMessage({ version: 1, type: "permission.register", origin, tabId: tab.id });
    status.textContent = result?.ok ? `Enabled for ${result.origin}` : (result?.message ?? "Could not enable this site.");
    if (!result?.ok) button.disabled = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The OmaPilot companion is unavailable.";
    button.disabled = false;
  }
});
