import { spawn } from "child_process";
import { BatchProcessConfig, ProgressCallback } from "../types/types";
import * as path from "path";
import * as fs from "fs";
import {
  RuntimeContext,
  getGStreamerPathWithContext,
  getGstLaunchPathWithContext,
} from "../utils/gstreamer-path";

// Helper function to format time in seconds to readable format
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Get video file duration in seconds using GStreamer
 */
export function getVideoDurationWithContext(
  inputPath: string,
  context: RuntimeContext
): Promise<number> {
  return new Promise((resolve, reject) => {
    const fileUri = inputPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, "file:///$1:");

    const { env: gstEnv } = getGStreamerPathWithContext(context);
    const processEnv = { ...process.env, ...gstEnv };
    const gstLaunchPath = getGstLaunchPathWithContext(context);

    // Use gst-discoverer-1.0 to get duration
    const discovererPath = gstLaunchPath.replace(
      /gst-launch-1\.0(\.exe)?$/,
      "gst-discoverer-1.0$1"
    );
    const discoverer = spawn(discovererPath, [fileUri], { env: processEnv });

    let output = "";
    discoverer.stdout.on("data", (data) => {
      output += data.toString();
    });

    discoverer.stderr.on("data", (data) => {
      output += data.toString();
    });

    discoverer.on("exit", (code) => {
      if (code === 0) {
        // Log full output for debugging
        console.log(`[Duration Discovery] Output: ${output.substring(0, 500)}`);

        // Parse duration from output (format: "Duration: 0:01:23.456" or "Duration: 01:23:45.678")
        const durationMatch = output.match(
          /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/i
        );
        if (durationMatch) {
          const hours = parseInt(durationMatch[1], 10);
          const minutes = parseInt(durationMatch[2], 10);
          const seconds = parseFloat(durationMatch[3]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;

          // Sanity check: if duration seems too short for a large file, log a warning
          try {
            const stats = fs.statSync(inputPath);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);
            if (fileSizeGB > 10 && totalSeconds < 60) {
              console.warn(
                `[Duration Warning] File size is ${fileSizeGB.toFixed(2)}GB but duration is only ${totalSeconds}s. ` +
                  `This seems incorrect - duration detection may have failed.`
              );
            }
          } catch (e) {
            // Ignore file stat errors
          }

          resolve(totalSeconds);
        } else {
          // Try alternative format: parse from JSON if available
          try {
            const jsonMatch = output.match(/\{[\s\S]*"duration"[\s\S]*\}/);
            if (jsonMatch) {
              const json = JSON.parse(jsonMatch[0]);
              if (json.duration && typeof json.duration === "number") {
                resolve(json.duration / 1000000000); // Convert nanoseconds to seconds
                return;
              }
            }
          } catch (e) {
            // JSON parsing failed, continue to error
          }

          // Fallback: try to parse from other formats
          reject(
            new Error(
              `Could not parse duration from GStreamer output. Output: ${output.substring(0, 200)}`
            )
          );
        }
      } else {
        reject(
          new Error(
            `GStreamer discoverer exited with code ${code}. Output: ${output.substring(0, 200)}`
          )
        );
      }
    });

    discoverer.on("error", (error) => {
      reject(error);
    });
  });
}

// Cancellation error class
export class ProcessCancelledError extends Error {
  constructor() {
    super('Processing was cancelled');
    this.name = 'ProcessCancelledError';
  }
}

// Result type for processVideoFileWithContext
export interface ProcessingHandle {
  promise: Promise<void>;
  cancel: () => void;
}

