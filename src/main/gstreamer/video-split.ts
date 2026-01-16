import { app } from 'electron';
import { BatchProcessConfig, ProgressCallback } from '../types/types';
import { 
  getVideoDurationWithContext, 
  processVideoFileWithContext 
} from '../../core/gstreamer/video-split';
import { RuntimeContext } from '../../core/utils/gstreamer-path';

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
 * Get video file duration in seconds using GStreamer
 */
export function getVideoDuration(inputPath: string): Promise<number> {
  return getVideoDurationWithContext(inputPath, createElectronContext());
}

/**
 * Process a video file using GStreamer
 */
export function processVideoFile(
  inputPath: string,
  outputDirectory: string,
  config: BatchProcessConfig,
  onProgress?: ProgressCallback
): Promise<void> {
  return processVideoFileWithContext(
    inputPath,
    outputDirectory,
    config,
    createElectronContext(),
    onProgress
  );
}
