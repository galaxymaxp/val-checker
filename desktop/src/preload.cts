import { contextBridge, ipcRenderer } from "electron";

/**
 * The ONLY privileged surface exposed to the loaded web app. Sandboxed preload
 * scripts must be CommonJS, hence the .cts extension in this ESM package.
 *
 * Nothing else is exposed: no generic IPC, no fs, no shell. The renderer can
 * only ask the main process to run the Riot capture flow and receive the jar.
 */
contextBridge.exposeInMainWorld("valChecker", {
  isDesktop: true,
  connectRiot: () => ipcRenderer.invoke("val-checker:connect-riot"),
});
