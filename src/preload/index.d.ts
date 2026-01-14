import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      ipcRenderer: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        on(channel: string, func: (...args: any[]) => void): void;
        once(channel: string, func: (...args: any[]) => void): void;
        removeListener(channel: string, func: (...args: any[]) => void): void;
        removeAllListeners(channel: string): void;
      };
    };
    electronAPI: {
      // App lifecycle methods
      getAppVersion(): Promise<string>;
      getAutoLaunchState(): Promise<boolean>;
      setAutoLaunch(enabled: boolean): Promise<void>;

      // Generic event listeners
      onAppStatusChange(callback: (status: any) => void): void;

      // Generic actions
      sendAppAction(action: string, data?: any): void;

      // External URL handling
      openExternalUrl(url: string): Promise<void>;
    };
  }
}
