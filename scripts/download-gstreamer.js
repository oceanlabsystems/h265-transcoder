/**
 * Script to download and extract GStreamer binaries for Windows
 * Run this script before building the Electron app
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GSTREAMER_VERSION = "1.22.10";
const GSTREAMER_URLS = {
  win32: {
    x64: `https://gstreamer.freedesktop.org/data/pkg/windows/${GSTREAMER_VERSION}/msvc/gstreamer-1.0-msvc-x86_64-${GSTREAMER_VERSION}.msi`,
    ia32: `https://gstreamer.freedesktop.org/data/pkg/windows/${GSTREAMER_VERSION}/msvc/gstreamer-1.0-msvc-x86-${GSTREAMER_VERSION}.msi`,
  },
  darwin: {
    universal: `https://gstreamer.freedesktop.org/data/pkg/osx/${GSTREAMER_VERSION}/gstreamer-1.0-${GSTREAMER_VERSION}-universal.pkg`,
  },
};

const OUTPUT_DIR = path.join(__dirname, "..", "gstreamer");

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: true });
    return true;
  } catch {
    return false;
  }
}

function checkLinuxGStreamer() {
  console.log("Linux detected: using system GStreamer (no bundling download step).");

  const required = ["gst-launch-1.0", "gst-inspect-1.0", "gst-discoverer-1.0"];
  const missing = required.filter((c) => !commandExists(c));

  if (missing.length === 0) {
    try {
      const version = execSync("gst-launch-1.0 --version", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: true,
      })
        .trim()
        .split("\n")[0];
      console.log(`✓ GStreamer OK: ${version}`);
    } catch {
      console.log("✓ GStreamer tools found on PATH.");
    }
    console.log(
      "Nothing to download for Linux. You can build/run using your system installation."
    );
    return true;
  }

  console.log(`\n❌ Missing GStreamer tools on PATH: ${missing.join(", ")}`);
  console.log("\nInstall GStreamer for your distro, then re-run this command.\n");

  console.log("Debian/Ubuntu:");
  console.log(
    "  sudo apt update && sudo apt install -y \\\n" +
      "    gstreamer1.0-tools \\\n" +
      "    gstreamer1.0-plugins-base gstreamer1.0-plugins-good \\\n" +
      "    gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \\\n" +
      "    gstreamer1.0-libav"
  );

  console.log("\nFedora:");
  console.log(
    "  sudo dnf install -y \\\n" +
      "    gstreamer1 gstreamer1-plugins-base gstreamer1-plugins-good \\\n" +
      "    gstreamer1-plugins-bad-free gstreamer1-plugins-bad-freeworld \\\n" +
      "    gstreamer1-plugins-ugly gstreamer1-libav"
  );

  console.log("\nArch:");
  console.log(
    "  sudo pacman -S --needed \\\n" +
      "    gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad \\\n" +
      "    gst-plugins-ugly gst-libav"
  );

  console.log(
    "\nIf you prefer bundling on Linux, place a local GStreamer distribution in `gstreamer/linux/` with `bin/` and `lib/`."
  );
  return false;
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(outputPath);

    // Parse URL to get hostname and path
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
        Referer: urlObj.origin,
      },
    };

    const protocol = urlObj.protocol === "https:" ? https : http;

    const req = protocol.request(options, (response) => {
      // Handle redirects
      if (
        response.statusCode === 302 ||
        response.statusCode === 301 ||
        response.statusCode === 307 ||
        response.statusCode === 308
      ) {
        file.close();
        fs.unlink(outputPath, () => {});
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          // Handle relative redirects
          const absoluteRedirectUrl = redirectUrl.startsWith("http")
            ? redirectUrl
            : `${urlObj.protocol}//${urlObj.hostname}${redirectUrl}`;
          console.log(`Following redirect to: ${absoluteRedirectUrl}`);
          return downloadFile(absoluteRedirectUrl, outputPath)
            .then(resolve)
            .catch(reject);
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(outputPath, () => {});
        let errorMsg = `Failed to download: ${response.statusCode} ${response.statusMessage || ""}`;
        if (response.statusCode === 403) {
          errorMsg +=
            "\n\nThe server returned a 403 Forbidden error. This could mean:";
          errorMsg +=
            "\n- The file may have been moved or is no longer available";
          errorMsg += "\n- The server is blocking automated downloads";
          errorMsg +=
            "\n- Please try downloading manually from: https://gstreamer.freedesktop.org/download/";
        } else if (response.statusCode === 404) {
          errorMsg += "\n\nThe file was not found. The URL may have changed.";
          errorMsg +=
            "\nPlease check: https://gstreamer.freedesktop.org/download/";
        }
        reject(new Error(errorMsg));
        return;
      }

      // Track download progress
      const totalSize = parseInt(response.headers["content-length"] || "0", 10);
      let downloadedSize = 0;

      response.on("data", (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
          process.stdout.write(
            `\rDownloading... ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB / ${(totalSize / 1024 / 1024).toFixed(2)} MB)`
          );
        }
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        if (totalSize > 0) {
          console.log(""); // New line after progress
        }
        console.log(`Downloaded to ${outputPath}`);
        resolve();
      });
    });

    req.on("error", (err) => {
      file.close();
      fs.unlink(outputPath, () => {});
      reject(err);
    });

    req.end();
  });
}

function extractMsi(msiPath, extractDir) {
  console.log(`Extracting ${msiPath}...`);

  // Validate MSI file exists and is readable
  if (!fs.existsSync(msiPath)) {
    throw new Error(`MSI file not found: ${msiPath}`);
  }

  const stats = fs.statSync(msiPath);
  if (stats.size === 0) {
    throw new Error(
      `MSI file is empty: ${msiPath}\n` +
        `Please delete the file and run the script again to re-download it.\n` +
        `Or manually delete: ${msiPath}`
    );
  }

  // Check if MSI file has valid header (MSI files start with specific bytes)
  const msiHeader = Buffer.alloc(8);
  const fd = fs.openSync(msiPath, "r");
  fs.readSync(fd, msiHeader, 0, 8, 0);
  fs.closeSync(fd);

  // MSI files typically start with D0 CF 11 E0 A1 B1 1A E1 (OLE2 format)
  const isValidMsi = msiHeader[0] === 0xd0 && msiHeader[1] === 0xcf;
  if (!isValidMsi) {
    console.log("⚠️  Warning: MSI file may be corrupted or invalid format");
    console.log("   File header doesn't match expected MSI format");
    console.log("   Continuing anyway...");
  }

  // Ensure extract directory exists
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  // Method 0: Install MSI to temp location and copy (most reliable)
  console.log("Trying Windows Installer (install to temp and copy)...");
  try {
    const os = require("os");
    const tempInstallDir = path.join(
      os.tmpdir(),
      "gstreamer-temp-install-" + Date.now()
    );

    // Clean up temp dir if it exists
    if (fs.existsSync(tempInstallDir)) {
      fs.rmSync(tempInstallDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempInstallDir, { recursive: true });

    console.log(`Installing to temp location: ${tempInstallDir}`);

    // Install MSI to temp location using /i (install) instead of /a (admin install)
    execSync(
      `msiexec /i "${msiPath}" /qn TARGETDIR="${tempInstallDir}" INSTALLDIR="${tempInstallDir}" /L*v "${path.join(extractDir, "install.log")}"`,
      { stdio: "pipe", shell: true, timeout: 180000 }
    );

    // Look for installed files - MSI installs typically put files in the TARGETDIR
    const possibleInstallPaths = [
      path.join(tempInstallDir, "bin", "gst-launch-1.0.exe"),
      path.join(tempInstallDir, "MSVC-x86_64-1.0", "bin", "gst-launch-1.0.exe"),
      path.join(
        tempInstallDir,
        "gstreamer-1.0-msvc-x86_64-1.22.10",
        "bin",
        "gst-launch-1.0.exe"
      ),
    ];

    let sourceDir = null;
    for (const installPath of possibleInstallPaths) {
      if (fs.existsSync(installPath)) {
        sourceDir = path.dirname(path.dirname(installPath));
        console.log(`Found installed files at: ${sourceDir}`);
        break;
      }
    }

    // Also check if files are directly in temp dir
    const rootGstLaunch = path.join(
      tempInstallDir,
      "bin",
      "gst-launch-1.0.exe"
    );
    if (!sourceDir && fs.existsSync(rootGstLaunch)) {
      sourceDir = tempInstallDir;
      console.log(`Found installed files at root: ${sourceDir}`);
    }

    // Also check common GStreamer install locations
    if (!sourceDir) {
      const commonPaths = [
        path.join(
          process.env.ProgramFiles || "C:\\Program Files",
          "gstreamer",
          "1.0",
          "msvc_x86_64",
          "bin",
          "gst-launch-1.0.exe"
        ),
        path.join(
          process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
          "gstreamer",
          "1.0",
          "msvc_x86_64",
          "bin",
          "gst-launch-1.0.exe"
        ),
      ];
      for (const commonPath of commonPaths) {
        if (fs.existsSync(commonPath)) {
          sourceDir = path.dirname(path.dirname(commonPath));
          console.log(`Found installed files at: ${sourceDir}`);
          break;
        }
      }
    }

    if (sourceDir && fs.existsSync(sourceDir)) {
      console.log(`Copying files from ${sourceDir} to ${extractDir}`);
      // Copy all files
      copyDirectory(sourceDir, extractDir);

      // Verify extraction
      const gstLaunchPath = path.join(extractDir, "bin", "gst-launch-1.0.exe");
      if (fs.existsSync(gstLaunchPath)) {
        console.log("✓ Successfully extracted using Windows Installer");

        // Try to uninstall (optional, may fail)
        try {
          execSync(`msiexec /x "${msiPath}" /qn`, {
            stdio: "pipe",
            shell: true,
            timeout: 30000,
          });
        } catch (e) {
          // Ignore uninstall errors - files are already copied
        }

        // Clean up temp dir
        try {
          fs.rmSync(tempInstallDir, { recursive: true, force: true });
        } catch (e) {
          // Ignore cleanup errors
        }

        return;
      } else {
        console.log(
          "✗ Files copied but gst-launch-1.0.exe not found in expected location"
        );
      }
    } else {
      console.log(
        "✗ Installation completed but files not found in expected locations"
      );
      console.log(`  Checked: ${tempInstallDir}`);
    }

    // Clean up on failure
    try {
      fs.rmSync(tempInstallDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  } catch (error) {
    console.log(`✗ Windows Installer method failed: ${error.message}`);
    console.log(
      "  Note: This method may require administrator privileges or the MSI may need to be run interactively"
    );
  }

  // Method 0: Check if GStreamer is already installed on the system
  const checkInstalledGStreamer = () => {
    console.log("Checking for existing GStreamer installation...");
    const commonInstallPaths = [
      path.join(
        process.env.ProgramFiles || "C:\\Program Files",
        "gstreamer",
        "1.0",
        "msvc_x86_64"
      ),
      path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "gstreamer",
        "1.0",
        "msvc_x86_64"
      ),
      path.join(
        process.env.ProgramFiles || "C:\\Program Files",
        "GStreamer",
        "1.0",
        "msvc_x86_64"
      ),
      path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "GStreamer",
        "1.0",
        "msvc_x86_64"
      ),
    ];

    for (const installPath of commonInstallPaths) {
      const gstLaunchPath = path.join(installPath, "bin", "gst-launch-1.0.exe");
      if (fs.existsSync(gstLaunchPath)) {
        console.log(`Found installed GStreamer at: ${installPath}`);
        console.log(`Copying to: ${extractDir}`);
        copyDirectory(installPath, extractDir);

        const verifyPath = path.join(extractDir, "bin", "gst-launch-1.0.exe");
        if (fs.existsSync(verifyPath)) {
          console.log("✓ Successfully copied from system installation");
          return true;
        }
      }
    }
    return false;
  };

  // Try multiple extraction methods
  const methods = [
    // Method 0.5: Check for existing installation
    checkInstalledGStreamer,
    // Method 1: msiexec with proper admin install syntax
    () => {
      console.log("Trying msiexec extraction (method 1)...");
      try {
        // Use /a for administrative install, /qn for quiet, /L*v for logging
        const logFile = path.join(extractDir, "msiexec.log");
        execSync(
          `msiexec /a "${msiPath}" /qn TARGETDIR="${extractDir}" /L*v "${logFile}"`,
          {
            stdio: "pipe",
            shell: true,
            timeout: 60000, // 60 second timeout
          }
        );
        // Check if extraction actually worked
        const gstLaunchPath = path.join(
          extractDir,
          "bin",
          "gst-launch-1.0.exe"
        );
        if (fs.existsSync(gstLaunchPath)) {
          console.log("✓ msiexec extraction successful");
          return true;
        }
        console.log(
          "✗ msiexec completed but files not found in expected location"
        );
        return false;
      } catch (error) {
        console.log(`✗ msiexec failed: ${error.message}`);
        return false;
      }
    },
    // Method 2: msiexec with different target directory structure
    () => {
      console.log("Trying msiexec extraction (method 2 - alternative path)...");
      try {
        // Sometimes MSI extracts to a subdirectory
        const tempExtractDir = path.join(extractDir, "temp");
        if (!fs.existsSync(tempExtractDir)) {
          fs.mkdirSync(tempExtractDir, { recursive: true });
        }
        execSync(`msiexec /a "${msiPath}" /qn TARGETDIR="${tempExtractDir}"`, {
          stdio: "pipe",
          shell: true,
          timeout: 60000,
        });
        // Look for files in various possible locations
        const possiblePaths = [
          path.join(tempExtractDir, "bin", "gst-launch-1.0.exe"),
          path.join(
            tempExtractDir,
            "MSVC-x86_64-1.0",
            "bin",
            "gst-launch-1.0.exe"
          ),
          path.join(
            tempExtractDir,
            "gstreamer-1.0-msvc-x86_64-1.22.10",
            "bin",
            "gst-launch-1.0.exe"
          ),
        ];

        for (const possiblePath of possiblePaths) {
          if (fs.existsSync(possiblePath)) {
            // Move files to correct location
            const sourceDir = path.dirname(path.dirname(possiblePath));
            console.log(`Found files at: ${sourceDir}`);
            // Copy all files from source to extractDir
            copyDirectory(sourceDir, extractDir);
            // Clean up temp directory
            fs.rmSync(tempExtractDir, { recursive: true, force: true });
            console.log("✓ msiexec extraction successful (alternative method)");
            return true;
          }
        }
        return false;
      } catch (error) {
        console.log(`✗ msiexec alternative method failed: ${error.message}`);
        return false;
      }
    },
    // Method 3: PowerShell script (tries multiple methods)
    () => {
      console.log("Trying PowerShell extraction script...");
      try {
        const psScript = path.join(__dirname, "extract-gstreamer-simple.ps1");
        if (fs.existsSync(psScript)) {
          try {
            execSync(
              `powershell -ExecutionPolicy Bypass -File "${psScript}" -MsiPath "${msiPath}" -ExtractDir "${extractDir}"`,
              {
                stdio: "pipe",
                shell: true,
                timeout: 180000, // 3 minute timeout
              }
            );
          } catch (error) {
            // PowerShell script may exit with error even if it partially succeeded
            // Check if files were extracted anyway
            console.log(
              `PowerShell script exited with error: ${error.message}`
            );
          }

          // Check if extraction succeeded regardless of exit code
          const gstLaunchPath = path.join(
            extractDir,
            "bin",
            "gst-launch-1.0.exe"
          );

          // Also check alternative paths
          const alternativePaths = [
            gstLaunchPath,
            path.join(
              extractDir,
              "MSVC-x86_64-1.0",
              "bin",
              "gst-launch-1.0.exe"
            ),
            path.join(
              extractDir,
              "1.0",
              "msvc_x86_64",
              "bin",
              "gst-launch-1.0.exe"
            ),
          ];

          for (const checkPath of alternativePaths) {
            if (fs.existsSync(checkPath)) {
              // If found in alternative location, move to expected location
              if (checkPath !== gstLaunchPath) {
                const sourceDir = path.dirname(path.dirname(checkPath));
                console.log(
                  `Found files at: ${sourceDir}, copying to expected location...`
                );
                copyDirectory(sourceDir, extractDir);
              }
              if (fs.existsSync(gstLaunchPath)) {
                console.log("✓ PowerShell script extraction successful");
                return true;
              }
            }
          }
        }
        return false;
      } catch (error) {
        console.log(`✗ PowerShell script failed: ${error.message}`);
        return false;
      }
    },
    // Method 4: lessmsi (if available)
    () => {
      console.log("Trying lessmsi extraction...");
      try {
        execSync(`lessmsi x "${msiPath}" "${extractDir}\\"`, {
          stdio: "pipe",
          shell: true,
          timeout: 60000,
        });
        const gstLaunchPath = path.join(
          extractDir,
          "bin",
          "gst-launch-1.0.exe"
        );
        if (fs.existsSync(gstLaunchPath)) {
          console.log("✓ lessmsi extraction successful");
          return true;
        }
        return false;
      } catch (error) {
        console.log(`✗ lessmsi not available: ${error.message}`);
        return false;
      }
    },
  ];

  for (const method of methods) {
    try {
      if (method()) {
        // Verify extraction succeeded
        const gstLaunchPath = path.join(
          extractDir,
          "bin",
          "gst-launch-1.0.exe"
        );
        if (fs.existsSync(gstLaunchPath)) {
          console.log(`\n✓ Successfully extracted to ${extractDir}`);
          
          // Verify essential tools are present (gst-discoverer is needed for accurate duration detection)
          verifyAndCopyEssentialTools(extractDir);
          return;
        }
      }
    } catch (error) {
      // Try next method
      continue;
    }
  }

  // If all methods failed, provide manual instructions
  console.error("\n❌ Automatic extraction failed. Please extract manually:");
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("MANUAL EXTRACTION OPTIONS:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("Option 1: Use 7-Zip (Easiest)");
  console.log(
    `  1. Install 7-Zip from https://www.7-zip.org/ if not already installed`
  );
  console.log(`  2. Right-click: ${msiPath}`);
  console.log(
    `  3. Select "7-Zip" > "Extract Here" or "Extract to ${path.basename(extractDir)}"`
  );
  console.log(`  4. Look for a folder containing "bin" and "lib" directories`);
  console.log(`  5. Copy the contents to: ${extractDir}`);

  console.log("\nOption 2: Use PowerShell script (Recommended)");
  console.log(
    `  Run: powershell -ExecutionPolicy Bypass -File scripts/extract-gstreamer.ps1`
  );
  console.log(`  This script tries multiple extraction methods automatically.`);

  console.log("\nOption 3: Use lessmsi");
  console.log(`  1. Install lessmsi: choco install lessmsi`);
  console.log(
    `     Or download from: https://github.com/activescott/lessmsi/releases`
  );
  console.log(`  2. Run: lessmsi x "${msiPath}" "${extractDir}\\"`);

  console.log("\nOption 4: Use Windows Installer + Manual Copy");
  console.log(`  1. Double-click: ${msiPath}`);
  console.log(
    `  2. Install to a temporary location (e.g., C:\\Temp\\GStreamer)`
  );
  console.log(`  3. Copy the installed folder contents to: ${extractDir}`);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\nAfter extraction, verify this file exists:`);
  console.log(`  ${path.join(extractDir, "bin", "gst-launch-1.0.exe")}\n`);

  throw new Error(
    "MSI extraction failed. Please extract manually using one of the methods above."
  );
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Verify essential GStreamer tools are present and copy from system if needed.
 * gst-discoverer-1.0 is critical for accurate video duration detection.
 */
