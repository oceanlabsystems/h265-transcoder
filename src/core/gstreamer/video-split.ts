import { spawn } from "child_process";
import { BatchProcessConfig, ProgressCallback } from "../types/types";
import * as path from "path";
import * as fs from "fs";
import {
  RuntimeContext,
  getGStreamerPathWithContext,
  getGstLaunchPathWithContext,
} from "../utils/gstreamer-path";
import { debugLogger } from "../utils/debug-logger";

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
 * Fallback: Try to get video duration using ffprobe (if available)
 */
function tryFfprobeDuration(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    // Try ffprobe first as it's more reliable
    const ffprobeArgs = [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      inputPath,
    ];

    const ffprobe = spawn("ffprobe", ffprobeArgs);
    let output = "";

    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("exit", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        if (!isNaN(duration) && duration > 0) {
          debugLogger.info(`[Duration] Got duration from ffprobe: ${duration}s`);
          resolve(duration);
          return;
        }
      }
      resolve(null);
    });

    ffprobe.on("error", () => {
      resolve(null); // ffprobe not available
    });
  });
}

/**
 * Get video file duration in seconds using GStreamer
 * Falls back to ffprobe if gst-discoverer is not available
 */
export function getVideoDurationWithContext(
  inputPath: string,
  context: RuntimeContext
): Promise<number> {
  return new Promise(async (resolve, reject) => {
    // Convert path to file:// URI format for GStreamer
    let fileUri = inputPath.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(fileUri)) {
      // Windows path: C:/path -> file:///C:/path
      fileUri = fileUri.replace(/^([A-Za-z]):/, "file:///$1:");
    } else if (fileUri.startsWith("/")) {
      // Unix path: /path -> file:///path
      fileUri = "file://" + fileUri;
    }

    const { env: gstEnv } = getGStreamerPathWithContext(context);
    const processEnv = { ...process.env, ...gstEnv };
    const gstLaunchPath = getGstLaunchPathWithContext(context);

    // Use gst-discoverer-1.0 to get duration
    const discovererPath = gstLaunchPath.replace(
      /gst-launch-1\.0(\.exe)?$/,
      "gst-discoverer-1.0$1"
    );

    // Check if gst-discoverer exists
    const discovererExists = fs.existsSync(discovererPath);
    if (!discovererExists) {
      debugLogger.warn(
        `[Duration] gst-discoverer-1.0 not found at: ${discovererPath}`
      );
      debugLogger.warn(
        `[Duration] Trying ffprobe fallback... (install full GStreamer for best accuracy)`
      );

      // Try ffprobe fallback
      const ffprobeDuration = await tryFfprobeDuration(inputPath);
      if (ffprobeDuration !== null) {
        resolve(ffprobeDuration);
        return;
      }

      reject(
        new Error(
          `gst-discoverer-1.0 not found and ffprobe unavailable. ` +
            `Install GStreamer from https://gstreamer.freedesktop.org/download/ ` +
            `or run: node scripts/download-gstreamer.js`
        )
      );
      return;
    }

    const discoverer = spawn(discovererPath, [fileUri], { env: processEnv });

    let output = "";
    discoverer.stdout.on("data", (data) => {
      output += data.toString();
    });

    discoverer.stderr.on("data", (data) => {
      output += data.toString();
    });

    discoverer.on("exit", async (code) => {
      if (code === 0) {
        // Log full output for debugging
        debugLogger.info(`[Duration Discovery] Output: ${output.substring(0, 500)}`);

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
              debugLogger.warn(
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
        // gst-discoverer failed - try ffprobe fallback
        debugLogger.warn(
          `[Duration] gst-discoverer failed with code ${code}, trying ffprobe...`
        );
        const ffprobeDuration = await tryFfprobeDuration(inputPath);
        if (ffprobeDuration !== null) {
          resolve(ffprobeDuration);
          return;
        }

        reject(
          new Error(
            `GStreamer discoverer exited with code ${code}. Output: ${output.substring(0, 200)}`
          )
        );
      }
    });

    discoverer.on("error", async (error) => {
      // gst-discoverer spawn failed - try ffprobe fallback
      debugLogger.warn(`[Duration] gst-discoverer error: ${error.message}`);
      const ffprobeDuration = await tryFfprobeDuration(inputPath);
      if (ffprobeDuration !== null) {
        resolve(ffprobeDuration);
        return;
      }
      reject(error);
    });
  });
}

