import * as path from 'path';
import * as fs from 'fs';
import { QueuedFile, WatchConfig, ProgressCallback } from '../core/types/types';
import { processVideoFileWithContext } from '../core/gstreamer/video-split';
import { RuntimeContext } from '../core/utils/gstreamer-path';

export interface QueueOptions {
  config: WatchConfig;
  context: RuntimeContext;
  onFileStart?: (file: QueuedFile) => void;
  onFileComplete?: (file: QueuedFile) => void;
  onFileFailed?: (file: QueuedFile, error: Error) => void;
  onProgress?: (file: QueuedFile, progress: Parameters<ProgressCallback>[0]) => void;
  onQueueEmpty?: () => void;
}

export class ProcessingQueue {
  private queue: QueuedFile[] = [];
  private processing = new Set<string>();
  private config: WatchConfig;
  private context: RuntimeContext;
  private maxConcurrency: number;
  private maxRetries = 3;
  private options: QueueOptions;
  private shuttingDown = false;

  constructor(options: QueueOptions) {
    this.options = options;
    this.config = options.config;
    this.context = options.context;
    this.maxConcurrency = options.config.concurrency || 1;
  }

  /**
   * Add a file to the processing queue
   */
  async addFile(filePath: string): Promise<void> {
    // Dedupe - don't add if already in queue or processing
    if (this.queue.some(f => f.path === filePath)) {
      console.log(`[Queue] File already in queue: ${path.basename(filePath)}`);
      return;
    }
    if (this.processing.has(filePath)) {
      console.log(`[Queue] File already processing: ${path.basename(filePath)}`);
      return;
    }

    // Get file info
    let size = 0;
    try {
      const stats = fs.statSync(filePath);
      size = stats.size;
    } catch (e) {
      console.error(`[Queue] Could not stat file: ${filePath}`);
      return;
    }

    const queuedFile: QueuedFile = {
      path: filePath,
      name: path.basename(filePath),
      relativePath: path.relative(this.config.inputDirectory, filePath),
      size,
      addedAt: new Date(),
      attempts: 0,
      status: 'pending',
    };

    this.queue.push(queuedFile);
    console.log(`[Queue] Added: ${queuedFile.name} (${this.queue.length} in queue)`);

    // Start processing
    this.processNext();
  }

  /**
   * Get current queue status
   */
  getStatus(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const pending = this.queue.filter(f => f.status === 'pending').length;
    const processing = this.processing.size;
    const completed = this.queue.filter(f => f.status === 'completed').length;
    const failed = this.queue.filter(f => f.status === 'failed').length;
    
    return {
      pending,
      processing,
      completed,
      failed,
      total: this.queue.length,
    };
  }

  /**
   * Process the next file in the queue
   */
  private async processNext(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.processing.size >= this.maxConcurrency) return;

    const next = this.queue.find(f => f.status === 'pending');
    if (!next) {
      if (this.processing.size === 0) {
        this.options.onQueueEmpty?.();
      }
      return;
    }

    next.status = 'processing';
    this.processing.add(next.path);
    next.attempts++;

    console.log(`[Queue] Processing: ${next.name} (attempt ${next.attempts}/${this.maxRetries})`);
    this.options.onFileStart?.(next);

    try {
      // Calculate output directory, preserving subdirectory structure
      let outputDir = this.config.outputDirectory;
      if (next.relativePath && next.relativePath !== next.name) {
        // File is in a subdirectory - preserve structure
        const subDir = path.dirname(next.relativePath);
        outputDir = path.join(this.config.outputDirectory, subDir);
      }

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      await processVideoFileWithContext(
        next.path,
        outputDir,
        this.config,
        this.context,
        (progress) => {
          this.options.onProgress?.(next, progress);
        }
      );

      next.status = 'completed';
      console.log(`[Queue] Completed: ${next.name}`);
      this.options.onFileComplete?.(next);

      // Move original to processed directory if configured
      if (this.config.processedDirectory) {
        await this.moveFile(next.path, this.config.processedDirectory, next.relativePath);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      next.error = err.message;

      if (next.attempts < this.maxRetries) {
        console.warn(`[Queue] Failed (will retry): ${next.name} - ${err.message}`);
        next.status = 'pending'; // Retry
      } else {
        next.status = 'failed';
        console.error(`[Queue] Failed permanently: ${next.name} - ${err.message}`);
        this.options.onFileFailed?.(next, err);

        // Move to failed directory if configured
        if (this.config.failedDirectory) {
          await this.moveFile(next.path, this.config.failedDirectory, next.relativePath);
        }
      }
    } finally {
      this.processing.delete(next.path);
      this.processNext();
    }
  }

  /**
   * Move a file to a target directory, preserving relative path structure
   */
  private async moveFile(sourcePath: string, targetDir: string, relativePath?: string): Promise<void> {
    try {
      let destPath: string;
      if (relativePath) {
        destPath = path.join(targetDir, relativePath);
      } else {
        destPath = path.join(targetDir, path.basename(sourcePath));
      }

      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Move file
      fs.renameSync(sourcePath, destPath);
      console.log(`[Queue] Moved: ${path.basename(sourcePath)} -> ${destPath}`);
    } catch (error) {
      console.error(`[Queue] Failed to move file: ${error}`);
    }
  }

  /**
   * Wait for all pending files to complete
   */
  async waitForCompletion(): Promise<void> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        const pending = this.queue.filter(f => f.status === 'pending').length;
        if (pending === 0 && this.processing.size === 0) {
          resolve();
        } else {
          setTimeout(checkComplete, 1000);
        }
      };
      checkComplete();
    });
  }

  /**
   * Gracefully shutdown the queue
   */
  async shutdown(): Promise<void> {
    console.log('[Queue] Shutting down...');
    this.shuttingDown = true;
    
    // Wait for current processing to complete
    while (this.processing.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[Queue] Shutdown complete');
  }
}
