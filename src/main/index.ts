import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import * as path from "path";
import * as fs from "fs";
import { processVideoFile } from "./gstreamer/video-split";
import { BatchProcessConfig, ProcessStatus } from "./types/types";

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
  // Use platform-appropriate icons
  const windowIcon =
    process.platform === "win32"
      ? getIconPath("icon.ico")
      : process.platform === "darwin"
        ? getIconPath("icon.png")
        : icon; // Linux uses the imported PNG asset

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    show: false,
    frame: false,
    icon: windowIcon,
    autoHideMenuBar: true,
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

// Store main window reference for progress updates
let mainWindow: BrowserWindow | null = null;

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
  mainWindow = createWindow();

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
  ipcMain.on("app:action", (_event, action: string, data?: any) => {
    // Handle app actions here
    console.log(`Received app action: ${action}`, data);
  });

  // Ping/pong for connection testing
  ipcMain.on("ping", (event) => {
    event.sender.send("pong");
  });

  // Window controls for frameless window
  ipcMain.handle("window:close", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.close();
    }
  });

  ipcMain.handle("window:minimize", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle("window:maximize", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle("window:is-maximized", () => {
    const window = BrowserWindow.getFocusedWindow();
    return window ? window.isMaximized() : false;
  });

  // Video processing IPC handlers
  ipcMain.handle("video:select-input-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Input Directory",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("video:select-output-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Output Directory",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("video:scan-directory", async (_, dirPath: string) => {
    try {
      if (!fs.existsSync(dirPath)) {
        return [];
      }
      const files = fs
        .readdirSync(dirPath)
        .filter((file) => {
          const lowerFile = file.toLowerCase();
          // Filter out macOS metadata files (start with ._)
          // Filter out hidden files (start with .)
          // Only include .mov files
          return (
            lowerFile.endsWith(".mov") &&
            !file.startsWith("._") &&
            !file.startsWith(".")
          );
        })
        .map((file) => ({
          name: file,
          path: path.join(dirPath, file),
        }));
      return files;
    } catch (error) {
      console.error("Error scanning directory:", error);
      return [];
    }
  });

  ipcMain.handle(
    "video:start-batch-process",
    async (_, config: BatchProcessConfig) => {
      try {
        // Verify directories exist
        if (!fs.existsSync(config.inputDirectory)) {
          throw new Error("Input directory does not exist");
        }
        if (!fs.existsSync(config.outputDirectory)) {
          fs.mkdirSync(config.outputDirectory, { recursive: true });
        }

        // Scan for .MOV files and get their sizes for byte-based progress tracking
        const files = fs
          .readdirSync(config.inputDirectory)
          .filter((file) => {
            const lowerFile = file.toLowerCase();
            // Filter out macOS metadata files (start with ._)
            // Filter out hidden files (start with .)
            // Only include .mov files
            return (
              lowerFile.endsWith(".mov") &&
              !file.startsWith("._") &&
              !file.startsWith(".")
            );
          })
          .map((file) => {
            const filePath = path.join(config.inputDirectory, file);
            const stats = fs.statSync(filePath);
            return {
              path: filePath,
              name: file,
              size: stats.size, // File size in bytes
            };
          });

        if (files.length === 0) {
          throw new Error("No .MOV files found in input directory");
        }

        const totalFiles = files.length;

        // Calculate total bytes across all files for accurate progress tracking
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

        let processedFiles = 0;
        let totalBytesProcessed = 0; // Track total bytes processed across all files

        // Send initial status
        sendProgressUpdate({
          currentFile: "",
          currentFileIndex: 0,
          totalFiles,
          currentChunk: 0,
          totalChunks: 0,
          fileProgress: 0,
          chunkProgress: 0,
          overallProgress: 0,
          status: "processing",
        });

        // Process each file sequentially
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const filePath = file.path;
          const fileName = file.name;
          const fileSize = file.size;

          sendProgressUpdate({
            currentFile: fileName,
            currentFileIndex: i + 1,
            totalFiles,
            currentChunk: 0,
            totalChunks: 0,
            fileProgress: 0,
            chunkProgress: 0,
            overallProgress: Math.round(
              (totalBytesProcessed / totalBytes) * 100
            ),
            status: "processing",
          });

          try {
            await processVideoFile(
              filePath,
              config.outputDirectory,
              config,
              (progressStatus) => {
                // Calculate bytes processed for current file
                const currentFileProcessedBytes =
                  (progressStatus.fileProgress / 100) * fileSize;

                // Calculate total bytes processed (completed files + current file progress)
                const totalProcessedBytes =
                  totalBytesProcessed + currentFileProcessedBytes;

                // Calculate overall progress based on bytes (industry best practice)
                const overallProgress = Math.round(
                  (totalProcessedBytes / totalBytes) * 100
                );

                console.log(
                  `[Progress Update] File: ${progressStatus.fileProgress}%, ` +
                    `Chunk: ${progressStatus.currentChunk}/${progressStatus.totalChunks} (${progressStatus.chunkProgress}%), ` +
                    `Overall: ${overallProgress}% ` +
                    `(${(totalProcessedBytes / (1024 * 1024 * 1024)).toFixed(2)}GB / ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)}GB)`
                );

                // Calculate overall ETA based on bytes and processing speed
                let overallEta: number | undefined;

                if (
                  progressStatus.processingSpeed &&
                  progressStatus.processingSpeed > 0 &&
                  fileSize > 0
                ) {
                  // Calculate bytes per second from current file's processing
                  // Convert video speed to bytes/second: (fileSize / fileDuration) * processingSpeed
                  // But we need fileDuration - let's estimate from fileEta
                  if (
                    progressStatus.fileEta !== undefined &&
                    progressStatus.fileEta > 0
                  ) {
                    // Estimate bytes/second: remaining bytes / remaining time
                    const currentFileRemainingBytes =
                      fileSize - currentFileProcessedBytes;
                    const bytesPerSecond =
                      currentFileRemainingBytes / progressStatus.fileEta;

                    // Calculate remaining bytes across all files
                    const remainingBytes = totalBytes - totalProcessedBytes;

                    if (bytesPerSecond > 0 && remainingBytes > 0) {
                      overallEta = Math.round(remainingBytes / bytesPerSecond);
                    }
                  }
                } else if (progressStatus.fileEta !== undefined) {
                  // Fallback: estimate based on remaining files and current file ETA
                  const remainingBytes = totalBytes - totalProcessedBytes;
                  const currentFileRemainingBytes =
                    fileSize - currentFileProcessedBytes;

                  if (
                    currentFileRemainingBytes > 0 &&
                    progressStatus.fileEta > 0
                  ) {
                    // Estimate bytes/second from current file
                    const bytesPerSecond =
                      currentFileRemainingBytes / progressStatus.fileEta;

                    // Estimate remaining bytes in other files
                    const remainingFilesBytes =
                      remainingBytes - currentFileRemainingBytes;

                    if (bytesPerSecond > 0 && remainingFilesBytes > 0) {
                      // Estimate time for remaining files
                      const remainingFilesTime = Math.round(
                        remainingFilesBytes / bytesPerSecond
                      );
                      overallEta = progressStatus.fileEta + remainingFilesTime;
                    } else {
                      overallEta = progressStatus.fileEta;
                    }
                  }
                }

                sendProgressUpdate({
                  currentFile: fileName,
                  currentFileIndex: i + 1,
                  totalFiles,
                  currentChunk: progressStatus.currentChunk,
                  totalChunks: progressStatus.totalChunks,
                  fileProgress: progressStatus.fileProgress,
                  chunkProgress: progressStatus.chunkProgress,
                  overallProgress: overallProgress,
                  status: "processing",
                  eta: overallEta,
                  chunkEta: progressStatus.chunkEta,
                  fileEta: progressStatus.fileEta,
                  processingSpeed: progressStatus.processingSpeed,
                });
              }
            );

            // After file completes, add its bytes to the total
            totalBytesProcessed += fileSize;
            processedFiles++;
          } catch (error) {
            console.error(`Error processing ${fileName}:`, error);
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            // Check if it's a file format error (like macOS metadata files)
            if (
              errorMessage.includes("Could not determine type of stream") ||
              errorMessage.includes("Could not parse duration")
            ) {
              console.warn(
                `Skipping invalid file: ${fileName} - ${errorMessage}`
              );
              // Skip this file and continue with the next one
              sendProgressUpdate({
                currentFile: fileName,
                currentFileIndex: i + 1,
                totalFiles,
                currentChunk: 0,
                totalChunks: 0,
                fileProgress: 0,
                chunkProgress: 0,
                overallProgress: Math.round(
                  (processedFiles / totalFiles) * 100
                ),
                status: "processing",
                error: `Skipped: ${errorMessage}`,
              });
              // Don't throw - continue processing other files
            } else {
              // For other errors, update status but continue processing
              sendProgressUpdate({
                currentFile: fileName,
                currentFileIndex: i + 1,
                totalFiles,
                currentChunk: 0,
                totalChunks: 0,
                fileProgress: 0,
                chunkProgress: 0,
                overallProgress: Math.round(
                  (processedFiles / totalFiles) * 100
                ),
                status: "error",
                error: errorMessage,
              });
              // Optionally: continue processing other files instead of throwing
              // Uncomment the next line to skip errors and continue:
              // continue;
              throw error;
            }
          }
        }

        // Send completion status
        sendProgressUpdate({
          currentFile: "",
          currentFileIndex: totalFiles,
          totalFiles,
          currentChunk: 0,
          totalChunks: 0,
          fileProgress: 100,
          chunkProgress: 100,
          overallProgress: 100,
          status: "completed",
        });

        return { success: true, processedFiles };
      } catch (error) {
        sendProgressUpdate({
          currentFile: "",
          currentFileIndex: 0,
          totalFiles: 0,
          currentChunk: 0,
          totalChunks: 0,
          fileProgress: 0,
          chunkProgress: 0,
          overallProgress: 0,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  );
}

function sendProgressUpdate(status: ProcessStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("video:progress-update", status);
  }
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