// Cancellation error class
export class ProcessCancelledError extends Error {
  constructor() {
    super("Processing was cancelled");
    this.name = "ProcessCancelledError";
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
    // Initialize debug logger if not already initialized
    if (!debugLogger.getLogFilePath()) {
      debugLogger.initialize(context);
    }

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
      debugLogger.warn(`Could not create output directory: ${e}`);
    }

    // Get video duration to calculate total chunks
    let fileDuration = 0;
    let totalChunks = 0;
    let inputFileSize = 0;
    let durationIsEstimated = false;

    // Get file size for validation
    try {
      const stats = fs.statSync(inputPath);
      inputFileSize = stats.size;
      debugLogger.logFileInfo(inputPath, inputFileSize);
    } catch (e) {
      // Ignore errors getting file size
      debugLogger.log("ERROR", `Failed to get file size: ${e}`);
    }

    try {
      fileDuration = await getVideoDurationWithContext(inputPath, context);

      // Sanity check: if file is very large (>10GB) but duration is very short (<1 minute),
      // the duration detection likely failed - estimate from file size instead
      if (inputFileSize > 10 * 1024 * 1024 * 1024 && fileDuration < 60) {
        debugLogger.warn(
          `[Video Info] Duration detection seems incorrect (${fileDuration}s for ${(inputFileSize / (1024 * 1024 * 1024)).toFixed(2)}GB file). ` +
            `Estimating duration from file size...`
        );
        // Rough estimate: assume 10-50 Mbps bitrate for H.264/H.265 video
        // This is a very rough estimate, but better than wrong duration
        const estimatedBitrateMbps = 20; // Conservative estimate
        const estimatedDuration =
          (inputFileSize * 8) / (estimatedBitrateMbps * 1000000); // seconds
        fileDuration = estimatedDuration;
        durationIsEstimated = true;
        debugLogger.info(
          `[Video Info] Estimated duration: ${Math.round(fileDuration)}s (${Math.round(fileDuration / 60)} minutes)`
        );
      }

      totalChunks = Math.ceil(fileDuration / chunkDuration);
      debugLogger.info(
        `[Video Info] Duration: ${fileDuration}s (${Math.round(fileDuration / 60)} min), ` +
          `File size: ${(inputFileSize / (1024 * 1024 * 1024)).toFixed(2)}GB, ` +
          `Will create ${totalChunks} chunk(s)` +
          (durationIsEstimated ? " (estimated)" : "")
      );
      debugLogger.logFileInfo(inputPath, inputFileSize, fileDuration);
    } catch (error) {
      debugLogger.warn(`[Video Info] Could not get duration: ${error}`);
      durationIsEstimated = true;
      // If we have file size, estimate duration
      if (inputFileSize > 0) {
        const estimatedBitrateMbps = 20; // Conservative estimate
        const estimatedDuration =
          (inputFileSize * 8) / (estimatedBitrateMbps * 1000000);
        fileDuration = estimatedDuration;
        totalChunks = Math.ceil(fileDuration / chunkDuration);
        debugLogger.info(
          `[Video Info] Estimated duration from file size: ${Math.round(fileDuration)}s, ` +
            `Will create ${totalChunks} chunk(s)`
        );
      } else {
        // Continue without duration - we'll estimate chunks as they're created
        totalChunks = 0; // Will be updated as chunks are created
      }
    }