function verifyAndCopyEssentialTools(extractDir) {
  const platform = process.platform;
  const exe = platform === "win32" ? ".exe" : "";
  
  // Essential tools that should be present
  const essentialTools = [
    `gst-launch-1.0${exe}`,
    `gst-discoverer-1.0${exe}`,  // Critical for duration detection
    `gst-inspect-1.0${exe}`,
  ];
  
  const binDir = path.join(extractDir, "bin");
  const missingTools = [];
  
  for (const tool of essentialTools) {
    const toolPath = path.join(binDir, tool);
    if (!fs.existsSync(toolPath)) {
      missingTools.push(tool);
    }
  }
  
  if (missingTools.length === 0) {
    console.log("✓ All essential GStreamer tools present");
    return;
  }
  
  console.log(`\n⚠️  Missing essential tools: ${missingTools.join(", ")}`);
  console.log("Attempting to copy from system GStreamer installation...");
  
  // Try to find system GStreamer installation
  const systemPaths = platform === "win32" ? [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "gstreamer", "1.0", "msvc_x86_64", "bin"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "gstreamer", "1.0", "msvc_x86_64", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "GStreamer", "1.0", "msvc_x86_64", "bin"),
    "C:\\gstreamer\\1.0\\msvc_x86_64\\bin",
  ] : [
    "/usr/bin",
    "/usr/local/bin",
    "/opt/gstreamer/bin",
  ];
  
  let copiedCount = 0;
  for (const tool of missingTools) {
    for (const systemPath of systemPaths) {
      const sourcePath = path.join(systemPath, tool);
      if (fs.existsSync(sourcePath)) {
        const destPath = path.join(binDir, tool);
        try {
          fs.copyFileSync(sourcePath, destPath);
          console.log(`  ✓ Copied ${tool} from ${systemPath}`);
          copiedCount++;
          break;
        } catch (e) {
          console.log(`  ✗ Failed to copy ${tool}: ${e.message}`);
        }
      }
    }
  }
  
  if (copiedCount < missingTools.length) {
    const stillMissing = missingTools.filter(tool => !fs.existsSync(path.join(binDir, tool)));
    if (stillMissing.length > 0) {
      console.log(`\n⚠️  Could not find: ${stillMissing.join(", ")}`);
      console.log("These tools are optional but recommended for best performance.");
      if (stillMissing.includes(`gst-discoverer-1.0${exe}`)) {
        console.log("\nNote: gst-discoverer-1.0 is needed for accurate video duration detection.");
        console.log("Without it, progress estimates will be less accurate.");
        console.log("To fix: Install GStreamer from https://gstreamer.freedesktop.org/download/");
      }
    }
  } else {
    console.log("✓ All missing tools copied successfully");
  }
}

