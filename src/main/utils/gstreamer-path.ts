import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Gets the path to the bundled GStreamer installation
 * Falls back to system GStreamer if bundled version not found
 */
export function getGStreamerPath(): {
  binPath: string;
  pluginPath: string;
  libPath: string;
  env: NodeJS.ProcessEnv;
} {
  const isDev = !app.isPackaged;
  const platform = process.platform;
  const arch = process.arch;

  let gstRoot: string;
  let binPath: string;
  let pluginPath: string;
  let libPath: string;

  if (isDev) {
    // In development, look for GStreamer in project root
    // Use app.getAppPath() to get absolute path to project root
    const appPath = app.getAppPath();
    gstRoot = path.join(appPath, 'gstreamer');
  } else {
    // In production, GStreamer is bundled with the app
    gstRoot = path.join(process.resourcesPath, 'gstreamer');
  }

  if (platform === 'win32') {
    // Windows GStreamer structure - try multiple possible layouts
    const archFolder = arch === 'x64' ? 'x64' : 'x86';
    
    // Try architecture-specific folder first (standard structure)
    let testBinPath = path.join(gstRoot, archFolder, 'bin');
    let testPluginPath = path.join(gstRoot, archFolder, 'lib', 'gstreamer-1.0');
    let testLibPath = path.join(gstRoot, archFolder, 'lib');
    
    // If not found, try MSI installation structure (1.0/msvc_x86_64/bin)
    if (!fs.existsSync(path.join(testBinPath, 'gst-launch-1.0.exe'))) {
      const msiBinPath = path.join(gstRoot, archFolder, '1.0', 'msvc_x86_64', 'bin');
      if (fs.existsSync(path.join(msiBinPath, 'gst-launch-1.0.exe'))) {
        testBinPath = msiBinPath;
        testPluginPath = path.join(gstRoot, archFolder, '1.0', 'msvc_x86_64', 'lib', 'gstreamer-1.0');
        testLibPath = path.join(gstRoot, archFolder, '1.0', 'msvc_x86_64', 'lib');
      } else {
        // Try root-level bin (some extractions put files at root)
        const rootBinPath = path.join(gstRoot, 'bin');
        if (fs.existsSync(path.join(rootBinPath, 'gst-launch-1.0.exe'))) {
          testBinPath = rootBinPath;
          testPluginPath = path.join(gstRoot, 'lib', 'gstreamer-1.0');
          testLibPath = path.join(gstRoot, 'lib');
        }
      }
    }
    
    binPath = testBinPath;
    pluginPath = testPluginPath;
    libPath = testLibPath;
  } else if (platform === 'darwin') {
    // macOS GStreamer structure - try multiple possible layouts
    // Standard structure
    let testBinPath = path.join(gstRoot, 'bin');
    let testPluginPath = path.join(gstRoot, 'lib', 'gstreamer-1.0');
    let testLibPath = path.join(gstRoot, 'lib');
    
    // If not found, try Framework structure (macOS .pkg installs to Framework)
    if (!fs.existsSync(path.join(testBinPath, 'gst-launch-1.0'))) {
      // Try Framework structure
      const frameworkBinPath = path.join(gstRoot, 'GStreamer.framework', 'Versions', '1.0', 'bin');
      if (fs.existsSync(path.join(frameworkBinPath, 'gst-launch-1.0'))) {
        testBinPath = frameworkBinPath;
        testPluginPath = path.join(gstRoot, 'GStreamer.framework', 'Versions', '1.0', 'lib', 'gstreamer-1.0');
        testLibPath = path.join(gstRoot, 'GStreamer.framework', 'Versions', '1.0', 'lib');
      } else {
        // Try Versions structure (if Framework was extracted)
        const versionsBinPath = path.join(gstRoot, 'Versions', '1.0', 'bin');
        if (fs.existsSync(path.join(versionsBinPath, 'gst-launch-1.0'))) {
          testBinPath = versionsBinPath;
          testPluginPath = path.join(gstRoot, 'Versions', '1.0', 'lib', 'gstreamer-1.0');
          testLibPath = path.join(gstRoot, 'Versions', '1.0', 'lib');
        } else {
          // Try macos subdirectory (from our extraction)
          const macosBinPath = path.join(gstRoot, 'macos', 'bin');
          if (fs.existsSync(path.join(macosBinPath, 'gst-launch-1.0'))) {
            testBinPath = macosBinPath;
            testPluginPath = path.join(gstRoot, 'macos', 'lib', 'gstreamer-1.0');
            testLibPath = path.join(gstRoot, 'macos', 'lib');
          }
        }
      }
    }
    
    binPath = testBinPath;
    pluginPath = testPluginPath;
    libPath = testLibPath;
  } else {
    // Linux GStreamer structure
    binPath = path.join(gstRoot, 'bin');
    pluginPath = path.join(gstRoot, 'lib', 'gstreamer-1.0');
    libPath = path.join(gstRoot, 'lib');
  }

  // Check if bundled GStreamer exists
  const gstLaunchPath = path.join(binPath, platform === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0');
  const hasBundledGStreamer = fs.existsSync(gstLaunchPath);

  if (hasBundledGStreamer) {
    // Use bundled GStreamer
    return {
      binPath,
      pluginPath,
      libPath,
      env: {
        PATH: `${binPath}${path.delimiter}${process.env.PATH}`,
        GST_PLUGIN_PATH: pluginPath,
        GST_PLUGIN_SYSTEM_PATH: pluginPath,
        ...(platform === 'win32' && {
          // Windows-specific environment variables
          GSTREAMER_1_0_ROOT_MSVC_X86_64: gstRoot,
          GSTREAMER_1_0_ROOT_MSVC_X86: gstRoot,
        }),
      },
    };
  } else {
    // Fall back to system GStreamer - try common installation locations
    console.warn('Bundled GStreamer not found, falling back to system GStreamer');
    
    if (platform === 'win32') {
      // Try common Windows GStreamer installation locations
      const commonPaths = [
        path.join('C:', 'gstreamer', '1.0', 'msvc_x86_64', 'bin'),
        path.join('C:', 'gstreamer', arch === 'x64' ? 'x64' : 'x86', '1.0', 'msvc_x86_64', 'bin'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'gstreamer', '1.0', 'msvc_x86_64', 'bin'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'gstreamer', '1.0', 'msvc_x86_64', 'bin'),
      ];
      
      for (const testBinPath of commonPaths) {
        const testGstLaunch = path.join(testBinPath, 'gst-launch-1.0.exe');
        if (fs.existsSync(testGstLaunch)) {
          const testPluginPath = path.join(path.dirname(testBinPath), 'lib', 'gstreamer-1.0');
          const testLibPath = path.join(path.dirname(testBinPath), 'lib');
          return {
            binPath: testBinPath,
            pluginPath: testPluginPath,
            libPath: testLibPath,
            env: {
              PATH: `${testBinPath}${path.delimiter}${process.env.PATH}`,
              GST_PLUGIN_PATH: testPluginPath,
              GST_PLUGIN_SYSTEM_PATH: testPluginPath,
              GSTREAMER_1_0_ROOT_MSVC_X86_64: path.dirname(path.dirname(testBinPath)),
              GSTREAMER_1_0_ROOT_MSVC_X86: path.dirname(path.dirname(testBinPath)),
            },
          };
        }
      }
    }
    
    // No system GStreamer found - return empty paths
    return {
      binPath: '', // Will use system PATH
      pluginPath: '',
      libPath: '',
      env: {},
    };
  }
}

/**
 * Gets the full path to gst-launch-1.0 executable
 */
export function getGstLaunchPath(): string {
  const { binPath } = getGStreamerPath();
  const platform = process.platform;
  const executable = platform === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0';
  
  if (binPath) {
    const fullPath = path.join(binPath, executable);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    // Log warning if path was set but file doesn't exist
    console.warn(`GStreamer binary not found at expected path: ${fullPath}`);
  }
  
  // Fall back to system PATH
  // Note: This will fail with ENOENT if not in PATH
  return executable;
}
