import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import * as path from "path";
import * as fs from "fs";
import * as chokidar from "chokidar";
import {
  processVideoFile,
  ProcessCancelledError,
} from "./gstreamer/video-split";
import { BatchProcessConfig, ProcessStatus } from "./types/types";
import {
  detectAvailableEncoders,
  EncoderDetectionResult,
} from "../core/utils/encoder-detection";
import { RuntimeContext } from "../core/utils/gstreamer-path";

// Watch mode state
let fileWatcher: chokidar.FSWatcher | null = null;
let watchConfig: BatchProcessConfig | null = null;
let watchQueue: Array<{ path: string; name: string }> = [];
let isWatchProcessing = false;
let watchStats = {
  filesProcessed: 0,
  filesFailed: 0,
  filesQueued: 0,
};

// Batch processing cancellation state
let batchAbortController: AbortController | null = null;
let isBatchCancelled = false;

// Supported video file extensions
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".m2v",
  ".ts",
  ".mts",
  ".m2ts",
  ".vob",
  ".3gp",
  ".3g2",
  ".f4v",
  ".ogv",
  ".divx",
  ".asf",
]);

// Check if a file is a video file based on extension
function isVideoFile(filePath: string): boolean {
  const filename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  // Exclude TypeScript definition files (.d.ts)
  if (filename.endsWith(".d.ts")) {
    return false;
  }

  // Exclude paths containing common code directories
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/");
  const excludedDirs = [
    "/node_modules/",
    "/.git/",
    "/dist/",
    "/build/",
    "/out/",
    "/.next/",
    "/.nuxt/",
    "/vendor/",
    "/__pycache__/",
    "/.venv/",
    "/venv/",
  ];

  if (excludedDirs.some((dir) => normalizedPath.includes(dir))) {
    return false;
  }

  return VIDEO_EXTENSIONS.has(ext);
}

