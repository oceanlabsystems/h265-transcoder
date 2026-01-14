import { contextBridge, ipcRenderer } from "electron";

// Increase the max listeners limit to prevent warnings
ipcRenderer.setMaxListeners(50);

// Generic API for the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // App lifecycle methods
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  getAutoLaunchState: () => ipcRenderer.invoke("app:get-auto-launch-state"),
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke("app:set-auto-launch", enabled),

  // Generic event listeners
  onAppStatusChange: (callback: (status: any) => void) =>
    ipcRenderer.on("app:status-changed", (_, status) => callback(status)),

  // Generic actions
  sendAppAction: (action: string, data?: any) =>
    ipcRenderer.send("app:action", action, data),

  // External URL handling
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke("open:external-url", url),

  // Ports API
  getInputPortTypes: () => ipcRenderer.invoke("ports:get-input-types"),
  getPortConfig: (portId: string, isInput: boolean) =>
    ipcRenderer.invoke("ports:get-port-config", portId, isInput),
  checkPortConflict: (config: any) =>
    ipcRenderer.invoke("ports:check-conflict", config),
  getPortStatus: (portId: string) =>
    ipcRenderer.invoke("ports:get-status", portId),
  onPortStatusUpdate: (
    callback: (data: { portId: string; status: string }) => void
  ) => ipcRenderer.on("port:status-update", (_, data) => callback(data)),
  onPortStatusBroadcast: (callback: (data: any) => void) =>
    ipcRenderer.on("port:status-broadcast", (_, data) => {
      callback(data);
    }),

  // Discovery API
  listComPorts: () => ipcRenderer.invoke("discovery:list-com-ports"),
  checkComPort: (path: string) =>
    ipcRenderer.invoke("discovery:check-com-port", path),
  getNetworkInterfaces: () =>
    ipcRenderer.invoke("discovery:get-network-interfaces"),
  getIPv4Addresses: () => ipcRenderer.invoke("discovery:get-ipv4-addresses"),
  getIPv6Addresses: () => ipcRenderer.invoke("discovery:get-ipv6-addresses"),
  getExternalAddresses: () =>
    ipcRenderer.invoke("discovery:get-external-addresses"),
});
