import { app } from 'electron';
import { 
  getGStreamerPathWithContext, 
  getGstLaunchPathWithContext,
  GStreamerPaths,
  RuntimeContext 
} from '../../core/utils/gstreamer-path';

/**
 * Create Electron-specific runtime context
 */
function createElectronContext(): RuntimeContext {
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  };
}

/**
 * Gets the path to the bundled GStreamer installation
 * Falls back to system GStreamer if bundled version not found
 */
export function getGStreamerPath(): GStreamerPaths {
  return getGStreamerPathWithContext(createElectronContext());
}

/**
 * Gets the full path to gst-launch-1.0 executable
 */
export function getGstLaunchPath(): string {
  return getGstLaunchPathWithContext(createElectronContext());
}