// Recursively scan directory for video files
function scanDirectoryRecursive(
  dirPath: string,
  baseDir: string = dirPath
): Array<{ name: string; path: string; relativePath: string }> {
  const results: Array<{ name: string; path: string; relativePath: string }> =
    [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files/directories
      if (entry.name.startsWith(".") || entry.name.startsWith("._")) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        results.push(...scanDirectoryRecursive(fullPath, baseDir));
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        // Calculate relative path from base directory
        const relativePath = path.relative(baseDir, fullPath);
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath: relativePath,
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return results;
}

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
    height: 700,
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

  // App info
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  // Encoder detection - detect available hardware encoders
  ipcMain.handle(
    "video:detect-encoders",
    async (): Promise<EncoderDetectionResult> => {
      const context: RuntimeContext = {
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath || app.getAppPath(),
      };

      try {
        const result = await detectAvailableEncoders(context);
        return result;
      } catch (error) {
        console.error("[Encoder Detection] Error:", error);
        // Return software-only fallback on error
        return {
          encoders: [
            {
              id: "x265",
              name: "Software (x265)",
              description: "CPU-based encoding (slower, always available)",
              gstreamerElement: "x265enc",
              available: true,
              recommended: true,
              priority: 10,
              platform: "all",
            },
          ],
          recommended: "x265",
          hasHardwareEncoder: false,
        };
      }
    }
  );

  // Cancel batch processing
  ipcMain.handle("video:cancel-batch-process", () => {
    if (batchAbortController) {
      console.log("[Batch Process] Cancellation requested by user");
      isBatchCancelled = true;
      batchAbortController.abort();
      return { success: true, message: "Cancellation requested" };
    }
    return { success: false, message: "No batch process running" };
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
      // Recursively scan for all video files
      const files = scanDirectoryRecursive(dirPath);
      console.log(
        `Found ${files.length} video file(s) in ${dirPath} (recursive scan)`
      );
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
        // Initialize cancellation state
        batchAbortController = new AbortController();
        isBatchCancelled = false;

        // Verify directories exist
        if (!fs.existsSync(config.inputDirectory)) {
          throw new Error("Input directory does not exist");
        }
        if (!fs.existsSync(config.outputDirectory)) {
          fs.mkdirSync(config.outputDirectory, { recursive: true });
        }

        // Recursively scan for video files and get their sizes for byte-based progress tracking
        const scannedFiles = scanDirectoryRecursive(config.inputDirectory);
        const files = scannedFiles.map((file) => {
          const stats = fs.statSync(file.path);
          return {
            path: file.path,
            name: file.name,
            relativePath: file.relativePath,
            size: stats.size, // File size in bytes
          };
        });

        if (files.length === 0) {
          throw new Error("No video files found in input directory");
        }

        console.log(`Starting batch process for ${files.length} video file(s)`);

        const totalFiles = files.length;

        // Calculate total bytes across all files for accurate progress tracking
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

        let processedFiles = 0;
        let skippedFiles = 0;
        let totalBytesProcessed = 0; // Track total bytes processed across all files
        const errors: Array<{ file: string; error: string }> = []; // Track all errors
        const batchStartTime = Date.now(); // Track start time for throughput calculation

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
          processedBytes: 0,
          totalBytes,
          throughputBps: 0,
        });

        // Process each file sequentially
        for (let i = 0; i < files.length; i++) {
          // Check if cancelled before processing next file
          if (isBatchCancelled) {
            console.log(
              `[Batch Process] Cancelled after ${processedFiles} file(s)`
            );
            break;
          }

          const file = files[i];
          const filePath = file.path;
          const fileName = file.relativePath || file.name; // Show relative path if available
          const fileSize = file.size;

          // Calculate current throughput
          const elapsedSeconds = (Date.now() - batchStartTime) / 1000;
          const currentThroughput =
            elapsedSeconds > 0 ? totalBytesProcessed / elapsedSeconds : 0;

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
            processedBytes: totalBytesProcessed,
            totalBytes,
            throughputBps: currentThroughput,
          });

          try {
            await processVideoFile(
              filePath,
              config.outputDirectory,
              config,
              (progressStatus) => {
                // Check if cancelled during progress callback
                if (isBatchCancelled) return;
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

                // Note: Detailed progress is logged by video-split.ts
                // Only log batch-level progress here when it changes significantly

                // Calculate overall ETA using industry standard formula:
                // ETA = (remainingBytes / processedBytes) * elapsedTime
                // This is the same formula used by FFmpeg, HandBrake, rsync, wget, etc.
                let overallEta: number | undefined;
                const progressElapsed = (Date.now() - batchStartTime) / 1000;

                // Wait for minimum data before calculating (5 seconds or some bytes processed)
                if (totalProcessedBytes > 0 && progressElapsed > 5) {
                  const remainingBytes = totalBytes - totalProcessedBytes;
                  // Industry standard: ETA = remaining * (elapsed / completed)
                  overallEta = Math.round(
                    (remainingBytes / totalProcessedBytes) * progressElapsed
                  );
                } else if (
                  progressStatus.fileEta !== undefined &&
                  progressStatus.fileEta > 0 &&
                  fileSize > 0
                ) {
                  // Early fallback: scale current file ETA by total/current file size ratio
                  const remainingBytes = totalBytes - totalProcessedBytes;
                  const currentFileRemainingBytes =
                    fileSize - currentFileProcessedBytes;
                  if (currentFileRemainingBytes > 0) {
                    overallEta = Math.round(
                      progressStatus.fileEta *
                        (remainingBytes / currentFileRemainingBytes)
                    );
                  }
                }

                // Calculate throughput based on total bytes processed including current file progress
                const progressElapsedSeconds =
                  (Date.now() - batchStartTime) / 1000;
                const progressThroughput =
                  progressElapsedSeconds > 0
                    ? totalProcessedBytes / progressElapsedSeconds
                    : 0;

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
                  processedBytes: totalProcessedBytes,
                  totalBytes,
                  throughputBps: progressThroughput,
                });
              },
              batchAbortController?.signal
            );

            // After file completes, add its bytes to the total
            totalBytesProcessed += fileSize;
            processedFiles++;
            console.log(`Successfully processed: ${fileName}`);
          } catch (error) {
            // Check if this was a cancellation
            if (error instanceof ProcessCancelledError || isBatchCancelled) {
              console.log(
                `[Batch Process] Processing cancelled during: ${fileName}`
              );
              isBatchCancelled = true;
              break;
            }

            console.error(`Error processing ${fileName}:`, error);
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            // Track the error
            errors.push({ file: fileName, error: errorMessage });
            skippedFiles++;

            // Add file bytes to processed (we're skipping it, so it counts towards progress)
            totalBytesProcessed += fileSize;

            // Log the error and notify user, but continue processing
            console.warn(
              `Skipping file due to error: ${fileName} - ${errorMessage}`
            );

            const errorElapsedSeconds = (Date.now() - batchStartTime) / 1000;
            const errorThroughput =
              errorElapsedSeconds > 0
                ? totalBytesProcessed / errorElapsedSeconds
                : 0;

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
              error: `Failed: ${errorMessage}`,
              processedBytes: totalBytesProcessed,
              totalBytes,
              throughputBps: errorThroughput,
            });

            // Continue to next file instead of breaking
            continue;
          }
        }

        // Check if cancelled
        if (isBatchCancelled) {
          console.log(
            `[Batch Process] Cancelled. Processed: ${processedFiles}, Skipped: ${skippedFiles}`
          );

          const cancelledElapsedSeconds = (Date.now() - batchStartTime) / 1000;
          const cancelledThroughput =
            cancelledElapsedSeconds > 0
              ? totalBytesProcessed / cancelledElapsedSeconds
              : 0;

          sendProgressUpdate({
            currentFile: "",
            currentFileIndex: processedFiles,
            totalFiles,
            currentChunk: 0,
            totalChunks: 0,
            fileProgress: 0,
            chunkProgress: 0,
            overallProgress: Math.round(
              (totalBytesProcessed / totalBytes) * 100
            ),
            status: "idle",
            error: `Cancelled after processing ${processedFiles} file(s)`,
            processedBytes: totalBytesProcessed,
            totalBytes,
            throughputBps: cancelledThroughput,
          });

          // Clean up
          batchAbortController = null;
          isBatchCancelled = false;

          return {
            success: false,
            cancelled: true,
            processedFiles,
            skippedFiles,
            errors,
          };
        }

        // Log summary
        console.log(
          `Batch processing complete: ${processedFiles} succeeded, ${skippedFiles} failed`
        );
        if (errors.length > 0) {
          console.log("Failed files:");
          errors.forEach((e) => console.log(`  - ${e.file}: ${e.error}`));
        }

        // Send completion status with error summary if any
        const completionMessage =
          skippedFiles > 0
            ? `Completed with ${skippedFiles} error(s)`
            : undefined;

        const completionElapsedSeconds = (Date.now() - batchStartTime) / 1000;
        const completionThroughput =
          completionElapsedSeconds > 0
            ? totalBytes / completionElapsedSeconds
            : 0;

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
          error: completionMessage,
          processedBytes: totalBytes,
          totalBytes,
          throughputBps: completionThroughput,
        });

        // Clean up
        batchAbortController = null;
        isBatchCancelled = false;

        return { success: true, processedFiles, skippedFiles, errors };
      } catch (error) {
        // Clean up on error
        batchAbortController = null;
        isBatchCancelled = false;

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
          processedBytes: 0,
          totalBytes: 0,
          throughputBps: 0,
        });
        throw error;
      }
    }
  );

  // Watch mode handlers
  ipcMain.handle(
    "video:start-watch-mode",
    async (_, config: BatchProcessConfig) => {
      try {
        // Stop existing watcher if any
        if (fileWatcher) {
          await fileWatcher.close();
          fileWatcher = null;
        }

        watchConfig = config;
        watchQueue = [];
        watchStats = { filesProcessed: 0, filesFailed: 0, filesQueued: 0 };

        // Verify directories exist
        if (!fs.existsSync(config.inputDirectory)) {
          throw new Error("Input directory does not exist");
        }
        if (!fs.existsSync(config.outputDirectory)) {
          fs.mkdirSync(config.outputDirectory, { recursive: true });
        }

        console.log(`[Watch Mode] Starting watch on: ${config.inputDirectory}`);

        // Create file watcher
        fileWatcher = chokidar.watch(config.inputDirectory, {
          persistent: true,
          ignoreInitial: false, // Process existing files
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
          },
          ignored: [
            /(^|[\/\\])\../, // Ignore dotfiles
            "**/*.part",
            "**/*.tmp",
            "**/*.crdownload",
            "**/node_modules/**", // Ignore node_modules
            "**/dist/**", // Ignore dist directories
            "**/build/**", // Ignore build directories
            "**/out/**", // Ignore out directories
            "**/.git/**", // Ignore git directories
            "**/*.d.ts", // Ignore TypeScript definition files
          ],
        });

        fileWatcher
          .on("add", (filePath) => {
            if (isVideoFile(filePath)) {
              const fileName = path.basename(filePath);
              console.log(`[Watch Mode] New file detected: ${fileName}`);

              // Add to queue if not already present
              if (!watchQueue.some((f) => f.path === filePath)) {
                watchQueue.push({ path: filePath, name: fileName });
                watchStats.filesQueued++;

                // Notify renderer
                sendWatchStatus();
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send("video:watch-file-added", {
                    path: filePath,
                    name: fileName,
                  });
                }

                // Start processing if not already
                processWatchQueue();
              }
            }
          })
          .on("error", (error) => {
            console.error("[Watch Mode] Error:", error);
          });

        sendWatchStatus();
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("[Watch Mode] Failed to start:", errorMessage);
        throw error;
      }
    }
  );

  ipcMain.handle("video:stop-watch-mode", async () => {
    if (fileWatcher) {
      await fileWatcher.close();
      fileWatcher = null;
      console.log("[Watch Mode] Stopped");
    }
    watchConfig = null;
    watchQueue = [];
    isWatchProcessing = false;
    sendWatchStatus();
    return { success: true };
  });

  ipcMain.handle("video:get-watch-status", () => {
    return {
      active: fileWatcher !== null,
      processing: isWatchProcessing,
      queued: watchQueue.length,
      stats: watchStats,
    };
  });
}

