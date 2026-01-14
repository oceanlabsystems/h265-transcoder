import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Custom APIs for renderer
const api = {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      const validChannels = [
        // Add your valid channels here
        "app:get-version",
        "app:get-auto-launch-state",
        "app:set-auto-launch",
        "open:external-url",
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    on: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = [
        // Add your valid event channels here
        "app:status-changed",
      ];
      if (validChannels.includes(channel)) {
        // Strip event as it includes `sender` and is a security risk
        const subscription = (_event: IpcRendererEvent, ...args: any[]) =>
          func(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      return () => {};
    },
    send: (channel: string, ...args: any[]) => {
      const validChannels = [
        // Add your valid send channels here
        "app:action",
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      }
    },
    once: (channel: string, func: (...args: any[]) => void) => {
      ipcRenderer.once(channel, (_event, data) => func(data));
    },
    removeListener: (channel: string, func: (...args: any[]) => void) => {
      ipcRenderer.removeListener(channel, func);
    },
    removeAllListeners: (channel: string) => {
      ipcRenderer.removeAllListeners(channel);
    },
  },
};

// Debug helper to log to console
function log(message: string): void {
  console.log(`[preload] ${message}`);
}

log("Preload script starting");

try {
  log("Setting up electronAPI");

  if (process.contextIsolated) {
    log("Using contextBridge for isolated context");

    // Expose to renderer via context bridge
    contextBridge.exposeInMainWorld("api", api);

    // For debugging - expose status flag
    contextBridge.exposeInMainWorld("preloadComplete", true);

    log("contextBridge.exposeInMainWorld completed");
  } else {
    log("Direct window assignment for non-isolated context");

    // Direct assignment to window
    (window as any).api = api;
    (window as any).preloadComplete = true;

    log("Direct window assignments completed");
  }

  // Set up ping responder
  ipcRenderer.on("ping", () => {
    log("Received ping from main process");
    try {
      ipcRenderer.send("pong");
      log("Sent pong response");
    } catch (err) {
      log(`Error sending pong: ${err}`);
    }
  });

  log("Preload script completed successfully");
} catch (error) {
  console.error(`[preload] Error in preload script: ${error}`);
}
