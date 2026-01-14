import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import * as path from "path";

// Disable GPU and hardware acceleration to run on lower end machines
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-rasterization");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("--no-sandbox");
app.disableHardwareAcceleration();

function getIconPath(filename: string): string {
  if (app.isPackaged) {
    // In production, use the resources directory
    return path.join(process.resourcesPath, filename);
  } else {
    // In development, use the resources directory from project root
    return path.join(__dirname, "..", "..", "resources", filename);
  }
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    icon: getIconPath("icon.ico"),
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  // Maximize the window once it's ready to be shown
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC handlers
  setupIpcHandlers();

  // Create main window
  const mainWindow = createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Setup IPC handlers
function setupIpcHandlers(): void {
  // Basic app info
  ipcMain.handle("app:get-version", () => app.getVersion());

  // Auto-launch functionality
  ipcMain.handle(
    "app:get-auto-launch-state",
    () => app.getLoginItemSettings().openAtLogin
  );
  ipcMain.handle("app:set-auto-launch", (_, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
    });
  });

  // External URL handling
  ipcMain.handle("open:external-url", (_, url: string) => {
    shell.openExternal(url);
  });

  // Generic app status events
  ipcMain.on("app:action", (event, action: string, data?: any) => {
    // Handle app actions here
    console.log(`Received app action: ${action}`, data);
  });

  // Ping/pong for connection testing
  ipcMain.on("ping", (event) => {
    event.sender.send("pong");
  });
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
