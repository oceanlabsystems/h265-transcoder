import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { RuntimeContext, getGStreamerPathWithContext } from "./gstreamer-path";
import { debugLogger } from "./debug-logger";

function shouldFallbackToSystemGStreamer(stderr: string): boolean {
  const s = (stderr || "").toLowerCase();
  return (
    // glibc mismatch (common when bundling on newer distros) - Linux
    s.includes("glibc_") ||
    (s.includes("libc.so.6") && s.includes("version") && s.includes("not found")) ||
    // loader errors - Linux
    s.includes("error while loading shared libraries") ||
    s.includes("no such file or directory") || // often printed by loader for missing interpreter/lib
    // dyld errors - macOS
    s.includes("library not loaded") ||
    s.includes("dyld") ||
    s.includes("reason: image not found") ||
    s.includes("mach-o") ||
    // Homebrew path issues on macOS
    s.includes("/opt/homebrew/") ||
    s.includes("/usr/local/opt/")
  );
}

async function spawnInspectAndCheck(
  inspectPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(inspectPath, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;

    const finish = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      finish({ code, stdout, stderr, timedOut });
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      finish({ code: 1, stdout: "", stderr: err.message, timedOut: false });
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
      finish({ code: 1, stdout, stderr, timedOut });
    }, timeoutMs);
  });
}

/**
 * Available encoder types
 */
export type EncoderType = "x265" | "nvh265" | "qsvh265" | "vtenc" | "vaapih265" | "msdkh265";

/**
 * Information about a detected encoder
 */
export interface EncoderInfo {
  id: EncoderType;
  name: string;
  description: string;
  gstreamerElement: string;
  available: boolean;
  recommended: boolean;
  priority: number; // Higher = better (used for recommendation)
  platform: "all" | "windows" | "macos" | "linux";
}

/**
 * Result of encoder detection
 */
export interface EncoderDetectionResult {
  encoders: EncoderInfo[];
  recommended: EncoderType;
  hasHardwareEncoder: boolean;
}

/**
 * All possible encoders with their metadata
 */
const ALL_ENCODERS: Omit<EncoderInfo, "available" | "recommended">[] = [
  {
    id: "nvh265",
    name: "NVIDIA NVENC",
    description: "NVIDIA GPU hardware encoding (fastest)",
    gstreamerElement: "nvh265enc",
    priority: 100,
    platform: "all", // Available on Windows/Linux with NVIDIA GPU
  },
  {
    id: "qsvh265",
    name: "Intel Quick Sync",
    description: "Intel GPU hardware encoding (fast)",
    gstreamerElement: "qsvh265enc",
    priority: 90,
    platform: "all", // Available on Windows/Linux/macOS with Intel GPU
  },
  {
    id: "msdkh265",
    name: "Intel Media SDK",
    description: "Intel Media SDK hardware encoding (recommended for Linux)",
    gstreamerElement: "msdkh265enc",
    priority: 88, // Preferred Intel encoder on Linux (more stable than VA-API)
    platform: "linux",
  },
  {
    id: "vaapih265",
    name: "VA-API (Intel/AMD)",
    description: "VA-API hardware encoding for Intel/AMD GPUs on Linux",
    gstreamerElement: "vaapih265enc",
    priority: 85, // Below MSDK but above software
    platform: "linux",
  },
  {
    id: "vtenc",
    name: "Apple VideoToolbox",
    description: "Apple Silicon/Intel Mac hardware encoding (fast)",
    gstreamerElement: "vtenc_h265",
    priority: 95, // High priority on macOS
    platform: "macos",
  },
  {
    id: "x265",
    name: "Software (x265)",
    description: "CPU-based encoding (slower, always available)",
    gstreamerElement: "x265enc",
    priority: 10,
    platform: "all",
  },
];

/**
 * Ensure the GStreamer registry directory exists and warm up the registry cache.
 * On first run, GStreamer needs to scan all plugins which can take 30+ seconds.
 * This function initializes the registry so subsequent calls are fast.
 */
