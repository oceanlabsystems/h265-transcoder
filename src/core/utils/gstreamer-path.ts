import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Runtime context for GStreamer path resolution
 * Works with both Electron and CLI environments
 */
export interface RuntimeContext {
  isPackaged: boolean;
  appPath: string;       // app.getAppPath() for Electron, custom path for CLI
  resourcesPath: string; // process.resourcesPath for Electron, custom for CLI
  userDataPath?: string; // User-writable data directory for logs/config (app.getPath('userData') for Electron)
}

export interface GStreamerPaths {
  binPath: string;
  pluginPath: string;
  libPath: string;
  env: NodeJS.ProcessEnv;
}

// Cache for compatibility check results to avoid repeated tests
const compatibilityCache = new Map<string, boolean>();

/**
 * Check if bundled GStreamer can actually execute (not just exist)
 * Returns true if compatible, false if incompatible (GLIBC/library errors)
 */
function isBundledGStreamerCompatible(
  gstLaunchPath: string,
  env: NodeJS.ProcessEnv
): boolean {
  const cacheKey = gstLaunchPath;
  if (compatibilityCache.has(cacheKey)) {
    return compatibilityCache.get(cacheKey)!;
  }

  // Only check on Linux/macOS (Windows doesn't have GLIBC issues)
  if (process.platform === 'win32') {
    compatibilityCache.set(cacheKey, true);
    return true;
  }

  // Quick test: try to run gst-launch-1.0 --version
  // This will fail immediately if there are GLIBC/library issues
  try {
    // Use execSync with a short timeout - GLIBC errors happen immediately
    execSync(`"${gstLaunchPath}" --version`, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2000, // 2 second timeout
      encoding: 'utf8',
    });
    
    // If we get here, it executed successfully
    compatibilityCache.set(cacheKey, true);
    return true;
  } catch (error: any) {
    // Check stderr/stdout for GLIBC/library compatibility errors
    const errorText = ((error.stderr || '') + (error.stdout || '') + (error.message || '')).toLowerCase();
    const hasCompatibilityError =
      errorText.includes('glibc_') ||
      (errorText.includes('libc.so.6') &&
        errorText.includes('version') &&
        errorText.includes('not found')) ||
      errorText.includes('error while loading shared libraries') ||
      errorText.includes('library not loaded') ||
      errorText.includes('dyld') ||
      errorText.includes('reason: image not found') ||
      errorText.includes('mach-o');

    // If we see compatibility errors, it's incompatible
    const isCompatible = !hasCompatibilityError;
    compatibilityCache.set(cacheKey, isCompatible);
    return isCompatible;
  }
}

/**
 * Gets the path to the GStreamer installation
 * Works with both Electron and CLI environments
 */
