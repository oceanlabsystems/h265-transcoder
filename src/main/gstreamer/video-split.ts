import { spawn } from "child_process";
import { BatchProcessConfig, ProcessStatus } from "../types/types";
import * as path from "path";
import * as fs from "fs";
import { getGstLaunchPath, getGStreamerPath } from "../utils/gstreamer-path";

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
export function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const fileUri = inputPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, "file:///$1:");

    const { env: gstEnv } = getGStreamerPath();
    const processEnv = { ...process.env, ...gstEnv };
    const gstLaunchPath = getGstLaunchPath();

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

export function processVideoFile(
  inputPath: string,
  outputDirectory: string,
  config: BatchProcessConfig,
  onProgress?: (status: {
    fileProgress: number;
    chunkProgress: number;
    currentChunk: number;
    totalChunks: number;
    eta?: number; // Overall ETA
    chunkEta?: number; // Current chunk ETA
    fileEta?: number; // Current file ETA
    processingSpeed?: number;
  }) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
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
      fileDuration = await getVideoDuration(inputPath);

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
    // Note: MP4/MOV formats buffer data until EOS (End of Stream) - files won't grow incrementally
    // MKV format supports incremental writing - files grow as data is processed
    let muxer = "qtmux"; // qtmux for MP4 (buffers until completion)
    if (config.outputFormat === "mkv") {
      muxer = "matroskamux"; // Matroska supports incremental writing
    } else if (config.outputFormat === "mov") {
      muxer = "qtmux"; // qtmux for MOV (buffers until completion)
    }

    // Build GStreamer pipeline
    // Use uridecodebin which automatically handles demuxing and decoding
    // It's more robust for handling various container formats and codecs
    let encoder: string;
    let useHardwareFormat = false;
    if (config.encoder === "nvh265") {
      encoder = "nvh265enc"; // NVIDIA hardware encoder
      useHardwareFormat = true;
    } else if (config.encoder === "qsvh265") {
      // Intel Quick Sync Video hardware encoder
      // Note: qsvh265enc may not be available in all GStreamer builds
      // If it fails, the error will suggest using x265 (Software) instead
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
      // Use format based on encoder:
      // NV12 for hardware encoders (nvh265enc, qsvh265enc)
      // I420 for software encoder (x265enc)
      ...(useHardwareFormat
        ? ["video/x-raw,format=NV12"]
        : ["video/x-raw,format=I420"]),
      "!",
      encoder,
      ...(config.bitrate ? [`bitrate=${config.bitrate}`] : []),
      // Add speed preset for x265enc (faster presets encode quicker but may have lower quality)
      // Hardware encoders (nvh265enc, qsvh265enc) are already fast and don't need speed presets
      ...(encoder === "x265enc"
        ? [
            config.speedPreset
              ? `speed-preset=${config.speedPreset}`
              : "speed-preset=medium", // Default to medium for x265
            // Note: threads property is not available in all x265enc builds
            // x265enc will automatically use available CPU cores
          ]
        : encoder === "qsvh265enc"
          ? [
              // Intel QSV encoder options
              // Note: Some properties may not be available in all GStreamer versions
              // If encoder fails, try removing these properties or use vaapih265enc instead
            ]
          : []),
      "!",
      "h265parse",
      "!",
      "splitmuxsink",
      // Convert Windows path to forward slashes and wrap in quotes for GStreamer compatibility
      // This ensures proper handling of paths with spaces or special characters
      `location="${outputBaseName.replace(/\\/g, "/")}_%02d.${config.outputFormat}"`,
      `max-size-time=${chunkDuration * 1000000000}`, // nanoseconds
      `muxer=${muxer}`,
      // For matroskamux: enable streamable mode for incremental writing
      // Note: MP4/MOV with qtmux will buffer until EOS - files won't show size until completion
      // MKV format is recommended for incremental file growth visibility
      ...(muxer === "matroskamux"
        ? [
            `muxer-properties=properties,streamable=true`,
            "async-finalize=true", // Enable async finalization for better incremental writing
          ]
        : []),
      "send-keyframe-requests=true", // Request keyframes for better chunking
    ].filter(Boolean); // Remove empty strings

    const gstLaunchPath = getGstLaunchPath();
    const { env: gstEnv, binPath } = getGStreamerPath();

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

    // Progress tracking variables
    let errorOutput = "";
    let lastFileProgress = 0;
    let lastChunkProgress = 0;
    let currentChunk = 0;
    let lastChunkCount = 0;
    let progressUpdateInterval: NodeJS.Timeout | null = null;
    const startTime = Date.now();

    // Byte-based progress tracking
    let lastTotalOutputSize = 0;
    let lastSizeCheckTime = startTime;
    let bytesPerSecond = 0; // Measured bytes processed per second
    let processedBytes = 0; // Total bytes processed (estimated from output size)
    let lastUpdateTime: number | null = null; // Track last update time for periodic updates

    // Helper function to send progress updates
    const sendProgressUpdate = () => {
      if (!onProgress) return;

      const elapsed = (Date.now() - startTime) / 1000; // seconds since start

      // Count existing chunks and track file sizes (BYTE-BASED MEASUREMENT)
      let chunkCount = 0;
      let totalOutputSize = 0;
      let currentChunkSize = 0;

      try {
        // Always check for the first chunk file (even if it doesn't exist yet)
        // This is critical for MP4/MOV which buffers until completion
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
            currentChunkSize = chunkSize;

            // For MP4/MOV, even zero-size files indicate processing has started
            // For MKV, we only count non-zero files
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

        // Check for additional chunks (for multi-chunk files)
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
                currentChunkSize = chunkSize;

                // For MP4/MOV, count even zero-size files (they're buffering)
                // For MKV, only count non-zero files
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

      // Update current chunk
      if (chunkCount > 0) {
        currentChunk = chunkCount;
        lastChunkCount = chunkCount;
      } else if (fileDuration > 0) {
        // No chunks yet, but we're processing - assume chunk 1
        currentChunk = 1;
      }

      // Calculate bytes per second based on file size growth
      const now = Date.now();
      const timeSinceLastCheck = (now - lastSizeCheckTime) / 1000; // seconds

      if (totalOutputSize > 0 && timeSinceLastCheck >= 1) {
        // Calculate bytes per second from file growth
        const bytesGrowth = totalOutputSize - lastTotalOutputSize;
        if (bytesGrowth > 0 && timeSinceLastCheck > 0) {
          // Use exponential moving average for smoother speed calculation
          const instantSpeed = bytesGrowth / timeSinceLastCheck;
          if (bytesPerSecond > 0) {
            bytesPerSecond = bytesPerSecond * 0.7 + instantSpeed * 0.3; // 70% old, 30% new
          } else {
            bytesPerSecond = instantSpeed;
          }
        }

        // Update processed bytes (this is our primary progress metric)
        processedBytes = totalOutputSize;

        lastTotalOutputSize = totalOutputSize;
        lastSizeCheckTime = now;
      } else if (totalOutputSize > 0 && bytesPerSecond === 0 && elapsed > 2) {
        // Initial speed estimate if we have output but no speed yet
        bytesPerSecond = totalOutputSize / elapsed;
        processedBytes = totalOutputSize;
      }

      // Update total chunks if we discovered more than estimated
      if (chunkCount > totalChunks && fileDuration === 0) {
        totalChunks = chunkCount;
      }

      // BYTE-BASED PROGRESS CALCULATION (with time-based fallback)
      // Industry best practice: Always provide progress feedback using multiple methods
      let fileProgress = 0;

      // Priority order:
      // 1. Use actual output file size when available (most accurate)
      // 2. Use time-based estimation when no file exists yet (updates continuously)
      // 3. Use processedBytes only if we have actual file data, not estimated

      if (inputFileSize > 0 && totalOutputSize > 0) {
        // Primary method: use actual output file size (most accurate)
        const byteRatio = Math.min(0.99, totalOutputSize / inputFileSize);
        fileProgress = Math.round(byteRatio * 100);
        processedBytes = totalOutputSize; // Update processedBytes from actual file
      } else if (fileDuration > 0 && elapsed > 0 && totalOutputSize === 0) {
        // Time-based progress when no output file exists yet
        // This is the primary progress method for buffering formats (MP4/MOV/MKV with splitmuxsink)
        //
        // CRITICAL INSIGHT: Video encoding is NOT realtime!
        // - H.265 encoding typically runs at 0.2x - 0.5x realtime for hardware encoders
        // - Plus there's muxing/finalization overhead at the end
        // - We estimate TOTAL PROCESSING TIME based on empirical encoder speeds
        //
        // Formula: progress = elapsed / expectedTotalTime
        // where expectedTotalTime = fileDuration / encodingSpeed + finalizationOverhead

        // Estimate encoding speed based on encoder and file size
        // These are conservative estimates to avoid getting stuck at high percentages
        let encodingSpeed: number;
        let finalizationOverheadSeconds: number;

        if (config.encoder === "qsvh265") {
          // Intel QSV: typically 0.25x - 0.4x for 4K H.265
          encodingSpeed = 0.3;
          finalizationOverheadSeconds = 30; // QSV has significant finalization overhead
        } else if (config.encoder === "nvh265") {
          // NVIDIA NVENC: typically 0.5x - 1.0x for 4K H.265
          encodingSpeed = 0.5;
          finalizationOverheadSeconds = 20;
        } else {
          // Software x265: typically 0.1x - 0.3x depending on preset
          encodingSpeed = 0.2;
          finalizationOverheadSeconds = 10;
        }

        // For large files (>5GB), add extra finalization time
        const fileSizeGB = inputFileSize / (1024 * 1024 * 1024);
        if (fileSizeGB > 5) {
          finalizationOverheadSeconds += Math.min(60, fileSizeGB * 5);
        }

        // Calculate expected total processing time
        const expectedEncodingTime = fileDuration / encodingSpeed;
        const expectedTotalTime =
          expectedEncodingTime + finalizationOverheadSeconds;

        // Progress is simply: elapsed / expectedTotalTime (capped at 99%)
        // This gives smooth, linear progress that doesn't get stuck
        const progressRatio = Math.min(0.99, elapsed / expectedTotalTime);
        fileProgress = Math.round(progressRatio * 100);

        // Debug logging
        if (
          elapsed % 10 === 0 ||
          elapsed < 10 ||
          fileProgress !== lastFileProgress
        ) {
          console.log(
            `[Time-based Progress] Elapsed: ${elapsed.toFixed(1)}s / ${expectedTotalTime.toFixed(1)}s expected, ` +
              `Progress: ${fileProgress}%, ` +
              `Encoding speed: ${encodingSpeed}x, ` +
              `File: ${fileSizeGB.toFixed(2)}GB`
          );
        }

        // Estimate processed bytes from progress for ETA calculations
        if (fileProgress > 0 && inputFileSize > 0) {
          processedBytes = (fileProgress / 100) * inputFileSize;
        }
      } else if (
        inputFileSize > 0 &&
        processedBytes > 0 &&
        totalOutputSize === 0
      ) {
        // Fallback: Only use processedBytes if we have actual file data (not time-based estimate)
        // This should rarely happen, but provides a safety net
        const byteRatio = Math.min(0.99, processedBytes / inputFileSize);
        fileProgress = Math.round(byteRatio * 100);
      } else if (fileDuration > 0 && bytesPerSecond > 0 && elapsed > 0) {
        // Fallback: estimate from bytes/second if we have speed but no input size
        const estimatedTotalBytes = bytesPerSecond * fileDuration;
        if (estimatedTotalBytes > 0) {
          fileProgress = Math.min(
            99,
            Math.round((processedBytes / estimatedTotalBytes) * 100)
          );
        }
      }

      // Calculate chunk progress (0-100 for current chunk)
      let chunkProgress = 0;

      if (totalChunks === 1) {
        // Special case: only 1 chunk - chunk progress = file progress
        chunkProgress = fileProgress;
      } else if (
        fileDuration > 0 &&
        totalChunks > 0 &&
        currentChunk > 0 &&
        inputFileSize > 0
      ) {
        // Multiple chunks: calculate progress within current chunk based on bytes
        // Estimate bytes per chunk
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
        // Fallback: estimate chunk progress from file progress
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

      // Calculate processing speed (video duration per second of wall-clock time)
      // Industry best practice: Use measured data when available, estimate otherwise
      let processingSpeed: number | undefined;

      // Get encoder-specific speed estimate (same as used in progress calculation)
      let estimatedEncodingSpeed: number;
      if (config.encoder === "qsvh265") {
        estimatedEncodingSpeed = 0.3;
      } else if (config.encoder === "nvh265") {
        estimatedEncodingSpeed = 0.5;
      } else {
        estimatedEncodingSpeed = 0.2;
      }

      if (bytesPerSecond > 0 && inputFileSize > 0 && fileDuration > 0) {
        // Primary: Convert bytes/second to video duration/second (most accurate)
        const bytesPerSecondOfVideo = inputFileSize / fileDuration;
        if (bytesPerSecondOfVideo > 0) {
          processingSpeed = bytesPerSecond / bytesPerSecondOfVideo;
        }
      } else if (fileDuration > 0 && elapsed > 0 && totalOutputSize === 0) {
        // Time-based estimate when no file exists yet
        // Use the encoder-specific speed estimate for consistency with progress
        processingSpeed = estimatedEncodingSpeed;
      } else if (fileDuration > 0 && elapsed > 0 && fileProgress > 0) {
        // Estimate speed from actual progress (derived from elapsed/expectedTotal)
        // If we've done X% of work in Y seconds, speed = (X% * duration) / Y
        const estimatedProcessedDuration = (fileProgress / 100) * fileDuration;
        if (estimatedProcessedDuration > 0) {
          processingSpeed = estimatedProcessedDuration / elapsed;
        }
      } else if (bytesPerSecond > 0 && inputFileSize > 0) {
        // Fallback: estimate speed from byte ratio if duration unknown
        const estimatedDuration = (inputFileSize / bytesPerSecond) * 0.7;
        if (estimatedDuration > 0 && elapsed > 0) {
          processingSpeed =
            ((processedBytes / inputFileSize) * estimatedDuration) / elapsed;
        }
      }

      // Calculate ETAs
      // Industry best practice: ETA = expectedTotalTime - elapsed (simple and accurate)
      let chunkEta: number | undefined;
      let fileEta: number | undefined;
      let eta: number | undefined;

      if (inputFileSize > 0 && bytesPerSecond > 0) {
        // Primary method: Calculate from measured bytes/second (most accurate when file exists)
        const remainingBytes = inputFileSize - processedBytes;

        if (remainingBytes > 0) {
          // File ETA: time to process remaining bytes
          fileEta = Math.round(remainingBytes / bytesPerSecond);

          // Chunk ETA: time to process remaining bytes in current chunk
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
        // Time-based ETA when no output file exists yet
        // Use same expected total time calculation as progress
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

        // ETA is simply: expectedTotalTime - elapsed (capped at 0)
        const remainingTime = Math.max(0, expectedTotalTime - elapsed);
        fileEta = Math.round(remainingTime);
        eta = fileEta;

        // For single chunk files, chunk ETA = file ETA
        if (totalChunks === 1) {
          chunkEta = fileEta;
        } else if (totalChunks > 0 && currentChunk > 0) {
          // Estimate chunk ETA based on expected chunk duration
          const expectedChunkTime = expectedTotalTime / totalChunks;
          const chunkStartTime = (currentChunk - 1) * expectedChunkTime;
          const chunkEndTime = currentChunk * expectedChunkTime;
          const remainingChunkTime = Math.max(0, chunkEndTime - elapsed);
          chunkEta = Math.round(remainingChunkTime);
        }
      } else if (fileDuration > 0 && processingSpeed && processingSpeed > 0) {
        // Fallback: Use video duration-based calculation
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

      // Always send updates periodically, or when values change significantly
      const shouldUpdate =
        fileProgress !== lastFileProgress ||
        chunkCount !== lastChunkCount ||
        Math.abs(chunkProgress - lastChunkProgress) > 1; // Update if chunk progress changed by more than 1%

      // Also update every few seconds even if nothing changed (for MP4/MOV buffering)
      const timeSinceLastUpdate = Date.now() - (lastUpdateTime || startTime);
      const forceUpdate = timeSinceLastUpdate > 2000; // Force update every 2 seconds

      // Always send update - the interval ensures we update regularly
      // This is important for MP4/MOV files that buffer until completion
      console.log(
        `[Progress Update] File: ${fileProgress}%, Chunk: ${currentChunk}/${totalChunks} (${chunkProgress}%), ` +
          `Overall ETA: ${eta !== undefined ? formatTime(eta) : "N/A"}, ` +
          `File ETA: ${fileEta !== undefined ? formatTime(fileEta) : "N/A"}, ` +
          `Chunk ETA: ${chunkEta !== undefined ? formatTime(chunkEta) : "N/A"}, ` +
          `Speed: ${processingSpeed ? processingSpeed.toFixed(2) + "x" : "N/A"}, ` +
          `Bytes/sec: ${bytesPerSecond > 0 ? (bytesPerSecond / (1024 * 1024)).toFixed(2) + " MB/s" : "N/A"}, ` +
          `Chunks found: ${chunkCount}, ` +
          `Output: ${(totalOutputSize / (1024 * 1024)).toFixed(2)}MB / ${(inputFileSize / (1024 * 1024)).toFixed(2)}MB, ` +
          `Elapsed: ${Math.round(elapsed)}s, ` +
          `Processed bytes: ${processedBytes > 0 ? (processedBytes / (1024 * 1024)).toFixed(2) + "MB" : "0MB"}`
      );
      onProgress({
        fileProgress,
        chunkProgress,
        // Only show chunk number if we have chunks or are processing
        currentChunk: chunkCount > 0 ? currentChunk : fileDuration > 0 ? 1 : 0,
        totalChunks: Math.max(1, totalChunks),
        eta, // Overall ETA
        chunkEta, // Current chunk ETA
        fileEta, // Current file ETA
        processingSpeed,
      });
      lastFileProgress = fileProgress;
      lastChunkProgress = chunkProgress;
      lastUpdateTime = Date.now();
    };

    // Send initial progress update
    sendProgressUpdate();

    gst.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`[GStreamer] ${output}`);
      // Progress is now tracked via file monitoring in sendProgressUpdate
    });

    gst.stderr.on("data", (data) => {
      const error = data.toString();
      errorOutput += error;
      console.error(`[GStreamer ERROR] ${error}`);
    });

    // Set up periodic progress updates
    // Update every 1 second to track chunk creation and calculate progress
    progressUpdateInterval = setInterval(() => {
      sendProgressUpdate();
    }, 1000); // Update every 1 second

    gst.on("exit", (code) => {
      // Clear progress interval
      if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
      }

      // Send final progress update
      if (code === 0 && onProgress) {
        // Final update with 100% progress
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
        // Check for common error codes
        let errorMsg = `GStreamer exited with code ${code}`;
        if (code === 3221226356 || code === -1073741819) {
          // STATUS_ACCESS_VIOLATION (0xC0000005) - crash/segfault
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
        // Check if it's an encoder availability issue
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
