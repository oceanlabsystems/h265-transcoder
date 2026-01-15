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
  encoder: 'x265' | 'nvh265' | 'qsvh265';
  bitrate?: number;
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
}