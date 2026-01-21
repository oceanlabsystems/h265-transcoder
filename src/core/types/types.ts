export interface StreamConfig {
  deviceNumber: number;
  bitrate: number;
  targetHost: string;
  port: number;
  useNvenc: boolean;
}

export interface BatchProcessConfig {
  inputDirectory: string;
  outputDirectory: string;
  chunkDurationMinutes: number;
  outputFormat: 'mp4' | 'mkv' | 'mov';
  encoder: 'x265' | 'nvh265' | 'qsvh265' | 'vtenc' | 'vaapih265' | 'msdkh265';
  compressionRatio?: number; // Target compression ratio (1, 2, 3, 4, 5, 10, 20). 2x = half the size (recommended)
  speedPreset?: 'ultrafast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
}

export interface ProcessStatus {
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  currentChunk: number;
  totalChunks: number;
  fileProgress: number; // 0-100 for current file
  chunkProgress: number; // 0-100 for current chunk
  overallProgress: number; // 0-100 overall
  status: 'idle' | 'processing' | 'completed' | 'error';
  error?: string;
  eta?: number; // Estimated seconds remaining (overall)
  chunkEta?: number; // Estimated seconds remaining for current chunk
  fileEta?: number; // Estimated seconds remaining for current file
  fileDuration?: number; // Duration of current file in seconds
  processingSpeed?: number; // Processing speed (e.g., 1.5x realtime)
  processedBytes?: number; // Total bytes processed so far
  totalBytes?: number; // Total bytes to process
  throughputBps?: number; // Current throughput in bytes per second
  durationIsEstimated?: boolean; // True when file duration was estimated due to corrupt metadata
}

export interface ProgressCallback {
  (status: {
    fileProgress: number;
    chunkProgress: number;
    currentChunk: number;
    totalChunks: number;
    eta?: number;
    chunkEta?: number;
    fileEta?: number;
    processingSpeed?: number;
    currentPositionSeconds?: number; // Current position in input stream (from GStreamer)
    fileDuration?: number; // Total duration of input file in seconds
    outputBytes?: number; // Total output bytes written so far (for reference)
    durationIsEstimated?: boolean; // True when duration was estimated due to corrupt metadata
  }): void;
}

// CLI-specific types
export interface WatchConfig extends BatchProcessConfig {
  watchMode: boolean;
  processedDirectory?: string;  // Move originals here after success
  failedDirectory?: string;     // Move failed files here
  concurrency?: number;         // Number of files to process simultaneously
}

export interface QueuedFile {
  path: string;
  name: string;
  relativePath?: string;
  size: number;
  addedAt: Date;
  attempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}
