const { app, BrowserWindow } = require("electron");
const { resolve } = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 720, height: 720, title: "OmaPilot Electron text action lab" });
  void window.loadFile(resolve(__dirname, "../../text-actions-lab.html"));
  window.on("closed", () => app.quit());
});
