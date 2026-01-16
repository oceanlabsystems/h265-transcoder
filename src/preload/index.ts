import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Custom APIs for renderer
const api = {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      const validChannels = [
        // Video processing
        "video:select-input-directory",
        "video:select-output-directory",
        "video:scan-directory",
        "video:start-batch-process",
        "video:start-watch-mode",
        "video:stop-watch-mode",
        // Window controls
        "window:close",
        "window:minimize",
        "window:maximize",
        "window:is-maximized",
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    on: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = [
        "video:progress-update",
        "video:watch-status",
        "video:watch-file-added",
      ];
      if (validChannels.includes(channel)) {
        const subscription = (_event: IpcRendererEvent, ...args: any[]) =>
          func(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      return () => {};
    },
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("api", api);
} else {
  (window as any).api = api;
}