    // Calculate input bitrate for compression ratio-based encoding
    // This allows users to specify desired compression (e.g., 2x = 50% of input bitrate)
    let inputBitrateKbps: number | undefined = undefined;
    if (fileDuration > 0 && inputFileSize > 0) {
      // Calculate input bitrate: (fileSizeBytes * 8 bits) / durationSeconds / 1000 = kbps
      const inputBitrateBps = (inputFileSize * 8) / fileDuration;
      inputBitrateKbps = inputBitrateBps / 1000; // Convert to kbps
      debugLogger.info(
        `[Video Info] Input bitrate: ${inputBitrateKbps.toFixed(0)} kbps (${(inputBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      debugLogger.log("BITRATE_CALC", "Input bitrate calculated", {
        inputBitrateKbps: inputBitrateKbps.toFixed(0),
        inputBitrateMbps: (inputBitrateKbps / 1000).toFixed(2),
        fileSizeBytes: inputFileSize,
        durationSeconds: fileDuration,
      });
    }

    // Validate compression ratio was provided
    if (config.compressionRatio === undefined) {
      throw new Error(
        "Compression ratio is required. Please specify a compression ratio (1, 2, 3, 4, 5, 10, or 20)."
      );
    }

    // Calculate target bitrate from compression ratio
    // Compression ratio: 2x means output is 1/2 the size (50% bitrate), 10x means 1/10 the size (10% bitrate)
    const compressionRatio = config.compressionRatio;
    let targetBitrateKbps: number;
    
    if (inputBitrateKbps !== undefined) {
      // Calculate target bitrate from input bitrate
      targetBitrateKbps = Math.round(inputBitrateKbps / compressionRatio);
      
      const estimatedOutputSizeGB = inputFileSize / compressionRatio / (1024 * 1024 * 1024);
      const estimatedOutputSizePerHour = fileDuration > 0 ? (estimatedOutputSizeGB * 3600) / fileDuration : 0;
      
      debugLogger.info(
        `[Compression] Target: ${compressionRatio}x compression → Bitrate: ${targetBitrateKbps} kbps (${(targetBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      debugLogger.info(
        `[Compression] Estimated output: ${estimatedOutputSizeGB.toFixed(2)}GB (${estimatedOutputSizePerHour.toFixed(1)}GB/hour)`
      );
      debugLogger.log("COMPRESSION", "Compression ratio calculation", {
          compressionRatio,
          targetBitrateKbps,
          targetBitrateMbps: (targetBitrateKbps / 1000).toFixed(2),
          inputBitrateKbps: inputBitrateKbps.toFixed(0),
          estimatedOutputSizeGB: estimatedOutputSizeGB.toFixed(2),
          estimatedOutputSizePerHour: estimatedOutputSizePerHour.toFixed(1),
        });
    } else {
      // Compression ratio specified but can't calculate input bitrate - use fallback
      // Fallback: assume input is ~20 Mbps (typical for high-quality video), then apply compression
      const assumedInputBitrateKbps = 20000;
      targetBitrateKbps = Math.round(assumedInputBitrateKbps / compressionRatio);
      debugLogger.warn(
        `[Compression] Could not determine input bitrate, using fallback. ${compressionRatio}x compression → ${targetBitrateKbps} kbps`
      );
      debugLogger.log("COMPRESSION", "Using fallback bitrate calculation", {
        compressionRatio,
        targetBitrateKbps,
        fallback: true,
      });
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
      encoder = "qsvh265enc"; // Intel Quick Sync encoder
      useHardwareFormat = true;
    } else if (config.encoder === "vtenc") {
      encoder = "vtenc_h265"; // Apple VideoToolbox encoder (macOS)
      useHardwareFormat = true;
    } else {
      encoder = "x265enc"; // Software encoder
      useHardwareFormat = false;
    }

    // Convert path to file:// URI format for GStreamer
    let fileUri = inputPath.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(fileUri)) {
      // Windows path: C:/path -> file:///C:/path
      fileUri = fileUri.replace(/^([A-Za-z]):/, "file:///$1:");
    } else if (fileUri.startsWith("/")) {
      // Unix path: /path -> file:///path
      fileUri = "file://" + fileUri;
    }

    // Build encoder-specific arguments
    // Each encoder has different rate-control requirements for bitrate-based encoding
    let encoderArgs: string[] = [];
    
    if (encoder === "vtenc_h265") {
      // VideoToolbox requires explicit rate-control=abr and realtime=false for bitrate to work
      // Without rate-control=abr, bitrate is ignored or treated as a hint
      // realtime=false prevents latency/quality constraints from overriding bitrate
      debugLogger.info(
        `[VideoToolbox] Compression: ${config.compressionRatio}x → Target bitrate: ${targetBitrateKbps} kbps (${(targetBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      encoderArgs = [
        encoder,
        `bitrate=${targetBitrateKbps}`,
        "rate-control=abr", // Average bitrate mode - required for bitrate to be meaningful
        "realtime=false", // Disable realtime mode to allow bitrate constraints
      ];
      debugLogger.logEncoderConfig(
        encoder,
        config.compressionRatio!,
        targetBitrateKbps,
        inputBitrateKbps,
        encoderArgs
      );
    } else if (encoder === "nvh265enc") {
      // NVIDIA NVENC - bitrate works directly with default rate control
      debugLogger.info(
        `[NVENC] Compression: ${config.compressionRatio}x → Target bitrate: ${targetBitrateKbps} kbps (${(targetBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      encoderArgs = [
        encoder,
        `bitrate=${targetBitrateKbps}`,
      ];
      debugLogger.logEncoderConfig(
        encoder,
        config.compressionRatio!,
        targetBitrateKbps,
        inputBitrateKbps,
        encoderArgs
      );
    } else if (encoder === "qsvh265enc") {
      // Intel Quick Sync - bitrate works directly with default rate control
      debugLogger.info(
        `[QSV] Compression: ${config.compressionRatio}x → Target bitrate: ${targetBitrateKbps} kbps (${(targetBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      encoderArgs = [
        encoder,
        `bitrate=${targetBitrateKbps}`,
      ];
      debugLogger.logEncoderConfig(
        encoder,
        config.compressionRatio!,
        targetBitrateKbps,
        inputBitrateKbps,
        encoderArgs
      );
    } else if (encoder === "x265enc") {
      // Software x265 - use bitrate mode (NOT CRF/CQP)
      // Important: Don't use CRF/CQP options when targeting bitrate
      debugLogger.info(
        `[x265] Compression: ${config.compressionRatio}x → Target bitrate: ${targetBitrateKbps} kbps (${(targetBitrateKbps / 1000).toFixed(2)} Mbps)`
      );
      encoderArgs = [
        encoder,
        `bitrate=${targetBitrateKbps}`,
        "speed-preset=medium",
        // Bitrate-based encoding options (no CRF/CQP)
        `option-string="key-int-max=120:rc-lookahead=10:bframes=3"`,
      ];
      debugLogger.logEncoderConfig(
        encoder,
        config.compressionRatio!,
        targetBitrateKbps,
        inputBitrateKbps,
        encoderArgs
      );
    } else {
      // Fallback for unknown encoders
      encoderArgs = [
        encoder,
        `bitrate=${targetBitrateKbps}`,
      ];
    }

    const args = [
      "uridecodebin",
      `uri=${fileUri}`,
      "!",
      "video/x-raw", // Filter to video streams only
      "!",
      // Add a queue to prevent upstream stalls and enable parallel processing
      "queue",
      "max-size-buffers=100",
      "max-size-time=2000000000", // 2 seconds buffer
      "!",
      // Progress reporting element - outputs position/duration for accurate progress tracking
      // This reports based on INPUT position, not output bytes (like pro transcoding apps)
      "progressreport",
      "update-freq=1", // Report every 1 second
      "silent=false", // Output progress messages
      "!",
      "videoconvert",
      "!",
      ...(useHardwareFormat
        ? ["video/x-raw,format=NV12"]
        : ["video/x-raw,format=I420"]),
      "!",
      // Use encoder-specific arguments
      ...encoderArgs,
      "!",
      "h265parse",
      "!",
      // Add queue before muxer to prevent encoder stalls
      "queue",
      "max-size-buffers=50",
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

    // Log the full pipeline for debugging
    debugLogger.logPipeline(args);

    const gstLaunchPath = getGstLaunchPathWithContext(context);
    debugLogger.log("GSTREAMER", "GStreamer launch path", {
      path: gstLaunchPath,
      exists: fs.existsSync(gstLaunchPath),
    });
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
          debugLogger.info("[GStreamer] Processing cancelled by user");
          gst.kill("SIGTERM");
          // Give it a moment, then force kill if needed
          setTimeout(() => {
            if (!gst.killed) {
              gst.kill("SIGKILL");
            }
          }, 2000);
        }
      };

      abortSignal.addEventListener("abort", abortHandler, { once: true });

      // Clean up listener when process exits
      gst.on("exit", () => {
        abortSignal.removeEventListener("abort", abortHandler);
      });
    }

    // Progress tracking variables
    let errorOutput = "";
    let currentChunk = 0;
    let progressUpdateInterval: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();

    // INPUT-BASED progress tracking (like professional transcoding apps)
    // progressreport element gives us exact position in the input stream
    let currentPositionSeconds = 0; // Current position in input stream (from progressreport)

    // Secondary: Output byte tracking for verification
    let lastTotalOutputSize = 0;
    let lastSizeCheckTime = startTime;
    let bytesPerSecond = 0;

    // ETA and speed smoothing to prevent wild jumps
    let smoothedEta: number | undefined;
    let smoothedSpeed: number | undefined;
    let etaStabilityCount = 0;
    const MIN_PROGRESS_FOR_ETA = 3; // Need 3% progress before showing ETA
    const MIN_TIME_FOR_ETA = 10; // Need 10 seconds of data before showing ETA

    // Track values for brief glitch protection
    let lastKnownChunkCount = 0;
    let lastKnownFileProgress = 0;

    // Debug logging flag
    const DEBUG_PROGRESS = false;

    // Helper function to send progress updates
    // This uses INPUT-BASED progress tracking (like professional transcoding apps)
    const sendProgressUpdate = () => {
      if (!onProgress) return;

      const elapsed = (Date.now() - startTime) / 1000;

      // ========================================
      // 1. CALCULATE FILE PROGRESS FROM INPUT POSITION
      // ========================================
      // This is the core improvement: progress based on input stream position,
      // not output bytes or compression ratio guessing
      let fileProgress = 0;

      if (fileDuration > 0 && currentPositionSeconds > 0) {
        // PRIMARY: Use input position from progressreport (most accurate)
        // This is how professional apps like HandBrake, FFmpeg progress work
        fileProgress = Math.min(
          99,
          Math.round((currentPositionSeconds / fileDuration) * 100)
        );
      } else if (fileDuration > 0 && elapsed > 0) {
        // FALLBACK: If no position yet, show 0% or minimal progress
        // Don't guess - wait for real data
        fileProgress = 0;
      }

      // Ensure progress never goes backward
      if (fileProgress < lastKnownFileProgress) {
        fileProgress = lastKnownFileProgress;
      } else {
        lastKnownFileProgress = fileProgress;
      }

      // ========================================
      // 2. COUNT OUTPUT CHUNKS (for chunk progress display)
      // ========================================
      let chunkCount = 0;
      let totalOutputSize = 0;

      try {
        let chunkNum = 0;
        while (chunkNum <= 100) {
          const chunkFileName = `${inputFileName}_${String(chunkNum).padStart(2, "0")}.${config.outputFormat}`;
          const chunkPath = path.join(normalizedOutputDir, chunkFileName);

          if (fs.existsSync(chunkPath)) {
            try {
              const stats = fs.statSync(chunkPath);
              totalOutputSize += stats.size;
              if (
                stats.size > 0 ||
                config.outputFormat === "mp4" ||
                config.outputFormat === "mov"
              ) {
                chunkCount++;
              }
              chunkNum++;
            } catch {
              chunkNum++;
            }
          } else {
            break;
          }
        }
      } catch (e) {
        if (DEBUG_PROGRESS)
          debugLogger.warn(`[Progress] Error checking chunks: ${e}`);
      }

      // Update current chunk tracking
      if (chunkCount > lastKnownChunkCount) {
        lastKnownChunkCount = chunkCount;
      }
      if (chunkCount > 0) {
        currentChunk = chunkCount;
      } else if (currentPositionSeconds > 0) {
        currentChunk = 1;
      }

      // Track output throughput (secondary metric)
      const now = Date.now();
      const timeSinceLastCheck = (now - lastSizeCheckTime) / 1000;
      if (totalOutputSize > 0 && timeSinceLastCheck >= 1) {
        const bytesGrowth = totalOutputSize - lastTotalOutputSize;
        if (bytesGrowth > 0) {
          const instantSpeed = bytesGrowth / timeSinceLastCheck;
          bytesPerSecond =
            bytesPerSecond > 0
              ? bytesPerSecond * 0.7 + instantSpeed * 0.3
              : instantSpeed;
        }
        lastTotalOutputSize = totalOutputSize;
        lastSizeCheckTime = now;
      }

      // ========================================
      // 3. CALCULATE CHUNK PROGRESS
      // ========================================
      let chunkProgress = 0;

      if (totalChunks === 1) {
        // Single chunk: chunk progress = file progress
        chunkProgress = fileProgress;
      } else if (totalChunks > 1 && currentChunk > 0 && fileDuration > 0) {
        // Multiple chunks: calculate position within current chunk
        const chunkDurationSec = chunkDuration;
        const chunkStartTime = (currentChunk - 1) * chunkDurationSec;
        const chunkEndTime = Math.min(
          currentChunk * chunkDurationSec,
          fileDuration
        );
        const chunkLength = chunkEndTime - chunkStartTime;

        if (chunkLength > 0 && currentPositionSeconds >= chunkStartTime) {
          const positionInChunk = currentPositionSeconds - chunkStartTime;
          chunkProgress = Math.min(
            99,
            Math.round((positionInChunk / chunkLength) * 100)
          );
        }

        // If we've detected a new chunk file, the previous chunk is complete
        if (chunkCount > currentChunk) {
          chunkProgress = 100;
        }
      }

      // ========================================
      // 4. CALCULATE ENCODING SPEED AND ETA
      // ========================================
      let processingSpeed: number | undefined;
      let eta: number | undefined;
      let chunkEta: number | undefined;
      let fileEta: number | undefined;

      // Calculate encoding speed (realtime multiplier) with smoothing
      if (currentPositionSeconds > 0 && elapsed > 0) {
        const rawSpeed = currentPositionSeconds / elapsed;
        
        // Smooth the speed to prevent jitter (90% previous, 10% new)
        if (smoothedSpeed === undefined) {
          smoothedSpeed = rawSpeed;
        } else {
          smoothedSpeed = smoothedSpeed * 0.9 + rawSpeed * 0.1;
        }
        processingSpeed = smoothedSpeed;
      }

      // Calculate ETA based on input progress (most reliable method)
      if (
        fileProgress >= MIN_PROGRESS_FOR_ETA &&
        elapsed >= MIN_TIME_FOR_ETA &&
        currentPositionSeconds > 0
      ) {
        const remainingDuration = fileDuration - currentPositionSeconds;
        if (processingSpeed && processingSpeed > 0) {
          fileEta = Math.round(remainingDuration / processingSpeed);
          eta = fileEta;

          // Chunk ETA
          if (totalChunks > 1 && currentChunk > 0) {
            const chunkEndTime = Math.min(
              currentChunk * chunkDuration,
              fileDuration
            );
            const remainingInChunk = chunkEndTime - currentPositionSeconds;
            if (remainingInChunk > 0) {
              chunkEta = Math.round(remainingInChunk / processingSpeed);
            }
          } else {
            chunkEta = fileEta;
          }
        }
      }

      // Apply heavy ETA smoothing to prevent jumps
      // Professional apps show stable ETAs that decrease smoothly
      let displayEta: number | undefined;
      const hasEnoughDataForEta =
        fileProgress >= MIN_PROGRESS_FOR_ETA && elapsed >= MIN_TIME_FOR_ETA;

      if (eta !== undefined && hasEnoughDataForEta) {
        if (smoothedEta === undefined) {
          smoothedEta = eta;
          etaStabilityCount = 1;
        } else {
          // Heavy smoothing: 95% previous value, 5% new value
          // This prevents the jittery jumping while still tracking real changes
          const newSmoothedEta = smoothedEta * 0.95 + eta * 0.05;
          
          // Only allow ETA to decrease naturally, or increase if significantly higher
          // This prevents the "yo-yo" effect where ETA bounces up and down
          if (newSmoothedEta < smoothedEta) {
            // ETA is decreasing - allow it (normal progress)
            smoothedEta = newSmoothedEta;
          } else if (eta > smoothedEta * 1.1) {
            // ETA increased by more than 10% - something changed, update slowly
            smoothedEta = smoothedEta * 0.9 + eta * 0.1;
          }
          // Otherwise keep the previous ETA (small fluctuations ignored)
          
          etaStabilityCount = Math.min(10, etaStabilityCount + 1);
        }

        if (etaStabilityCount >= 2) {
          // Round to nearest 5 seconds to reduce visual noise
          displayEta = Math.round(smoothedEta / 5) * 5;
        }
      }

      // ========================================
      // 5. BUILD AND SEND PROGRESS UPDATE
      // ========================================

      // Format encoding speed
      let speedStr = "";
      if (processingSpeed !== undefined && processingSpeed > 0) {
        speedStr = `, Speed: ${processingSpeed.toFixed(2)}x`;
      }

      // Format position
      const posStr =
        currentPositionSeconds > 0
          ? `, Position: ${formatTime(Math.round(currentPositionSeconds))} / ${formatTime(Math.round(fileDuration))}`
          : "";

      // Format output size
      const outputStr =
        totalOutputSize > 0
          ? `, Output: ${(totalOutputSize / (1024 * 1024)).toFixed(1)}MB`
          : "";

      // Format ETA
      let etaStr = "";
      if (displayEta !== undefined) {
        etaStr = `, ETA: ${formatTime(displayEta)}`;
      } else if (elapsed > 5 && currentPositionSeconds === 0) {
        etaStr = `, ETA: starting...`;
      } else if (elapsed > 5 && !hasEnoughDataForEta) {
        etaStr = `, ETA: calculating...`;
      }

      debugLogger.info(
        `[Progress] File: ${fileProgress}%, Chunk: ${currentChunk}/${totalChunks} (${chunkProgress}%)` +
          posStr +
          outputStr +
          speedStr +
          etaStr
      );

      onProgress({
        fileProgress,
        chunkProgress,
        currentChunk: Math.max(1, currentChunk),
        totalChunks: Math.max(1, totalChunks),
        eta: displayEta,
        chunkEta: displayEta !== undefined ? chunkEta : undefined,
        fileEta: displayEta !== undefined ? fileEta : undefined,
        processingSpeed,
        currentPositionSeconds: currentPositionSeconds > 0 ? currentPositionSeconds : undefined,
        fileDuration: fileDuration > 0 ? fileDuration : undefined,
        outputBytes: totalOutputSize > 0 ? totalOutputSize : undefined,
      });
    };

    // Send initial progress update
    sendProgressUpdate();

    // Parse progressreport output to get input position
    // Actual format: "progressreport0 (00:00:03): 0 / 1352 seconds ( 0.0 %)"
    const parseProgressReport = (text: string) => {
      // Match the actual progressreport format: position / duration seconds
      const match = text.match(
        /progressreport\d*\s*\([^)]+\):\s*(\d+)\s*\/\s*(\d+)\s*seconds/i
      );
      if (match) {
        const position = parseInt(match[1], 10);
        const duration = parseInt(match[2], 10);

        // Update position (can be 0 at start, that's valid)
        currentPositionSeconds = position;

        // If we got a better duration from progressreport, use it
        if (duration > 0 && (fileDuration === 0 || durationIsEstimated)) {
          fileDuration = duration;
          durationIsEstimated = false;
          totalChunks = Math.ceil(fileDuration / chunkDuration);
          debugLogger.info(
            `[Progress] Duration from progressreport: ${duration}s, chunks: ${totalChunks}`
          );
        }

        return true;
      }
      return false;
    };

    gst.stdout.on("data", (data) => {
      const output = data.toString();

      // Try to parse progressreport data
      if (parseProgressReport(output)) {
        // Progress data parsed, trigger update
        sendProgressUpdate();
      } else if (output.trim()) {
        // Only log non-progress output
        debugLogger.info(`[GStreamer] ${output.trim()}`);
        debugLogger.logGStreamerOutput("stdout", output);
      }
    });

    gst.stderr.on("data", (data) => {
      const text = data.toString();

      // progressreport may output to stderr as well
      if (parseProgressReport(text)) {
        sendProgressUpdate();
        return;
      }

      // Check if this is just GStreamer status messages (not errors)
      const isStatusMessage =
        text.includes("Setting pipeline") ||
        text.includes("Pipeline is") ||
        text.includes("New clock") ||
        text.includes("Redistribute latency") ||
        text.includes("high-resolution clock");

      if (isStatusMessage) {
        debugLogger.info(`[GStreamer] ${text.trim()}`);
        debugLogger.logGStreamerOutput("stderr", text);
      } else if (text.trim()) {
        errorOutput += text;
        debugLogger.error(`[GStreamer ERROR] ${text.trim()}`);
        debugLogger.logGStreamerOutput("stderr", text);
      }
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
      if (isCancelled || signal === "SIGTERM" || signal === "SIGKILL") {
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
        // Log output file information
        try {
          // Check for output chunks
          let chunkNum = 0;
          let totalOutputSize = 0;
          while (chunkNum <= 100) {
            const chunkFileName = `${inputFileName}_${String(chunkNum).padStart(2, "0")}.${config.outputFormat}`;
            const chunkPath = path.join(normalizedOutputDir, chunkFileName);
            if (fs.existsSync(chunkPath)) {
              const stats = fs.statSync(chunkPath);
              totalOutputSize += stats.size;
              debugLogger.logOutputInfo(chunkPath, stats.size);
              chunkNum++;
            } else {
              break;
            }
          }
          if (totalOutputSize > 0) {
            debugLogger.log("OUTPUT_SUMMARY", "Encoding complete", {
              totalOutputSize,
              totalOutputSizeGB: (totalOutputSize / (1024 * 1024 * 1024)).toFixed(2),
              inputSize: inputFileSize,
              inputSizeGB: (inputFileSize / (1024 * 1024 * 1024)).toFixed(2),
              actualCompressionRatio: (inputFileSize / totalOutputSize).toFixed(2),
              targetCompressionRatio: config.compressionRatio,
              chunksCreated: chunkNum,
            });
          }
        } catch (e) {
          debugLogger.log("ERROR", `Failed to log output info: ${e}`);
        }
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
