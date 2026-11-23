"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capitolUpdater", Object.freeze({
  downloadLatest: () => ipcRenderer.invoke("app-update:download"),
  installLatest: () => ipcRenderer.invoke("app-update:install"),
  onDownloadProgress(callback) {
    if (typeof callback !== "function") throw new TypeError("A progress callback is required.");
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("app-update:progress", listener);
    return () => ipcRenderer.removeListener("app-update:progress", listener);
  },
}));
