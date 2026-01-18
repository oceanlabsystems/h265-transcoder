import * as fs from "fs";
import * as path from "path";
import { RuntimeContext } from "./gstreamer-path";

/**
 * Debug logging utility with file persistence
 */
class DebugLogger {
  private enabled: boolean = false;
  private logDir: string | null = null;
  private logFile: string | null = null;
  private context: RuntimeContext | null = null;

  /**
   * Initialize the debug logger
   * Creates/overwrites log file on each launch
   */
  initialize(context: RuntimeContext): void {
    this.context = context;
    this.logDir = context.userDataPath || process.cwd();
    
    try {
      // Ensure log directory exists
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      // Create log file (overwrite on each launch)
      // Use a fixed name so it's overwritten each time
      this.logFile = path.join(this.logDir, `debug.log`);
      
      // Write header (overwrite mode - creates new file each launch)
      const header = `${"=".repeat(80)}\n` +
        `Application Log - Started: ${new Date().toISOString()}\n` +
        `Platform: ${process.platform} ${process.arch}\n` +
        `Node Version: ${process.version}\n` +
        `${"=".repeat(80)}\n\n`;
      
      fs.writeFileSync(this.logFile, header, "utf8");
    } catch (error) {
      // Can't use debugLogger here since it's not initialized yet
      // Use console.error as fallback for initialization errors only
      console.error(`[DebugLogger] Failed to initialize: ${error}`);
      this.logFile = null;
    }
  }

  /**
   * Enable or disable debug logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && this.logFile) {
      this.writeToFile(`\n[${new Date().toISOString()}] Debug logging ENABLED\n`);
    } else if (!enabled && this.logFile) {
      this.writeToFile(`\n[${new Date().toISOString()}] Debug logging DISABLED\n`);
    }
  }

  /**
   * Check if debug logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log a debug message
   * Only writes to file and console when debug is enabled
   */
  log(category: string, message: string, data?: any): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${category}] ${message}`;
    
    // Log to console
    console.log(logLine);
    
    // Write to file if available
    if (this.logFile) {
      try {
        let fileContent = logLine;
        if (data !== undefined) {
          fileContent += `\n${JSON.stringify(data, null, 2)}`;
        }
        fileContent += "\n";
        this.writeToFile(fileContent);
      } catch (error) {
        // Ignore write errors
      }
    }
  }

  /**
   * Log initialization message (always written to file, even if debug is disabled)
   * Use this for startup/initialization logs
   */
  logInit(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [INIT] ${message}`;
    
    // Always log to console
    console.log(logLine);
    
    // Always write to file if available
    if (this.logFile) {
      try {
        let fileContent = logLine;
        if (data !== undefined) {
          fileContent += `\n${JSON.stringify(data, null, 2)}`;
        }
        fileContent += "\n";
        this.writeToFile(fileContent);
      } catch (error) {
        // Ignore write errors
      }
    }
  }

  /**
   * Log an info message (replaces console.log)
   * Only writes to file and console when debug is enabled
   */
  info(message: string, data?: any): void {
    if (!this.enabled) return;
    this.log("INFO", message, data);
  }

  /**
   * Log a warning message (replaces console.warn)
   * Only writes to file and console when debug is enabled
   */
  warn(message: string, data?: any): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [WARN] ${message}`;
    
    // Log to console
    console.warn(logLine);
    
    // Write to file
    if (this.logFile) {
      try {
        let fileContent = logLine;
        if (data !== undefined) {
          fileContent += `\n${JSON.stringify(data, null, 2)}`;
        }
        fileContent += "\n";
        this.writeToFile(fileContent);
      } catch (error) {
        // Ignore write errors
      }
    }
  }

  /**
   * Log an error message (replaces console.error)
   * Always shows in console, only writes to file when debug is enabled
   */
  error(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [ERROR] ${message}`;
    
    // Always log errors to console
    console.error(logLine);
    
    // Only write to file if debug is enabled
    if (this.enabled && this.logFile) {
      try {
        let fileContent = logLine;
        if (data !== undefined) {
          fileContent += `\n${JSON.stringify(data, null, 2)}`;
        }
        fileContent += "\n";
        this.writeToFile(fileContent);
      } catch (error) {
        // Ignore write errors
      }
    }
  }

  /**
   * Log encoder configuration details
   * Only logs when debug is enabled
   */
  logEncoderConfig(
    encoder: string,
    compressionRatio: number,
    targetBitrateKbps: number,
    inputBitrateKbps?: number,
    encoderArgs?: string[]
  ): void {
    if (!this.enabled) return;
    this.log("ENCODER_CONFIG", "Encoder configuration", {
      encoder,
      compressionRatio,
      targetBitrateKbps,
      targetBitrateMbps: (targetBitrateKbps / 1000).toFixed(2),
      inputBitrateKbps,
      inputBitrateMbps: inputBitrateKbps ? (inputBitrateKbps / 1000).toFixed(2) : undefined,
      encoderArgs: encoderArgs || [],
    });
  }

  /**
   * Log GStreamer pipeline details
   * Only logs when debug is enabled
   */
  logPipeline(pipelineArgs: string[]): void {
    if (!this.enabled) return;
    // Reconstruct the pipeline string for logging
    const pipelineStr = pipelineArgs.join(" ");
    this.log("PIPELINE", "GStreamer pipeline", {
      fullPipeline: pipelineStr,
      args: pipelineArgs,
    });
  }

  /**
   * Log GStreamer output
   * Only logs when debug is enabled
   */
  logGStreamerOutput(source: "stdout" | "stderr", output: string): void {
    if (!this.enabled) return;
    this.log(`GSTREAMER_${source.toUpperCase()}`, output.trim());
  }

  /**
   * Log file information
   * Only logs when debug is enabled
   */
  logFileInfo(filePath: string, fileSize: number, duration?: number): void {
    if (!this.enabled) return;
    this.log("FILE_INFO", "Input file information", {
      path: filePath,
      size: fileSize,
      sizeGB: (fileSize / (1024 * 1024 * 1024)).toFixed(2),
      duration,
      durationMinutes: duration ? (duration / 60).toFixed(2) : undefined,
      calculatedBitrate: duration && fileSize > 0 
        ? ((fileSize * 8) / duration / 1000).toFixed(0)
        : undefined,
    });
  }

  /**
   * Log output file information
   * Only logs when debug is enabled
   */
  logOutputInfo(outputPath: string, fileSize: number): void {
    if (!this.enabled) return;
    this.log("OUTPUT_INFO", "Output file information", {
      path: outputPath,
      size: fileSize,
      sizeGB: (fileSize / (1024 * 1024 * 1024)).toFixed(2),
    });
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string | null {
    return this.logFile;
  }

  /**
   * Get all log files in the log directory
   */
  getLogFiles(): string[] {
    if (!this.logDir) return [];

    try {
      const files = fs.readdirSync(this.logDir);
      return files
        .filter((file) => file === "debug.log" || (file.startsWith("debug-") && file.endsWith(".log")))
        .map((file) => path.join(this.logDir!, file))
        .sort()
        .reverse(); // Most recent first
    } catch {
      return [];
    }
  }

  /**
   * Write to log file
   */
  private writeToFile(content: string): void {
    if (!this.logFile) return;

    try {
      fs.appendFileSync(this.logFile, content, "utf8");
    } catch (error) {
      // Ignore write errors
    }
  }
}

// Singleton instance
export const debugLogger = new DebugLogger();