/**
 * Bundle GStreamer for macOS using the dedicated bundling script.
 * This script handles:
 * - Extracting from .pkg or using installed framework
 * - Copying all required dylibs
 * - Rewriting library paths with install_name_tool
 */
async function bundleMacOSGStreamer(extractDir) {
  const bundleScript = path.join(__dirname, "bundle-gstreamer-macos.sh");
  
  if (!fs.existsSync(bundleScript)) {
    throw new Error(`Bundle script not found: ${bundleScript}`);
  }
  
  console.log("Running macOS GStreamer bundling script...");
  console.log("This will collect dependencies and rewrite library paths.\n");
  
  try {
    execSync(`bash "${bundleScript}"`, {
      stdio: "inherit",  // Show output in real-time
      timeout: 600000,   // 10 minute timeout (bundling can take a while)
      cwd: path.dirname(__dirname),
    });
    
    // Verify the bundle was created
    const gstLaunchPath = path.join(extractDir, "bin", "gst-launch-1.0");
    if (fs.existsSync(gstLaunchPath)) {
      console.log("\n✓ macOS GStreamer bundle created successfully");
      return true;
    } else {
      throw new Error("Bundle script completed but gst-launch-1.0 not found");
    }
  } catch (error) {
    if (error.status !== undefined) {
      // Script exited with error
      throw new Error(`Bundle script failed with exit code ${error.status}`);
    }
    throw error;
  }
}

