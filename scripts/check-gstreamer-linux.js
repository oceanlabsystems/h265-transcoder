#!/usr/bin/env node
/**
 * Lightweight Linux GStreamer dependency checker/installer helper.
 *
 * - Verifies required tools are present: gst-launch-1.0, gst-inspect-1.0, gst-discoverer-1.0.
 * - If any are missing:
 *   - When APT is available and AUTO_INSTALL_GSTREAMER=1 is set, attempts a non-interactive install.
 *   - Otherwise, prints distro-specific install commands.
 *
 * Intended for developer/installer use on Linux desktops/servers.
 */

const { execSync } = require("child_process");

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: true });
    return true;
  } catch {
    return false;
  }
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit", shell: true });
}

function installApt() {
  console.log("Using APT to install GStreamer dependencies...");
  run(
    "sudo apt-get update && sudo apt-get install -y " +
      "gstreamer1.0-tools " +
      "gstreamer1.0-plugins-base gstreamer1.0-plugins-good " +
      "gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly " +
      "gstreamer1.0-libav"
  );
}

function printInstructions() {
  console.log("\nGStreamer dependencies missing. Install them with:");
  console.log("\nDebian/Ubuntu:");
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
  console.log("");
}

function main() {
  if (process.platform !== "linux") {
    console.log("This checker is intended for Linux only.");
    return;
  }

  const required = ["gst-launch-1.0", "gst-inspect-1.0", "gst-discoverer-1.0"];
  const missing = required.filter((c) => !commandExists(c));

  if (missing.length === 0) {
    console.log("✓ GStreamer tools found on system PATH.");
    return;
  }

  console.log(`Missing: ${missing.join(", ")}`);

  const autoInstall = process.env.AUTO_INSTALL_GSTREAMER === "1";
  const hasApt = commandExists("apt-get");

  if (autoInstall && hasApt) {
    try {
      installApt();
      console.log("✓ Installation attempted via APT. Re-checking...");
      const stillMissing = required.filter((c) => !commandExists(c));
      if (stillMissing.length === 0) {
        console.log("✓ GStreamer tools now available.");
        return;
      }
      console.log(`Still missing: ${stillMissing.join(", ")}`);
    } catch (e) {
      console.error("Auto-install failed:", e.message);
    }
  }

  printInstructions();
  process.exitCode = 1;
}

main();