async function ensureRegistryInitialized(
  context: RuntimeContext
): Promise<boolean> {
  const { env: gstEnv, binPath } = getGStreamerPathWithContext(context);
  const processEnv = { ...process.env, ...gstEnv };

  // Ensure registry directory exists
  const registryPath = processEnv.GST_REGISTRY_1_0;
  if (registryPath) {
    const registryDir = path.dirname(registryPath);
    if (!fs.existsSync(registryDir)) {
      try {
        fs.mkdirSync(registryDir, { recursive: true });
        debugLogger.logInit(
          `[Encoder Detection] Created registry directory: ${registryDir}`,
          context
        );
      } catch (e) {
        debugLogger.logInit(
          `[Encoder Detection] Failed to create registry directory: ${e}`,
          context
        );
      }
    }
  }

  // Check if registry already exists and is recent (less than 24 hours old)
  if (registryPath && fs.existsSync(registryPath)) {
    try {
      const stats = fs.statSync(registryPath);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      if (ageHours < 24) {
        debugLogger.logInit(
          `[Encoder Detection] Registry cache exists and is recent (${ageHours.toFixed(1)}h old)`,
          context
        );
        return true;
      }
    } catch {
      // Ignore stat errors
    }
  }

  debugLogger.logInit(
    `[Encoder Detection] Initializing GStreamer registry (this may take 30+ seconds on first run)...`
  );

  const platform = process.platform;
  const inspectExecutable =
    platform === "win32" ? "gst-inspect-1.0.exe" : "gst-inspect-1.0";
  let inspectPath = inspectExecutable;

  if (binPath) {
    const fullPath = path.join(binPath, inspectExecutable);
    if (fs.existsSync(fullPath)) {
      inspectPath = fullPath;
    }
  }

  // Run gst-inspect with --version to trigger registry initialization.
  // If a bundled Linux GStreamer can't execute (GLIBC mismatch), fall back to system GStreamer.
  const first = await spawnInspectAndCheck(
    inspectPath,
    ["--version"],
    processEnv,
    60000
  );

  debugLogger.logInit(
    `[Encoder Detection] Registry initialization completed (exit code: ${first.code})`,
    context
  );

  if (first.code === 0) return true;

  // Linux/macOS: fallback to system GStreamer if bundled version fails
  const isFallbackPlatform = process.platform === "linux" || process.platform === "darwin";
  if (
    isFallbackPlatform &&
    binPath &&
    inspectPath !== inspectExecutable &&
    shouldFallbackToSystemGStreamer(first.stderr)
  ) {
    debugLogger.logInit(
      "[Encoder Detection] Bundled GStreamer appears incompatible; retrying registry init with system GStreamer...",
      context
    );
    
    // On macOS, also try the system framework path
    let systemEnv = { ...process.env };
    if (process.platform === "darwin") {
      const frameworkPath = "/Library/Frameworks/GStreamer.framework/Versions/1.0";
      const frameworkBin = `${frameworkPath}/bin`;
      const frameworkLib = `${frameworkPath}/lib`;
      const frameworkPlugins = `${frameworkLib}/gstreamer-1.0`;
      
      if (fs.existsSync(frameworkBin)) {
        systemEnv = {
          ...systemEnv,
          PATH: `${frameworkBin}:${systemEnv.PATH || ""}`,
          DYLD_LIBRARY_PATH: `${frameworkLib}:${systemEnv.DYLD_LIBRARY_PATH || ""}`,
          GST_PLUGIN_PATH: frameworkPlugins,
          GST_PLUGIN_SYSTEM_PATH: frameworkPlugins,
        };
        debugLogger.logInit(
          `[Encoder Detection] Using macOS GStreamer framework for registry init`,
          context
        );
      }
    }
    
    const second = await spawnInspectAndCheck(
      inspectExecutable,
      ["--version"],
      systemEnv,
      60000
    );
    debugLogger.logInit(
      `[Encoder Detection] System registry init completed (exit code: ${second.code})`,
      context
    );
    return second.code === 0;
  }

  return false;
}