async function extractPkg(pkgPath, extractDir) {
  console.log(`Extracting ${pkgPath}...`);

  // Ensure extract directory exists
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  try {
    // macOS .pkg files are actually xar archives
    // Extract using xar (built into macOS)
    const tempExtractDir = path.join(extractDir, "temp");
    if (!fs.existsSync(tempExtractDir)) {
      fs.mkdirSync(tempExtractDir, { recursive: true });
    }

    // Extract the xar archive
    execSync(`xar -xf "${pkgPath}" -C "${tempExtractDir}"`, {
      stdio: "pipe",
      timeout: 120000,
    });

    // Look for Payload files (gzip compressed cpio archives)
    const payloadFiles = [];
    function findPayloadFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findPayloadFiles(fullPath);
        } else if (entry.name === "Payload" || entry.name.endsWith(".pkg")) {
          payloadFiles.push(fullPath);
        }
      }
    }
    findPayloadFiles(tempExtractDir);

    // Extract Payload files
    for (const payloadFile of payloadFiles) {
      try {
        // Payload files are gzip compressed cpio archives
        execSync(
          `cd "${tempExtractDir}" && cat "${payloadFile}" | gunzip | cpio -i`,
          {
            stdio: "pipe",
            timeout: 300000,
          }
        );
      } catch (e) {
        // Try alternative extraction method
        try {
          execSync(`cd "${tempExtractDir}" && xar -xf "${payloadFile}"`, {
            stdio: "pipe",
            timeout: 120000,
          });
        } catch (e2) {
          console.log(`Warning: Could not extract ${payloadFile}`);
        }
      }
    }

    // Look for GStreamer installation (typically in Library/Frameworks or usr/local)
    const possiblePaths = [
      // Framework structure (most common for macOS .pkg)
      {
        path: path.join(
          tempExtractDir,
          "Library",
          "Frameworks",
          "GStreamer.framework",
          "Versions",
          "1.0"
        ),
        check: "bin",
      },
      {
        path: path.join(
          tempExtractDir,
          "Library",
          "Frameworks",
          "GStreamer.framework"
        ),
        check: "Versions",
      },
      // Standard Unix structure
      {
        path: path.join(tempExtractDir, "usr", "local"),
        check: "lib",
      },
      // Direct structure
      {
        path: tempExtractDir,
        check: "bin",
      },
    ];

    let sourceDir = null;
    for (const possible of possiblePaths) {
      const checkPath = path.join(possible.path, possible.check);
      if (fs.existsSync(checkPath)) {
        // Check for gst-launch-1.0
        const gstLaunch = path.join(possible.path, "bin", "gst-launch-1.0");
        if (fs.existsSync(gstLaunch)) {
          sourceDir = possible.path;
          console.log(`Found GStreamer at: ${sourceDir}`);
          break;
        }
      }
    }

    if (sourceDir && fs.existsSync(sourceDir)) {
      // Copy files to extract directory
      copyDirectory(sourceDir, extractDir);

      // Clean up temp directory
      fs.rmSync(tempExtractDir, { recursive: true, force: true });

      // Verify extraction - check multiple possible locations
      const checkPaths = [
        path.join(extractDir, "bin", "gst-launch-1.0"),
        path.join(extractDir, "Versions", "1.0", "bin", "gst-launch-1.0"),
        path.join(
          extractDir,
          "GStreamer.framework",
          "Versions",
          "1.0",
          "bin",
          "gst-launch-1.0"
        ),
      ];

      for (const checkPath of checkPaths) {
        if (fs.existsSync(checkPath)) {
          console.log("✓ Successfully extracted macOS GStreamer");
          return;
        }
      }
    }

    throw new Error("GStreamer files not found in extracted package");
  } catch (error) {
    console.log(`✗ PKG extraction failed: ${error.message}`);
    throw error;
  }
}

