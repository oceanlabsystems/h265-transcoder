import { spawn } from "child_process";
import {
  RuntimeContext,
  getGStreamerPathWithContext,
} from "./gstreamer-path";

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
 * Check if a GStreamer element is available using gst-inspect-1.0
 */
async function checkGStreamerElement(
  elementName: string,
  context: RuntimeContext
): Promise<boolean> {
  return new Promise((resolve) => {
    const { env: gstEnv, binPath } = getGStreamerPathWithContext(context);
    const processEnv = { ...process.env, ...gstEnv };

    const platform = process.platform;
    const inspectExecutable =
      platform === "win32" ? "gst-inspect-1.0.exe" : "gst-inspect-1.0";

    let inspectPath = inspectExecutable;
    if (binPath) {
      const fullPath = require("path").join(binPath, inspectExecutable);
      if (require("fs").existsSync(fullPath)) {
        inspectPath = fullPath;
      }
    }

    const gstInspect = spawn(inspectPath, [elementName], {
      env: processEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    gstInspect.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    gstInspect.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    gstInspect.on("exit", (code) => {
      // Element exists if exit code is 0 and we got output
      const exists = code === 0 && stdout.length > 0 && !stderr.includes("No such element");
      resolve(exists);
    });

    gstInspect.on("error", () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      gstInspect.kill();
      resolve(false);
    }, 5000);
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

  console.log("[Encoder Detection] Scanning for available encoders...");

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

    console.log(
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

  const hasHardwareEncoder = availableEncoders.some(
    (e) => e.id !== "x265"
  );

  console.log(
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