/**
 * Check if a GStreamer element is available using gst-inspect-1.0
 */
async function checkGStreamerElement(
  elementName: string,
  context: RuntimeContext,
  timeoutMs: number = 10000
): Promise<boolean> {
  return new Promise((resolve) => {
    const {
      env: gstEnv,
      binPath,
      pluginPath,
    } = getGStreamerPathWithContext(context);
    const processEnv = { ...process.env, ...gstEnv };

    const platform = process.platform;
    const inspectExecutable =
      platform === "win32" ? "gst-inspect-1.0.exe" : "gst-inspect-1.0";

    let inspectPath = inspectExecutable;

    // Debug: Log context and paths (for key elements to avoid spam)
    if (elementName === "nvh265enc" || elementName === "x265enc" || elementName === "vaapih265enc") {
      debugLogger.logInit(`[Encoder Detection] === PATH DEBUG ===`);
      debugLogger.logInit(
        `[Encoder Detection] Context: isPackaged=${context.isPackaged}`
      );
      debugLogger.logInit(
        `[Encoder Detection] Context: appPath=${context.appPath}`
      );
      debugLogger.logInit(
        `[Encoder Detection] Context: resourcesPath=${context.resourcesPath}`
      );
      debugLogger.logInit(`[Encoder Detection] Resolved binPath: ${binPath}`);
      debugLogger.logInit(
        `[Encoder Detection] Resolved pluginPath: ${pluginPath}`
      );
      debugLogger.logInit(
        `[Encoder Detection] GST_PLUGIN_PATH env: ${processEnv.GST_PLUGIN_PATH}`
      );
      
      // Log critical GStreamer scanner and registry paths
      const scannerPath = processEnv.GST_PLUGIN_SCANNER_1_0 || processEnv.GST_PLUGIN_SCANNER;
      if (scannerPath) {
        const scannerExists = fs.existsSync(scannerPath);
        debugLogger.logInit(
          `[Encoder Detection] Plugin scanner: ${scannerPath} (exists: ${scannerExists})`,
          context
        );
      } else {
        debugLogger.logInit(
          `[Encoder Detection] Plugin scanner: NOT SET (this will cause timeouts!)`,
          context
        );
      }
      debugLogger.logInit(
        `[Encoder Detection] Registry path: ${processEnv.GST_REGISTRY_1_0 || "(not set)"}`
      );
      
      debugLogger.logInit(
        `[Encoder Detection] PATH env (first 500 chars): ${(processEnv.PATH || "").substring(0, 500)}`
      );
    }

    if (binPath) {
      const fullPath = path.join(binPath, inspectExecutable);
      const exists = fs.existsSync(fullPath);
      debugLogger.logInit(
        `[Encoder Detection] Looking for ${inspectExecutable} at: ${fullPath} (exists: ${exists})`
      );
      if (exists) {
        inspectPath = fullPath;
      } else {
        // List directory contents for debugging
        try {
          if (fs.existsSync(binPath)) {
            const files = fs.readdirSync(binPath).slice(0, 20);
            debugLogger.logInit(
              `[Encoder Detection] binPath directory contents (first 20): ${files.join(", ")}`,
              context
            );
          } else {
            debugLogger.logInit(
              `[Encoder Detection] binPath does not exist: ${binPath}`,
              context
            );
            // Check parent directories
            const parent = path.dirname(binPath);
            if (fs.existsSync(parent)) {
              const parentFiles = fs.readdirSync(parent);
              debugLogger.logInit(
                `[Encoder Detection] Parent dir (${parent}) contents: ${parentFiles.join(", ")}`,
                context
              );
            }
          }
        } catch (e) {
          debugLogger.logInit(
            `[Encoder Detection] Error listing directory: ${e}`,
            context
          );
        }
      }
    }

    debugLogger.logInit(`[Encoder Detection] Using inspectPath: ${inspectPath}`);
    
    // Log critical GStreamer environment variables for debugging
    if (elementName === "nvh265enc" || elementName === "x265enc" || elementName === "vaapih265enc") {
      debugLogger.logInit(
        `[Encoder Detection] GST_PLUGIN_SCANNER_1_0: ${processEnv.GST_PLUGIN_SCANNER_1_0 || "(not set)"}`
      );
      debugLogger.logInit(
        `[Encoder Detection] GST_REGISTRY_1_0: ${processEnv.GST_REGISTRY_1_0 || "(not set)"}`
      );
    }

    (async () => {
      const first = await spawnInspectAndCheck(
        inspectPath,
        [elementName],
        processEnv,
        timeoutMs
      );

      const existsFirst =
        first.code === 0 &&
        first.stdout.length > 0 &&
        !first.stderr.includes("No such element");

      debugLogger.logInit(
        `[Encoder Detection] gst-inspect ${elementName}: exitCode=${first.code}, stdout=${first.stdout.length}bytes, exists=${existsFirst}${first.timedOut ? " (TIMED OUT)" : ""}`
      );
      if (first.stderr) {
        const stderrPreview = first.stderr.substring(0, 500);
        debugLogger.logInit(
          `[Encoder Detection] gst-inspect ${elementName} stderr: ${stderrPreview}`,
          context
        );
        // Log warning if Python plugin is causing issues
        if (stderrPreview.includes("libgstpython") || stderrPreview.includes("Python3.framework")) {
          debugLogger.logInit(
            `[Encoder Detection] Warning: Python plugin (libgstpython.dylib) is causing delays. This plugin should be excluded from the bundle.`,
            context
          );
        }
      }

      if (existsFirst) return resolve(true);

      // Only fallback to system GStreamer if bundled GStreamer can't execute (GLIBC/library errors)
      // Do NOT fallback for missing encoders - they should be in the bundle
      const isFallbackPlatform = process.platform === "linux" || process.platform === "darwin";
      const shouldTrySystem =
        isFallbackPlatform &&
        binPath &&
        inspectPath !== inspectExecutable &&
        shouldFallbackToSystemGStreamer(first.stderr);

      if (shouldTrySystem) {
        debugLogger.logInit(
          `[Encoder Detection] Bundled GStreamer appears incompatible; retrying ${elementName} check with system GStreamer...`,
          context
        );
        
        // On macOS, also try the system framework path
        let systemEnv = { ...process.env };
        if (process.platform === "darwin") {
          // Add framework paths for macOS system GStreamer
          const frameworkPath = "/Library/Frameworks/GStreamer.framework/Versions/1.0";
          const frameworkBin = `${frameworkPath}/bin`;
          const frameworkLib = `${frameworkPath}/lib`;
          const frameworkPlugins = `${frameworkLib}/gstreamer-1.0`;
          
          // Check if framework exists
          if (fs.existsSync(frameworkBin)) {
            systemEnv = {
              ...systemEnv,
              PATH: `${frameworkBin}:${systemEnv.PATH || ""}`,
              DYLD_LIBRARY_PATH: `${frameworkLib}:${systemEnv.DYLD_LIBRARY_PATH || ""}`,
              GST_PLUGIN_PATH: frameworkPlugins,
              GST_PLUGIN_SYSTEM_PATH: frameworkPlugins,
            };
            debugLogger.logInit(
              `[Encoder Detection] Using macOS GStreamer framework at ${frameworkPath}`,
              context
            );
          }
        }
        
        const second = await spawnInspectAndCheck(
          inspectExecutable,
          [elementName],
          systemEnv,
          timeoutMs
        );
        const existsSecond =
          second.code === 0 &&
          second.stdout.length > 0 &&
          !second.stderr.includes("No such element");

        debugLogger.logInit(
          `[Encoder Detection] system gst-inspect ${elementName}: exitCode=${second.code}, stdout=${second.stdout.length}bytes, exists=${existsSecond}${second.timedOut ? " (TIMED OUT)" : ""}`
        );
        if (second.stderr) {
          debugLogger.logInit(
            `[Encoder Detection] system gst-inspect ${elementName} stderr: ${second.stderr.substring(0, 500)}`,
            context
          );
        }
        return resolve(existsSecond);
      }

      // Encoder not found in bundled GStreamer and no compatibility issues
      // Return false - encoder should be in the bundle
      return resolve(false);
    })().catch(() => resolve(false));
  });
}