async function setupGStreamer(targetPlatform) {
  // Allow specifying target platform for cross-compilation
  // e.g., setupGStreamer('darwin') to download macOS GStreamer on Windows
  const platform = targetPlatform || process.platform;

  if (platform === "darwin") {
    // macOS setup - use dedicated bundling script for proper dylib handling
    console.log("Setting up GStreamer for macOS...\n");

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const extractDir = path.join(OUTPUT_DIR, "macos");
    const gstLaunchPath = path.join(extractDir, "bin", "gst-launch-1.0");

    // Check if already bundled and working
    if (fs.existsSync(gstLaunchPath)) {
      // Verify the bundle works (check for dylib issues)
      try {
        execSync(`"${gstLaunchPath}" --version`, {
          stdio: "pipe",
          timeout: 10000,
          env: {
            ...process.env,
            DYLD_LIBRARY_PATH: path.join(extractDir, "lib"),
            GST_PLUGIN_PATH: path.join(extractDir, "lib", "gstreamer-1.0"),
          },
        });
        console.log("GStreamer already bundled and working. Skipping setup.");
        return;
      } catch (e) {
        console.log("Existing bundle has issues, will re-bundle...");
        // Continue to re-bundle
      }
    }

    // Must run on macOS for proper bundling (need install_name_tool)
    if (process.platform !== "darwin") {
      console.log("⚠️  macOS GStreamer bundling must be done on macOS.");
      console.log("This is because we need install_name_tool to rewrite dylib paths.\n");
      
      // Download the .pkg for later use
      const url = GSTREAMER_URLS.darwin.universal;
      const pkgFileName = path.basename(url);
      const pkgPath = path.join(OUTPUT_DIR, pkgFileName);
      
      if (!fs.existsSync(pkgPath)) {
        console.log("Downloading GStreamer .pkg for later bundling on macOS...");
        await downloadFile(url, pkgPath);
      }
      
      console.log("\nTo complete macOS setup:");
      console.log("  1. On a macOS machine, install GStreamer from:");
      console.log("     https://gstreamer.freedesktop.org/download/");
      console.log("  2. Run: npm run download-gstreamer");
      console.log("     (or: bash scripts/bundle-gstreamer-macos.sh)");
      console.log("  3. The script will bundle GStreamer with proper dylib paths");
      return;
    }

    // On macOS: use the bundling script
    // First, check if GStreamer framework is installed or .pkg exists
    const frameworkPath = "/Library/Frameworks/GStreamer.framework/Versions/1.0";
    const homebrewArmPath = "/opt/homebrew/opt/gstreamer";
    const homebrewIntelPath = "/usr/local/opt/gstreamer";
    const url = GSTREAMER_URLS.darwin.universal;
    const pkgFileName = path.basename(url);
    const pkgPath = path.join(OUTPUT_DIR, pkgFileName);
    
    const hasFramework = fs.existsSync(frameworkPath);
    const hasHomebrew = fs.existsSync(homebrewArmPath) || fs.existsSync(homebrewIntelPath);
    const hasPkg = fs.existsSync(pkgPath);
    
    if (!hasFramework && !hasHomebrew && !hasPkg) {
      console.log("GStreamer not found. Downloading...\n");
      await downloadFile(url, pkgPath);
      console.log("\nNow installing GStreamer framework...");
      console.log("(You may be prompted for your password)\n");
      
      try {
        // Install the .pkg to get the framework
        execSync(`sudo installer -pkg "${pkgPath}" -target /`, {
          stdio: "inherit",
          timeout: 300000,
        });
        console.log("\n✓ GStreamer framework installed");
      } catch (e) {
        console.log("\n⚠️  Could not auto-install GStreamer framework.");
        console.log("Please install manually:");
        console.log(`  1. Double-click: ${pkgPath}`);
        console.log("  2. Follow the installer");
        console.log("  3. Re-run: npm run download-gstreamer");
        return;
      }
    }

    // Run the bundling script
    try {
      await bundleMacOSGStreamer(extractDir);
    } catch (error) {
      console.error("\n❌ Failed to bundle macOS GStreamer:", error.message);
      console.log("\nManual bundling:");
      console.log("  1. Ensure GStreamer is installed:");
      console.log("     - Official: https://gstreamer.freedesktop.org/download/");
      console.log("     - Or Homebrew: brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav");
      console.log("  2. Run: bash scripts/bundle-gstreamer-macos.sh");
      throw error;
    }

    console.log("\nGStreamer setup complete!");
    console.log(`Location: ${extractDir}`);
    return;
  }

  if (platform !== "win32") {
    if (platform === "linux") {
      // Linux: rely on system GStreamer (preferred) or optionally a local bundle in gstreamer/linux
      checkLinuxGStreamer();
      return;
    }

    console.log("This script currently only supports Windows and macOS.");
    return;
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const arch = process.arch === "x64" ? "x64" : "ia32";
  const url = GSTREAMER_URLS.win32[arch];

  if (!url) {
    console.error(`Unsupported architecture: ${arch}`);
    return;
  }

  const msiFileName = path.basename(url);
  const msiPath = path.join(OUTPUT_DIR, msiFileName);
  const extractDir = path.join(OUTPUT_DIR, arch);

  // Check if already extracted
  const gstLaunchPath = path.join(extractDir, "bin", "gst-launch-1.0.exe");
  if (fs.existsSync(gstLaunchPath)) {
    console.log("GStreamer already extracted. Skipping download.");
    return;
  }

  // Check if GStreamer is already installed on the system
  console.log("Checking for existing GStreamer installation on system...");
  const commonInstallPaths = [
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "gstreamer",
      "1.0",
      "msvc_x86_64"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "gstreamer",
      "1.0",
      "msvc_x86_64"
    ),
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "GStreamer",
      "1.0",
      "msvc_x86_64"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "GStreamer",
      "1.0",
      "msvc_x86_64"
    ),
  ];

  for (const installPath of commonInstallPaths) {
    const systemGstLaunch = path.join(installPath, "bin", "gst-launch-1.0.exe");
    if (fs.existsSync(systemGstLaunch)) {
      console.log(`Found installed GStreamer at: ${installPath}`);
      console.log(`Copying to: ${extractDir}`);

      // Ensure extract directory exists
      if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
      }

      copyDirectory(installPath, extractDir);

      if (fs.existsSync(gstLaunchPath)) {
        console.log("✓ Successfully copied from system installation");
        console.log("\nGStreamer setup complete!");
        console.log(`Location: ${extractDir}`);
        return;
      }
    }
  }
  console.log("No existing GStreamer installation found on system.");

  // Download if not exists or if file is empty/corrupted
  let needsDownload = false;
  if (!fs.existsSync(msiPath)) {
    needsDownload = true;
  } else {
    // Validate existing file
    const stats = fs.statSync(msiPath);
    if (stats.size === 0) {
      console.log("MSI file is empty. Re-downloading...");
      fs.unlinkSync(msiPath);
      needsDownload = true;
    } else {
      // Check MSI file header to ensure it's valid
      try {
        const msiHeader = Buffer.alloc(8);
        const fd = fs.openSync(msiPath, "r");
        fs.readSync(fd, msiHeader, 0, 8, 0);
        fs.closeSync(fd);

        // MSI files typically start with D0 CF 11 E0 A1 B1 1A E1 (OLE2 format)
        const isValidMsi = msiHeader[0] === 0xd0 && msiHeader[1] === 0xcf;
        if (!isValidMsi) {
          console.log(
            "MSI file appears corrupted (invalid header). Re-downloading..."
          );
          fs.unlinkSync(msiPath);
          needsDownload = true;
        } else {
          console.log(
            "MSI file already exists and appears valid. Skipping download."
          );
        }
      } catch (error) {
        console.log(
          `Error validating MSI file: ${error.message}. Re-downloading...`
        );
        try {
          fs.unlinkSync(msiPath);
        } catch (e) {
          // Ignore deletion errors
        }
        needsDownload = true;
      }
    }
  }

  if (needsDownload) {
    try {
      await downloadFile(url, msiPath);
    } catch (error) {
      console.error("\n❌ Failed to download GStreamer MSI file automatically");
      console.error(`Error: ${error.message}\n`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("MANUAL SETUP OPTIONS:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      console.log("Option 1: Install GStreamer on your system (RECOMMENDED)");
      console.log("  1. Visit: https://gstreamer.freedesktop.org/download/");
      console.log(
        "  2. Download the Windows MSVC x86_64 installer for version 1.22.10"
      );
      console.log("  3. Run the installer and install GStreamer");
      console.log("  4. Run the build command again - it will detect the installation\n");

      console.log("Option 2: Download MSI file manually");
      console.log(`  1. Download from: ${url}`);
      console.log(`  2. Save to: ${msiPath}`);
      console.log("  3. Run the build command again\n");

      console.log("Option 3: Copy from existing installation");
      console.log(
        "  If you have GStreamer installed elsewhere, copy the msvc_x86_64 folder to:"
      );
      console.log(`  ${extractDir}\n`);

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      throw error;
    }
  }

  // Extract MSI
  if (!fs.existsSync(extractDir) || !fs.existsSync(gstLaunchPath)) {
    try {
      extractMsi(msiPath, extractDir);
    } catch (error) {
      console.log("\n💡 Alternative: Try using the PowerShell script:");
      console.log(
        `   powershell -ExecutionPolicy Bypass -File scripts/extract-gstreamer.ps1`
      );
      console.log(
        `   Or extract manually using 7-Zip (see instructions above)\n`
      );
      throw error;
    }
  } else {
    console.log("GStreamer already extracted.");
  }

  // Always verify essential tools are present (may need to copy from system)
  verifyAndCopyEssentialTools(extractDir);

  console.log("\nGStreamer setup complete!");
  console.log(`Location: ${extractDir}`);
}

// Run if called directly
if (require.main === module) {
  // Check for platform argument: node download-gstreamer.js --platform darwin
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf("--platform");
  const targetPlatform =
    platformIndex !== -1 && args[platformIndex + 1]
      ? args[platformIndex + 1]
      : null;

  setupGStreamer(targetPlatform).catch((error) => {
    console.error("Error setting up GStreamer:", error);
    process.exit(1);
  });
}

module.exports = { setupGStreamer };
