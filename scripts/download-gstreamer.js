/**
 * Script to download and extract GStreamer binaries for Windows
 * Run this script before building the Electron app
 */

const https = require("https");
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

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(outputPath);

    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          return downloadFile(response.headers.location, outputPath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log(`Downloaded to ${outputPath}`);
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
  });
}

function extractMsi(msiPath, extractDir) {
  console.log(`Extracting ${msiPath}...`);

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

  // Try multiple extraction methods
  const methods = [
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
    // Method 3: PowerShell script (simple version)
    () => {
      console.log("Trying PowerShell extraction script...");
      try {
        const psScript = path.join(__dirname, "extract-gstreamer-simple.ps1");
        if (fs.existsSync(psScript)) {
          execSync(
            `powershell -ExecutionPolicy Bypass -File "${psScript}" -MsiPath "${msiPath}" -ExtractDir "${extractDir}"`,
            {
              stdio: "pipe",
              shell: true,
              timeout: 120000, // 2 minute timeout
            }
          );
          const gstLaunchPath = path.join(
            extractDir,
            "bin",
            "gst-launch-1.0.exe"
          );
          if (fs.existsSync(gstLaunchPath)) {
            console.log("✓ PowerShell script extraction successful");
            return true;
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
    // macOS setup
    console.log("Setting up GStreamer for macOS...");

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const url = GSTREAMER_URLS.darwin.universal;
    const pkgFileName = path.basename(url);
    const pkgPath = path.join(OUTPUT_DIR, pkgFileName);
    const extractDir = path.join(OUTPUT_DIR, "macos");

    // Check if already extracted
    const gstLaunchPath = path.join(extractDir, "bin", "gst-launch-1.0");
    if (fs.existsSync(gstLaunchPath)) {
      console.log("GStreamer already extracted. Skipping download.");
      return;
    }

    // Download if not exists
    if (!fs.existsSync(pkgPath)) {
      await downloadFile(url, pkgPath);
    } else {
      console.log("PKG file already exists. Skipping download.");
    }

    // Extract PKG (only works on macOS)
    if (!fs.existsSync(extractDir) || !fs.existsSync(gstLaunchPath)) {
      if (process.platform !== "darwin") {
        // Can't extract .pkg on Windows/Linux - provide manual instructions
        console.log("\n⚠️  Cannot extract macOS .pkg files on Windows/Linux.");
        console.log(
          "The .pkg file has been downloaded. You have two options:\n"
        );
        console.log("Option 1: Extract on a macOS machine");
        console.log(`  1. Copy ${pkgPath} to a macOS machine`);
        console.log(
          `  2. Run: node scripts/download-gstreamer.js --platform darwin`
        );
        console.log(`  3. Copy the extracted gstreamer/macos/ folder back\n`);
        console.log("Option 2: Manual extraction on macOS");
        console.log(`  1. On macOS, double-click: ${pkgPath}`);
        console.log(`  2. Install to a temporary location`);
        console.log(
          `  3. Copy installed files from /Library/Frameworks/GStreamer.framework/`
        );
        console.log(`  4. Place them in: ${extractDir}\n`);
        console.log(
          "The .pkg file will be included in the build, but extraction is required for bundling."
        );
        return; // Don't fail, just warn
      }

      try {
        await extractPkg(pkgPath, extractDir);
      } catch (error) {
        console.log("\n💡 Manual extraction:");
        console.log(`  1. Double-click: ${pkgPath}`);
        console.log(`  2. Install to a temporary location`);
        console.log(`  3. Copy the installed files to: ${extractDir}`);
        console.log(
          `  4. Or use: pkgutil --expand "${pkgPath}" "${extractDir}/temp"`
        );
        throw error;
      }
    } else {
      console.log("GStreamer already extracted.");
    }

    console.log("\nGStreamer setup complete!");
    console.log(`Location: ${extractDir}`);
    return;
  }

  if (platform !== "win32") {
    console.log("This script currently only supports Windows and macOS.");
    console.log(
      "For Linux, please install GStreamer manually and place it in the gstreamer/ directory."
    );
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

  // Download if not exists
  if (!fs.existsSync(msiPath)) {
    await downloadFile(url, msiPath);
  } else {
    console.log("MSI file already exists. Skipping download.");
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
