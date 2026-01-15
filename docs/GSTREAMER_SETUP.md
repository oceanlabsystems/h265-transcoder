# GStreamer Bundling Setup

This application bundles GStreamer binaries to avoid requiring users to install third-party dependencies.

## Overview

GStreamer is automatically downloaded and bundled with the Electron app during the build process. The bundled GStreamer is located in the `gstreamer/` directory and is included in the final application package.

## Setup

### Automatic Setup (Recommended)

GStreamer is automatically downloaded when you run:

```bash
npm run download-gstreamer
```

This script:
- Downloads the appropriate GStreamer MSI installer for your platform/architecture
- Extracts the binaries to `gstreamer/{arch}/` directory
- Sets up the correct directory structure

The download script runs automatically before building via the `prebuild` script.

### Manual Setup

If the automatic extraction fails, try these alternatives:

**Option 1: PowerShell Script (Recommended)**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/extract-gstreamer.ps1
```
This script tries multiple extraction methods automatically.

**Option 2: 7-Zip (Easiest)**
1. Install 7-Zip from https://www.7-zip.org/ if not already installed
2. Right-click the MSI file in `gstreamer/` directory
3. Select "7-Zip" > "Extract Here" or "Extract to [folder]"
4. Look for a folder containing `bin` and `lib` directories
5. Copy the contents to `gstreamer/x64/` (or `gstreamer/x86/` for 32-bit)

**Option 3: Manual Download and Extract**
1. **Download GStreamer**:
   - Visit: https://gstreamer.freedesktop.org/download/
   - Download the MSVC build for Windows (x64 or x86 depending on your target)
   - Version: 1.22.10 or later

2. **Extract GStreamer**:
   - Extract the MSI or use the installer
   - Copy the contents to `gstreamer/{arch}/` where `{arch}` is `x64` or `x86`
   - The structure should be:
     ```
     gstreamer/
       x64/
         bin/
           gst-launch-1.0.exe
         lib/
           gstreamer-1.0/
           (various .dll files)
     ```

## Build Process

When building the Electron app, GStreamer is included via `extraResources` in `electron-builder`:

- GStreamer binaries are copied to `resources/gstreamer/` in the packaged app
- The app automatically detects and uses the bundled GStreamer
- Falls back to system GStreamer if bundled version is not found

## Runtime Behavior

The application automatically:

1. Checks for bundled GStreamer in `resources/gstreamer/` (production) or `gstreamer/` (development)
2. Sets up environment variables (`GST_PLUGIN_PATH`, `PATH`, etc.)
3. Uses the bundled `gst-launch-1.0` executable
4. Falls back to system GStreamer if bundled version is unavailable

## Platform Support

### Windows
- ✅ Fully supported via MSVC builds
- Downloads: `gstreamer-1.0-msvc-x86_64-{version}.msi` or `gstreamer-1.0-msvc-x86-{version}.msi`
- Architecture: x64 and ia32 (x86)

### macOS
- ⚠️ Manual setup required
- Download GStreamer from https://gstreamer.freedesktop.org/download/
- Place in `gstreamer/` directory

### Linux
- ⚠️ Manual setup required
- Install GStreamer development packages or download binaries
- Place in `gstreamer/` directory

## File Structure

```
gstreamer/
  x64/              # 64-bit Windows binaries
    bin/
      gst-launch-1.0.exe
      (other executables)
    lib/
      gstreamer-1.0/
        (plugin .dll files)
      (library .dll files)
  x86/              # 32-bit Windows binaries (if needed)
    (same structure)
```

## Troubleshooting

### GStreamer not found
- Ensure `gstreamer/{arch}/bin/gst-launch-1.0.exe` exists
- Check that the download script completed successfully
- Verify the file structure matches the expected layout

### Plugin errors
- Ensure `GST_PLUGIN_PATH` is set correctly
- Check that plugin DLLs are in `gstreamer/{arch}/lib/gstreamer-1.0/`
- Verify all required plugins are present

### Build size
- GStreamer adds ~100-200MB to the application size
- This is expected and necessary for standalone distribution

## Notes

- The `gstreamer/` directory is excluded from git (see `.gitignore`)
- MSI installers are also excluded to save repository space
- Only extracted binaries are included in the final package