export function processVideoFileWithContext(
  inputPath: string,
  outputDirectory: string,
  config: BatchProcessConfig,
  context: RuntimeContext,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let isCancelled = false;
    
    // Check if already aborted
    if (abortSignal?.aborted) {
      reject(new ProcessCancelledError());
      return;
    }
    const chunkDuration = config.chunkDurationMinutes * 60; // Convert to seconds
    const inputFileName = path.basename(inputPath, path.extname(inputPath));
    // Normalize the output path to ensure proper formatting for GStreamer
    const normalizedOutputDir = path.normalize(outputDirectory);
    const outputBaseName = path.join(normalizedOutputDir, inputFileName);

    // Ensure output directory exists
    try {
      if (!fs.existsSync(normalizedOutputDir)) {
        fs.mkdirSync(normalizedOutputDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`Could not create output directory: ${e}`);
    }

    // Get video duration to calculate total chunks
    let fileDuration = 0;
    let totalChunks = 0;
    let inputFileSize = 0;

    // Get file size for validation
    try {
      const stats = fs.statSync(inputPath);
      inputFileSize = stats.size;
    } catch (e) {
      // Ignore errors getting file size
    }

    try {
      fileDuration = await getVideoDurationWithContext(inputPath, context);

      // Sanity check: if file is very large (>10GB) but duration is very short (<1 minute),
      // the duration detection likely failed - estimate from file size instead
      if (inputFileSize > 10 * 1024 * 1024 * 1024 && fileDuration < 60) {
        console.warn(
          `[Video Info] Duration detection seems incorrect (${fileDuration}s for ${(inputFileSize / (1024 * 1024 * 1024)).toFixed(2)}GB file). ` +
            `Estimating duration from file size...`
        );
        // Rough estimate: assume 10-50 Mbps bitrate for H.264/H.265 video
        // This is a very rough estimate, but better than wrong duration
        const estimatedBitrateMbps = 20; // Conservative estimate
        const estimatedDuration =
          (inputFileSize * 8) / (estimatedBitrateMbps * 1000000); // seconds
        fileDuration = estimatedDuration;
        console.log(
          `[Video Info] Estimated duration: ${Math.round(fileDuration)}s (${Math.round(fileDuration / 60)} minutes)`
        );
      }

      totalChunks = Math.ceil(fileDuration / chunkDuration);
      console.log(
        `[Video Info] Duration: ${fileDuration}s (${Math.round(fileDuration / 60)} min), ` +
          `File size: ${(inputFileSize / (1024 * 1024 * 1024)).toFixed(2)}GB, ` +
          `Will create ${totalChunks} chunk(s)`
      );
    } catch (error) {
      console.warn(`[Video Info] Could not get duration: ${error}`);
      // If we have file size, estimate duration
      if (inputFileSize > 0) {
        const estimatedBitrateMbps = 20; // Conservative estimate
        const estimatedDuration =
          (inputFileSize * 8) / (estimatedBitrateMbps * 1000000);
        fileDuration = estimatedDuration;
        totalChunks = Math.ceil(fileDuration / chunkDuration);
        console.log(
          `[Video Info] Estimated duration from file size: ${Math.round(fileDuration)}s, ` +
            `Will create ${totalChunks} chunk(s)`
        );
      } else {
        // Continue without duration - we'll estimate chunks as they're created
        totalChunks = 0; // Will be updated as chunks are created
      }
    }

    // Determine muxer based on output format
    let muxer = "qtmux"; // qtmux for MP4 (buffers until completion)
    if (config.outputFormat === "mkv") {
      muxer = "matroskamux"; // Matroska supports incremental writing
    } else if (config.outputFormat === "mov") {
      muxer = "qtmux"; // qtmux for MOV (buffers until completion)
    }

    // Build GStreamer pipeline
    let encoder: string;
    let useHardwareFormat = false;
    if (config.encoder === "nvh265") {
      encoder = "nvh265enc"; // NVIDIA hardware encoder
      useHardwareFormat = true;
    } else if (config.encoder === "qsvh265") {
      encoder = "qsvh265enc";
      useHardwareFormat = true;
    } else {
      encoder = "x265enc"; // Software encoder
      useHardwareFormat = false;
    }

    // Convert Windows path to file:// URI format
    const fileUri = inputPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, "file:///$1:");

    const args = [
      "uridecodebin",
      `uri=${fileUri}`,
      "!",
      "video/x-raw", // Filter to video streams only
      "!",
      "videoconvert",
      "!",
      ...(useHardwareFormat
        ? ["video/x-raw,format=NV12"]
        : ["video/x-raw,format=I420"]),
      "!",
      encoder,
      ...(config.bitrate ? [`bitrate=${config.bitrate}`] : []),
      ...(encoder === "x265enc"
        ? [
            config.speedPreset
              ? `speed-preset=${config.speedPreset}`
              : "speed-preset=medium",
          ]
        : encoder === "qsvh265enc"
          ? []
          : []),
      "!",
      "h265parse",
      "!",
      "splitmuxsink",
      `location="${outputBaseName.replace(/\\/g, "/")}_%02d.${config.outputFormat}"`,
      `max-size-time=${chunkDuration * 1000000000}`, // nanoseconds
      `muxer=${muxer}`,
      ...(muxer === "matroskamux"
        ? [`muxer-properties=properties,streamable=true`, "async-finalize=true"]
        : []),
      "send-keyframe-requests=true",
    ].filter(Boolean);

    const gstLaunchPath = getGstLaunchPathWithContext(context);
    const { env: gstEnv, binPath } = getGStreamerPathWithContext(context);

    // Check if GStreamer executable exists (if we have a specific path)
    if (binPath) {
      const platform = process.platform;
      const executable =
        platform === "win32" ? "gst-launch-1.0.exe" : "gst-launch-1.0";
      const expectedPath = path.join(binPath, executable);
      if (!fs.existsSync(expectedPath)) {
        throw new Error(
          `GStreamer executable not found at: ${expectedPath}\n` +
            `Please ensure GStreamer is properly installed in the gstreamer directory.`
        );
      }
    }

    const processEnv = { ...process.env, ...gstEnv };

    const gst = spawn(gstLaunchPath, args, {
      env: processEnv,
    });

    // Handle abort signal for cancellation
    if (abortSignal) {
      const abortHandler = () => {
        if (!isCancelled) {
          isCancelled = true;
          console.log('[GStreamer] Processing cancelled by user');
          gst.kill('SIGTERM');
          // Give it a moment, then force kill if needed
          setTimeout(() => {
            if (!gst.killed) {
              gst.kill('SIGKILL');
            }
          }, 2000);
        }
      };
      
      abortSignal.addEventListener('abort', abortHandler, { once: true });
      
      // Clean up listener when process exits
      gst.on('exit', () => {
        abortSignal.removeEventListener('abort', abortHandler);
      });
    }

    // Progress tracking variables
    let errorOutput = "";
    let currentChunk = 0;
    let progressUpdateInterval: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();

    // Byte-based progress tracking
    let lastTotalOutputSize = 0;
    let lastSizeCheckTime = startTime;
    let bytesPerSecond = 0;
    let processedBytes = 0;

    // Helper function to send progress updates
    const sendProgressUpdate = () => {
      if (!onProgress) return;

      const elapsed = (Date.now() - startTime) / 1000;

      let chunkCount = 0;
      let totalOutputSize = 0;

      try {
        const firstChunkFileName = `${inputFileName}_01.${config.outputFormat}`;
        const firstChunkPath = path.join(
          normalizedOutputDir,
          firstChunkFileName
        );

        if (fs.existsSync(firstChunkPath)) {
          try {
            const stats = fs.statSync(firstChunkPath);
            const chunkSize = stats.size;
            totalOutputSize = chunkSize;

            if (
              chunkSize > 0 ||
              config.outputFormat === "mp4" ||
              config.outputFormat === "mov"
            ) {
              chunkCount = 1;
            }
          } catch (e) {
            // Ignore errors reading file stats
          }
        }

        if (chunkCount > 0) {
          let nextChunkNum = 2;
          while (nextChunkNum <= 100) {
            const chunkFileName = `${inputFileName}_${String(nextChunkNum).padStart(2, "0")}.${config.outputFormat}`;
            const chunkPath = path.join(normalizedOutputDir, chunkFileName);
            if (fs.existsSync(chunkPath)) {
              try {
                const stats = fs.statSync(chunkPath);
                const chunkSize = stats.size;
                totalOutputSize += chunkSize;

                if (
                  chunkSize > 0 ||
                  config.outputFormat === "mp4" ||
                  config.outputFormat === "mov"
                ) {
                  chunkCount++;
                  nextChunkNum++;
                } else {
                  break;
                }
              } catch (e) {
                break;
              }
            } else {
              break;
            }
          }
        }
      } catch (e) {
        console.warn(`[Progress] Error checking chunks: ${e}`);
      }

      if (chunkCount > 0) {
        currentChunk = chunkCount;
      } else if (fileDuration > 0) {
        currentChunk = 1;
      }

      const now = Date.now();
      const timeSinceLastCheck = (now - lastSizeCheckTime) / 1000;

      if (totalOutputSize > 0 && timeSinceLastCheck >= 1) {
        const bytesGrowth = totalOutputSize - lastTotalOutputSize;
        if (bytesGrowth > 0 && timeSinceLastCheck > 0) {
          const instantSpeed = bytesGrowth / timeSinceLastCheck;
          if (bytesPerSecond > 0) {
            bytesPerSecond = bytesPerSecond * 0.7 + instantSpeed * 0.3;
          } else {
            bytesPerSecond = instantSpeed;
          }
        }

        processedBytes = totalOutputSize;

        lastTotalOutputSize = totalOutputSize;
        lastSizeCheckTime = now;
      } else if (totalOutputSize > 0 && bytesPerSecond === 0 && elapsed > 2) {
        bytesPerSecond = totalOutputSize / elapsed;
        processedBytes = totalOutputSize;
      }

      if (chunkCount > totalChunks && fileDuration === 0) {
        totalChunks = chunkCount;
      }

      let fileProgress = 0;

      if (inputFileSize > 0 && totalOutputSize > 0) {
        const byteRatio = Math.min(0.99, totalOutputSize / inputFileSize);
        fileProgress = Math.round(byteRatio * 100);
        processedBytes = totalOutputSize;
      } else if (fileDuration > 0 && elapsed > 0 && totalOutputSize === 0) {
        let encodingSpeed: number;
        let finalizationOverheadSeconds: number;

        if (config.encoder === "qsvh265") {
          encodingSpeed = 0.3;
          finalizationOverheadSeconds = 30;
        } else if (config.encoder === "nvh265") {
          encodingSpeed = 0.5;
          finalizationOverheadSeconds = 20;
        } else {
          encodingSpeed = 0.2;
          finalizationOverheadSeconds = 10;
        }

        const fileSizeGB = inputFileSize / (1024 * 1024 * 1024);
        if (fileSizeGB > 5) {
          finalizationOverheadSeconds += Math.min(60, fileSizeGB * 5);
        }

        const expectedEncodingTime = fileDuration / encodingSpeed;
        const expectedTotalTime =
          expectedEncodingTime + finalizationOverheadSeconds;

        const progressRatio = Math.min(0.99, elapsed / expectedTotalTime);
        fileProgress = Math.round(progressRatio * 100);

        if (fileProgress > 0 && inputFileSize > 0) {
          processedBytes = (fileProgress / 100) * inputFileSize;
        }
      } else if (
        inputFileSize > 0 &&
        processedBytes > 0 &&
        totalOutputSize === 0
      ) {
        const byteRatio = Math.min(0.99, processedBytes / inputFileSize);
        fileProgress = Math.round(byteRatio * 100);
      } else if (fileDuration > 0 && bytesPerSecond > 0 && elapsed > 0) {
        const estimatedTotalBytes = bytesPerSecond * fileDuration;
        if (estimatedTotalBytes > 0) {
          fileProgress = Math.min(
            99,
            Math.round((processedBytes / estimatedTotalBytes) * 100)
          );
        }
      }

      let chunkProgress = 0;

      if (totalChunks === 1) {
        chunkProgress = fileProgress;
      } else if (
        fileDuration > 0 &&
        totalChunks > 0 &&
        currentChunk > 0 &&
        inputFileSize > 0
      ) {
        const bytesPerChunk = inputFileSize / totalChunks;
        const currentChunkStartBytes = (currentChunk - 1) * bytesPerChunk;
        const currentChunkEndBytes = currentChunk * bytesPerChunk;
        const processedInCurrentChunk = Math.max(
          0,
          processedBytes - currentChunkStartBytes
        );
        const currentChunkBytes = currentChunkEndBytes - currentChunkStartBytes;

        if (currentChunkBytes > 0) {
          chunkProgress = Math.min(
            100,
            Math.round((processedInCurrentChunk / currentChunkBytes) * 100)
          );
        }
      } else if (totalChunks > 0 && currentChunk > 0) {
        const progressPerChunk = 100 / totalChunks;
        const baseProgress = (currentChunk - 1) * progressPerChunk;
        const chunkProgressFromFile = fileProgress - baseProgress;
        chunkProgress = Math.min(
          100,
          Math.max(
            0,
            Math.round((chunkProgressFromFile / progressPerChunk) * 100)
          )
        );
      }

      let processingSpeed: number | undefined;

      let estimatedEncodingSpeed: number;
      if (config.encoder === "qsvh265") {
        estimatedEncodingSpeed = 0.3;
      } else if (config.encoder === "nvh265") {
        estimatedEncodingSpeed = 0.5;
      } else {
        estimatedEncodingSpeed = 0.2;
      }

      if (bytesPerSecond > 0 && inputFileSize > 0 && fileDuration > 0) {
        const bytesPerSecondOfVideo = inputFileSize / fileDuration;
        if (bytesPerSecondOfVideo > 0) {
          processingSpeed = bytesPerSecond / bytesPerSecondOfVideo;
        }
      } else if (fileDuration > 0 && elapsed > 0 && totalOutputSize === 0) {
        processingSpeed = estimatedEncodingSpeed;
      } else if (fileDuration > 0 && elapsed > 0 && fileProgress > 0) {
        const estimatedProcessedDuration = (fileProgress / 100) * fileDuration;
        if (estimatedProcessedDuration > 0) {
          processingSpeed = estimatedProcessedDuration / elapsed;
        }
      } else if (bytesPerSecond > 0 && inputFileSize > 0) {
        const estimatedDuration = (inputFileSize / bytesPerSecond) * 0.7;
        if (estimatedDuration > 0 && elapsed > 0) {
          processingSpeed =
            ((processedBytes / inputFileSize) * estimatedDuration) / elapsed;
        }
      }

      let chunkEta: number | undefined;
      let fileEta: number | undefined;
      let eta: number | undefined;

      if (inputFileSize > 0 && bytesPerSecond > 0) {
        const remainingBytes = inputFileSize - processedBytes;

        if (remainingBytes > 0) {
          fileEta = Math.round(remainingBytes / bytesPerSecond);

          if (totalChunks > 0 && currentChunk > 0) {
            const bytesPerChunk = inputFileSize / totalChunks;
            const currentChunkEndBytes = currentChunk * bytesPerChunk;
            const remainingChunkBytes = currentChunkEndBytes - processedBytes;

            if (remainingChunkBytes > 0) {
              chunkEta = Math.round(remainingChunkBytes / bytesPerSecond);
            }
          }

          eta = fileEta;
        }
      } else if (fileDuration > 0 && totalOutputSize === 0) {
        let finalizationOverhead: number;
        const fileSizeGB = inputFileSize / (1024 * 1024 * 1024);

        if (config.encoder === "qsvh265") {
          finalizationOverhead =
            30 + (fileSizeGB > 5 ? Math.min(60, fileSizeGB * 5) : 0);
        } else if (config.encoder === "nvh265") {
          finalizationOverhead =
            20 + (fileSizeGB > 5 ? Math.min(60, fileSizeGB * 5) : 0);
        } else {
          finalizationOverhead =
            10 + (fileSizeGB > 5 ? Math.min(60, fileSizeGB * 5) : 0);
        }

        const expectedEncodingTime = fileDuration / estimatedEncodingSpeed;
        const expectedTotalTime = expectedEncodingTime + finalizationOverhead;

        const remainingTime = Math.max(0, expectedTotalTime - elapsed);
        fileEta = Math.round(remainingTime);
        eta = fileEta;

        if (totalChunks === 1) {
          chunkEta = fileEta;
        } else if (totalChunks > 0 && currentChunk > 0) {
          const expectedChunkTime = expectedTotalTime / totalChunks;
          const chunkEndTime = currentChunk * expectedChunkTime;
          const remainingChunkTime = Math.max(0, chunkEndTime - elapsed);
          chunkEta = Math.round(remainingChunkTime);
        }
      } else if (fileDuration > 0 && processingSpeed && processingSpeed > 0) {
        let processedDurationFromBytes = 0;
        if (inputFileSize > 0 && processedBytes > 0) {
          processedDurationFromBytes =
            (processedBytes / inputFileSize) * fileDuration;
        } else if (fileProgress > 0) {
          processedDurationFromBytes = (fileProgress / 100) * fileDuration;
        }

        const remainingDuration = fileDuration - processedDurationFromBytes;
        if (remainingDuration > 0 && processingSpeed > 0) {
          fileEta = Math.round(remainingDuration / processingSpeed);
          eta = fileEta;

          if (totalChunks === 1) {
            chunkEta = fileEta;
          }
        }
      }

      console.log(
        `[Progress Update] File: ${fileProgress}%, Chunk: ${currentChunk}/${totalChunks} (${chunkProgress}%), ` +
          `Overall ETA: ${eta !== undefined ? formatTime(eta) : "N/A"}, ` +
          `Speed: ${processingSpeed ? processingSpeed.toFixed(2) + "x" : "N/A"}`
      );

      onProgress({
        fileProgress,
        chunkProgress,
        currentChunk: chunkCount > 0 ? currentChunk : fileDuration > 0 ? 1 : 0,
        totalChunks: Math.max(1, totalChunks),
        eta,
        chunkEta,
        fileEta,
        processingSpeed,
      });
    };

    // Send initial progress update
    sendProgressUpdate();

    gst.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`[GStreamer] ${output}`);
    });

    gst.stderr.on("data", (data) => {
      const error = data.toString();
      errorOutput += error;
      console.error(`[GStreamer ERROR] ${error}`);
    });

    // Set up periodic progress updates
    progressUpdateInterval = setInterval(() => {
      sendProgressUpdate();
    }, 1000);

    gst.on("exit", (code, signal) => {
      if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
      }

      // Check if this was a cancellation
      if (isCancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new ProcessCancelledError());
        return;
      }

      if (code === 0 && onProgress) {
        onProgress({
          fileProgress: 100,
          chunkProgress: 100,
          currentChunk: totalChunks || currentChunk,
          totalChunks: totalChunks || currentChunk,
        });
      }

      if (code === 0) {
        resolve();
      } else {
        let errorMsg = `GStreamer exited with code ${code}`;
        if (code === 3221226356 || code === -1073741819) {
          errorMsg +=
            " (Access violation - encoder may not be available or incompatible)";
          if (config.encoder === "qsvh265") {
            errorMsg +=
              "\n\nIntel QSV encoder may not be available in your GStreamer installation. " +
              "Try using x265 (Software) encoder instead, or check if Intel GPU drivers are properly installed.";
          }
        }
        if (errorOutput) {
          errorMsg += `\n\nError output:\n${errorOutput}`;
        }
        reject(new Error(errorMsg));
      }
    });

    gst.on("error", (error) => {
      if (error.message.includes("ENOENT") || error.message.includes("spawn")) {
        const platform = process.platform;
        const executable =
          platform === "win32" ? "gst-launch-1.0.exe" : "gst-launch-1.0";
        reject(
          new Error(
            `Failed to start GStreamer: "${executable}" not found.\n` +
              `Attempted path: ${gstLaunchPath}\n` +
              `Please ensure GStreamer is installed. ` +
              `For Windows, download from: https://gstreamer.freedesktop.org/download/`
          )
        );
      } else {
        let errorMsg = `Failed to start GStreamer: ${error.message}`;
        if (config.encoder === "qsvh265") {
          errorMsg +=
            `\n\nIntel QSV encoder may not be available. ` +
            `Try using x265 (Software) encoder instead, or ensure Intel GPU drivers are installed.`;
        }
        reject(new Error(errorMsg));
      }
    });
  });
}
