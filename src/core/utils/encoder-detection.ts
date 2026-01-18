import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { RuntimeContext, getGStreamerPathWithContext } from "./gstreamer-path";
import { debugLogger } from "./debug-logger";

/**
 * Available encoder types
 */
export type EncoderType = "x265" | "nvh265" | "qsvh265" | "vtenc";

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

  return new Promise((resolve) => {
    // Run gst-inspect with --version to trigger registry initialization
    // This is faster than listing all elements but still builds the registry
    const gstInspect = spawn(inspectPath, ["--version"], {
      env: processEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let timedOut = false;

    gstInspect.on("exit", (code) => {
      if (!timedOut) {
        debugLogger.logInit(
          `[Encoder Detection] Registry initialization completed (exit code: ${code})`,
          context
        );
        resolve(code === 0);
      }
    });

    gstInspect.on("error", (err) => {
      debugLogger.logInit(
        `[Encoder Detection] Registry initialization error: ${err.message}`
      );
      resolve(false);
    });

    // Allow 60 seconds for first-time registry initialization
    setTimeout(() => {
      timedOut = true;
      debugLogger.logInit(
        `[Encoder Detection] Registry initialization timeout (60s) - killing process`
      );
      gstInspect.kill();
      resolve(false);
    }, 60000);
  });
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

    // Debug: Log context and paths (first element only to avoid spam)
    if (elementName === "nvh265enc" || elementName === "x265enc") {
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
    if (elementName === "nvh265enc" || elementName === "x265enc") {
      debugLogger.logInit(
        `[Encoder Detection] GST_PLUGIN_SCANNER_1_0: ${processEnv.GST_PLUGIN_SCANNER_1_0 || "(not set)"}`
      );
      debugLogger.logInit(
        `[Encoder Detection] GST_REGISTRY_1_0: ${processEnv.GST_REGISTRY_1_0 || "(not set)"}`
      );
    }

    const gstInspect = spawn(inspectPath, [elementName], {
      env: processEnv,
      stdio: ["ignore", "pipe", "pipe"],
      // Windows-specific: hide the console window to prevent GUI issues
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    gstInspect.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    gstInspect.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    gstInspect.on("exit", (code) => {
      // Element exists if exit code is 0 and we got output
      const exists =
        code === 0 && stdout.length > 0 && !stderr.includes("No such element");
      debugLogger.logInit(
        `[Encoder Detection] gst-inspect ${elementName}: exitCode=${code}, stdout=${stdout.length}bytes, exists=${exists}${timedOut ? " (TIMED OUT)" : ""}`
      );
      if (stderr) {
        debugLogger.logInit(
          `[Encoder Detection] gst-inspect ${elementName} stderr: ${stderr.substring(0, 500)}`,
          context
        );
      }
      resolve(exists);
    });

    gstInspect.on("error", (err) => {
      debugLogger.logInit(
        `[Encoder Detection] gst-inspect spawn error for ${elementName}: ${err.message}`
      );
      resolve(false);
    });

    // Timeout (default 10 seconds, can be overridden)
    setTimeout(() => {
      timedOut = true;
      debugLogger.logInit(
        `[Encoder Detection] gst-inspect ${elementName}: TIMEOUT (${timeoutMs}ms) - killing process`
      );
      gstInspect.kill();
      resolve(false);
    }, timeoutMs);
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

  return false;
}