export function getGStreamerPathWithContext(context: RuntimeContext): GStreamerPaths {
  const platform = process.platform;
  const arch = process.arch;

  let gstRoot: string;
  let binPath: string;
  let pluginPath: string;
  let libPath: string;

  if (!context.isPackaged) {
    // In development, look for GStreamer in project root
    gstRoot = path.join(context.appPath, 'gstreamer');
  } else {
    // In production, GStreamer is bundled with the app
    gstRoot = path.join(context.resourcesPath, 'gstreamer');
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
    let testBinPath = path.join(gstRoot, 'bin');
    let testPluginPath = path.join(gstRoot, 'lib', 'gstreamer-1.0');
    let testLibPath = path.join(gstRoot, 'lib');
    
    // Try linux subdirectory (from our CI extraction)
    if (!fs.existsSync(path.join(testBinPath, 'gst-launch-1.0'))) {
      const linuxBinPath = path.join(gstRoot, 'linux', 'bin');
      if (fs.existsSync(path.join(linuxBinPath, 'gst-launch-1.0'))) {
        testBinPath = linuxBinPath;
        testPluginPath = path.join(gstRoot, 'linux', 'lib', 'gstreamer-1.0');
        testLibPath = path.join(gstRoot, 'linux', 'lib');
      }
    }
    
    binPath = testBinPath;
    pluginPath = testPluginPath;
    libPath = testLibPath;
  }

  // Check if bundled GStreamer exists
  const gstLaunchPath = path.join(binPath, platform === 'win32' ? 'gst-launch-1.0.exe' : 'gst-launch-1.0');
  const hasBundledGStreamer = fs.existsSync(gstLaunchPath);

  if (hasBundledGStreamer) {
    // Prepare environment variables first (needed for compatibility check)
    const envVars: NodeJS.ProcessEnv = {
      PATH: `${binPath}${path.delimiter}${process.env.PATH}`,
      GST_PLUGIN_PATH: pluginPath,
      GST_PLUGIN_SYSTEM_PATH: pluginPath,
      // GStreamer 1.0-specific environment variables (with _1_0 suffix)
      GST_PLUGIN_PATH_1_0: pluginPath,
      GST_PLUGIN_SYSTEM_PATH_1_0: pluginPath,
    };
    
    if (platform === 'win32') {
      // Windows-specific environment variables
      envVars.GSTREAMER_1_0_ROOT_MSVC_X86_64 = gstRoot;
      envVars.GSTREAMER_1_0_ROOT_MSVC_X86 = gstRoot;
      
      // Critical: Plugin scanner path - required for gst-inspect to work
      // Try multiple possible locations for the plugin scanner
      const scannerCandidates = [
        // In bin directory (some builds put it here)
        path.join(binPath, 'gst-plugin-scanner.exe'),
        // Relative to bin - in sibling libexec directory (standard layout)
        path.join(path.dirname(binPath), 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
        // From gstRoot with arch folder (e.g., gstreamer/x64/libexec/...)
        path.join(gstRoot, arch === 'x64' ? 'x64' : 'x86', 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
        // From gstRoot directly (e.g., gstreamer/libexec/...)
        path.join(gstRoot, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
      ];
      
      for (const scannerPath of scannerCandidates) {
        if (fs.existsSync(scannerPath)) {
          envVars.GST_PLUGIN_SCANNER_1_0 = scannerPath;
          envVars.GST_PLUGIN_SCANNER = scannerPath;
          break;
        }
      }
      
      // Registry path in user's temp directory to avoid permission issues
      const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir();
      envVars.GST_REGISTRY_1_0 = path.join(tempDir, 'gstreamer-1.0', 'registry.bin');
    } else if (platform === 'linux') {
      // Linux-specific: prepend bundled library path
      // Note: The bundle intentionally does NOT include system/driver libs (libva, libdrm, 
      // libstdc++, etc.) which must come from the target system for hardware encoding to work.
      // Only GStreamer core libraries are bundled.
      envVars.LD_LIBRARY_PATH = `${libPath}${path.delimiter}${process.env.LD_LIBRARY_PATH || ''}`;
      
      // Plugin scanner for Linux
      const linuxScannerCandidates = [
        // Bundled layout (preferred): gstreamer/linux/libexec/...
        path.join(path.dirname(binPath), 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner'),
        // Alternative bundled layout: sometimes scanner lives under lib/
        path.join(libPath, 'gstreamer-1.0', 'gst-plugin-scanner'),
        path.join(gstRoot, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner'),
        // Common system locations (vary by distro)
        '/usr/libexec/gstreamer-1.0/gst-plugin-scanner',
        '/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner',
        '/usr/lib64/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner',
      ];
      for (const scannerPath of linuxScannerCandidates) {
        if (fs.existsSync(scannerPath)) {
          envVars.GST_PLUGIN_SCANNER_1_0 = scannerPath;
          envVars.GST_PLUGIN_SCANNER = scannerPath;
          break;
        }
      }
      
      // Registry path in user's home directory
      const homeDir = os.homedir();
      envVars.GST_REGISTRY_1_0 = path.join(homeDir, '.cache', 'gstreamer-1.0', 'registry.bin');
    } else if (platform === 'darwin') {
      // macOS-specific: add dylib path
      envVars.DYLD_LIBRARY_PATH = `${libPath}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ''}`;
      envVars.DYLD_FALLBACK_LIBRARY_PATH = `${libPath}${path.delimiter}${process.env.DYLD_FALLBACK_LIBRARY_PATH || ''}`;
      
      // Plugin scanner for macOS
      const macosScannerCandidates = [
        path.join(path.dirname(binPath), 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner'),
        path.join(gstRoot, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner'),
        '/Library/Frameworks/GStreamer.framework/Versions/1.0/libexec/gstreamer-1.0/gst-plugin-scanner',
      ];
      for (const scannerPath of macosScannerCandidates) {
        if (fs.existsSync(scannerPath)) {
          envVars.GST_PLUGIN_SCANNER_1_0 = scannerPath;
          envVars.GST_PLUGIN_SCANNER = scannerPath;
          break;
        }
      }
      
      // Note: Python plugin (libgstpython.dylib) should be excluded during bundling
      // to prevent timeouts. See scripts/bundle-gstreamer-macos.sh
      
      // Registry path in user's home directory
      const homeDir = os.homedir();
      envVars.GST_REGISTRY_1_0 = path.join(homeDir, 'Library', 'Caches', 'gstreamer-1.0', 'registry.bin');
    }
    
    // Check if bundled GStreamer is actually compatible (can execute)
    // On Linux/macOS, this checks for GLIBC/library compatibility issues
    // Note: Bundles should be built with Ubuntu 20.04 (GLIBC 2.31) for maximum compatibility
    const isCompatible = isBundledGStreamerCompatible(gstLaunchPath, envVars);
    
    if (!isCompatible) {
      // Bundled GStreamer exists but is incompatible (e.g., GLIBC mismatch)
      // This can happen if the bundle was built on a newer system
      // Fall back to system GStreamer as a safety measure
      console.warn(
        'Bundled GStreamer is incompatible with this system (likely GLIBC/library mismatch). ' +
        'Falling back to system GStreamer. ' +
        'To fix: rebuild the bundle using scripts/build-gstreamer-linux-bundle.sh (uses Ubuntu 20.04 for compatibility)'
      );
      
      // Continue to fallback logic below
    } else {
      // Bundled GStreamer is compatible, use it
      return {
        binPath,
        pluginPath,
        libPath,
        env: envVars,
      };
    }
  }
  
  // Fall back to system GStreamer (either not found or incompatible)
  {
    // Fall back to system GStreamer - try common installation locations
    if (!hasBundledGStreamer) {
      console.warn('Bundled GStreamer not found, falling back to system GStreamer');
    }
    
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
export function getGstLaunchPathWithContext(context: RuntimeContext): string {
  const { binPath } = getGStreamerPathWithContext(context);
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
  return executable;
}

/**
 * Create a CLI-specific path resolver
 * @param gstreamerRoot Optional custom GStreamer root path
 */
export function createCliContext(gstreamerRoot?: string): RuntimeContext {
  const root = gstreamerRoot || process.cwd();
  
  // Determine user data path based on platform
  let userDataPath: string;
  const platform = process.platform;
  const appName = 'h265-transcoder';
  const homeDir = os.homedir();
  
  if (platform === 'win32') {
    // Windows: Use %APPDATA%
    userDataPath = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
  } else if (platform === 'darwin') {
    // macOS: Use ~/Library/Application Support
    userDataPath = path.join(homeDir, 'Library', 'Application Support', appName);
  } else {
    // Linux: Use ~/.config
    userDataPath = path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), appName);
  }
  
  return {
    isPackaged: true, // CLI is always "packaged"
    appPath: root,
    resourcesPath: root,
    userDataPath,
  };
}