/**
 * Detect all available encoders on the system
 */
export async function detectAvailableEncoders(
  context: RuntimeContext
): Promise<EncoderDetectionResult> {
  const platform = process.platform;
  const results: EncoderInfo[] = [];

  debugLogger.logInit("[Encoder Detection] Scanning for available encoders...");

  // Initialize GStreamer registry first (critical for first run)
  // This can take 30+ seconds on first run but subsequent runs will be fast
  const registryReady = await ensureRegistryInitialized(context);
  if (!registryReady) {
    debugLogger.logInit(
      "[Encoder Detection] Warning: Registry initialization failed, encoder detection may be incomplete"
    );
  }

  // Check each encoder
  for (const encoder of ALL_ENCODERS) {
    // Skip platform-specific encoders on wrong platform
    if (encoder.platform === "macos" && platform !== "darwin") {
      continue;
    }
    if (encoder.platform === "windows" && platform !== "win32") {
      continue;
    }
    if (encoder.platform === "linux" && platform !== "linux") {
      continue;
    }

    const available = await checkGStreamerElement(
      encoder.gstreamerElement,
      context
    );

    debugLogger.logInit(
      `[Encoder Detection] ${encoder.name} (${encoder.gstreamerElement}): ${available ? "✓ Available" : "✗ Not available"}`
    );

    results.push({
      ...encoder,
      available,
      recommended: false, // Will be set below
    });
  }

  // Find the best available encoder (highest priority that's available)
  const availableEncoders = results.filter((e) => e.available);
  let recommendedId: EncoderType = "x265"; // Default fallback

  if (availableEncoders.length > 0) {
    // Sort by priority (descending) and pick the first
    availableEncoders.sort((a, b) => b.priority - a.priority);
    recommendedId = availableEncoders[0].id;

    // Mark the recommended encoder
    const recommendedEncoder = results.find((e) => e.id === recommendedId);
    if (recommendedEncoder) {
      recommendedEncoder.recommended = true;
    }
  }

  const hasHardwareEncoder = availableEncoders.some((e) => e.id !== "x265");

  debugLogger.logInit(
    `[Encoder Detection] Recommended encoder: ${recommendedId}${hasHardwareEncoder ? " (hardware acceleration available)" : " (software only)"}`
  );

  return {
    encoders: results,
    recommended: recommendedId,
    hasHardwareEncoder,
  };
}

/**
 * Get a quick check if any hardware encoder is available
 * (Faster than full detection - checks most common ones first)
 */
export async function hasHardwareEncoder(
  context: RuntimeContext
): Promise<boolean> {
  const platform = process.platform;

  // Check platform-specific hardware encoders first
  if (platform === "darwin") {
    // macOS: Check VideoToolbox first
    if (await checkGStreamerElement("vtenc_h265", context)) {
      return true;
    }
  }

  // Check NVIDIA (most common)
  if (await checkGStreamerElement("nvh265enc", context)) {
    return true;
  }

  // Check Intel QSV
  if (await checkGStreamerElement("qsvh265enc", context)) {
    return true;
  }

  // Check Intel MSDK (Linux)
  if (await checkGStreamerElement("msdkh265enc", context)) {
    return true;
  }

  // Check VA-API (Intel/AMD on Linux)
  if (await checkGStreamerElement("vaapih265enc", context)) {
    return true;
  }

  return false;
}