// Process the watch queue
async function processWatchQueue(): Promise<void> {
  if (isWatchProcessing || !watchConfig || watchQueue.length === 0) {
    return;
  }

  isWatchProcessing = true;
  sendWatchStatus();

  while (watchQueue.length > 0 && watchConfig) {
    const file = watchQueue[0];

    try {
      console.log(`[Watch Mode] Processing: ${file.name}`);

      sendProgressUpdate({
        currentFile: file.name,
        currentFileIndex: watchStats.filesProcessed + 1,
        totalFiles: watchStats.filesProcessed + watchQueue.length,
        currentChunk: 0,
        totalChunks: 0,
        fileProgress: 0,
        chunkProgress: 0,
        overallProgress: 0,
        status: "processing",
      });

      await processVideoFile(
        file.path,
        watchConfig.outputDirectory,
        watchConfig,
        (progressStatus) => {
          sendProgressUpdate({
            currentFile: file.name,
            currentFileIndex: watchStats.filesProcessed + 1,
            totalFiles: watchStats.filesProcessed + watchQueue.length,
            currentChunk: progressStatus.currentChunk,
            totalChunks: progressStatus.totalChunks,
            fileProgress: progressStatus.fileProgress,
            chunkProgress: progressStatus.chunkProgress,
            overallProgress: progressStatus.fileProgress,
            status: "processing",
            eta: progressStatus.eta,
            chunkEta: progressStatus.chunkEta,
            fileEta: progressStatus.fileEta,
            processingSpeed: progressStatus.processingSpeed,
          });
        }
      );

      watchStats.filesProcessed++;
      console.log(`[Watch Mode] Completed: ${file.name}`);
    } catch (error) {
      watchStats.filesFailed++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Watch Mode] Failed: ${file.name} - ${errorMessage}`);
    }

    // Remove from queue
    watchQueue.shift();
    sendWatchStatus();
  }

  isWatchProcessing = false;
  sendWatchStatus();

  // Send idle status when queue is empty
  if (watchQueue.length === 0) {
    sendProgressUpdate({
      currentFile: "",
      currentFileIndex: 0,
      totalFiles: 0,
      currentChunk: 0,
      totalChunks: 0,
      fileProgress: 0,
      chunkProgress: 0,
      overallProgress: 0,
      status: "idle",
    });
  }
}

function sendWatchStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("video:watch-status", {
      active: fileWatcher !== null,
      processing: isWatchProcessing,
      queued: watchQueue.length,
      stats: watchStats,
    });
  }
}

function sendProgressUpdate(status: ProcessStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("video:progress-update", status);
  }
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
