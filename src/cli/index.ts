#!/usr/bin/env node
import { Command } from 'commander';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ProcessingQueue } from './queue';
import { createCliContext, RuntimeContext } from '../core/utils/gstreamer-path';
import { WatchConfig } from '../core/types/types';

// Supported video file extensions
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.m2v', '.ts', '.mts', '.m2ts', '.vob',
  '.3gp', '.3g2', '.f4v', '.ogv', '.divx', '.asf',
]);

function isVideoFile(filePath: string): boolean {
  const filename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  
  // Exclude TypeScript definition files (.d.ts)
  if (filename.endsWith('.d.ts')) {
    return false;
  }
  
  // Exclude paths containing common code directories
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
  const excludedDirs = [
    '/node_modules/',
    '/.git/',
    '/dist/',
    '/build/',
    '/out/',
    '/.next/',
    '/.nuxt/',
    '/vendor/',
    '/__pycache__/',
    '/.venv/',
    '/venv/',
  ];
  
  if (excludedDirs.some(dir => normalizedPath.includes(dir))) {
    return false;
  }
  
  return VIDEO_EXTENSIONS.has(ext);
}

function scanDirectoryRecursive(
  dirPath: string,
  baseDir: string = dirPath
): Array<{ name: string; path: string; relativePath: string }> {
  const results: Array<{ name: string; path: string; relativePath: string }> = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        results.push(...scanDirectoryRecursive(fullPath, baseDir));
      } else if (entry.isFile() && isVideoFile(fullPath)) {
        const relativePath = path.relative(baseDir, fullPath);
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath,
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return results;
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface CliConfig {
  input: string;
  output: string;
  encoder: 'x265' | 'nvh265' | 'qsvh265';
  chunkDuration: string;
  format: 'mp4' | 'mkv' | 'mov';
  bitrate?: string;
  speedPreset?: string;
  watch: boolean;
  processedDir?: string;
  failedDir?: string;
  gstreamerPath?: string;
  concurrency: string;
  logLevel: string;
  config?: string;
}

const program = new Command();

program
  .name('h265-transcoder-cli')
  .description('H.265 video transcoder service - batch process and watch directories')
  .version('1.0.0')
  .option('-i, --input <dir>', 'Input directory to process/monitor')
  .option('-o, --output <dir>', 'Output directory for processed files')
  .option('-c, --config <file>', 'Path to YAML config file')
  .option('-w, --watch', 'Continuous monitoring mode (watch for new files)', false)
  .option('--encoder <type>', 'Encoder: x265, nvh265, qsvh265', 'x265')
  .option('--chunk-duration <minutes>', 'Chunk duration in minutes', '60')
  .option('--format <type>', 'Output format: mp4, mkv, mov', 'mkv')
  .option('--bitrate <kbps>', 'Target bitrate in kbps (optional)')
  .option('--speed-preset <preset>', 'Speed preset for x265: ultrafast, veryfast, faster, fast, medium, slow, slower, veryslow', 'medium')
  .option('--processed-dir <dir>', 'Move original files here after successful processing')
  .option('--failed-dir <dir>', 'Move failed files here')
  .option('--gstreamer-path <dir>', 'Path to GStreamer installation')
  .option('--concurrency <num>', 'Number of files to process simultaneously', '1')
  .option('--log-level <level>', 'Log level: debug, info, warn, error', 'info');

program.parse();

async function main() {
  const opts = program.opts<CliConfig>();

  // Load config file if specified
  let config: Partial<CliConfig> = {};
  if (opts.config && fs.existsSync(opts.config)) {
    try {
      const fileContents = fs.readFileSync(opts.config, 'utf-8');
      const fileConfig = yaml.parse(fileContents);
      config = {
        input: fileConfig.input || fileConfig.inputDirectory,
        output: fileConfig.output || fileConfig.outputDirectory,
        encoder: fileConfig.encoder,
        chunkDuration: String(fileConfig.chunkDuration || fileConfig.chunkDurationMinutes || 60),
        format: fileConfig.format || fileConfig.outputFormat,
        bitrate: fileConfig.bitrate ? String(fileConfig.bitrate) : undefined,
        speedPreset: fileConfig.speedPreset,
        watch: fileConfig.watch,
        processedDir: fileConfig.processedDir || fileConfig.processedDirectory,
        failedDir: fileConfig.failedDir || fileConfig.failedDirectory,
        gstreamerPath: fileConfig.gstreamerPath,
        concurrency: fileConfig.concurrency ? String(fileConfig.concurrency) : undefined,
        logLevel: fileConfig.logLevel,
      };
      console.log(`[Config] Loaded configuration from ${opts.config}`);
    } catch (error) {
      console.error(`[Config] Error loading config file: ${error}`);
      process.exit(1);
    }
  }

  // Merge with command line options (CLI takes precedence)
  const finalConfig: CliConfig = {
    input: opts.input || config.input || '',
    output: opts.output || config.output || '',
    encoder: opts.encoder || config.encoder || 'x265',
    chunkDuration: opts.chunkDuration || config.chunkDuration || '60',
    format: opts.format || config.format || 'mkv',
    bitrate: opts.bitrate || config.bitrate,
    speedPreset: opts.speedPreset || config.speedPreset || 'medium',
    watch: opts.watch || config.watch || false,
    processedDir: opts.processedDir || config.processedDir,
    failedDir: opts.failedDir || config.failedDir,
    gstreamerPath: opts.gstreamerPath || config.gstreamerPath,
    concurrency: opts.concurrency || config.concurrency || '1',
    logLevel: opts.logLevel || config.logLevel || 'info',
  };

  // Validate required options
  if (!finalConfig.input) {
    console.error('Error: --input directory is required');
    program.help();
    process.exit(1);
  }

  if (!finalConfig.output) {
    console.error('Error: --output directory is required');
    program.help();
    process.exit(1);
  }

  // Validate input directory exists
  if (!fs.existsSync(finalConfig.input)) {
    console.error(`Error: Input directory does not exist: ${finalConfig.input}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(finalConfig.output)) {
    fs.mkdirSync(finalConfig.output, { recursive: true });
    console.log(`[Setup] Created output directory: ${finalConfig.output}`);
  }

  // Create processed/failed directories if specified
  if (finalConfig.processedDir && !fs.existsSync(finalConfig.processedDir)) {
    fs.mkdirSync(finalConfig.processedDir, { recursive: true });
  }
  if (finalConfig.failedDir && !fs.existsSync(finalConfig.failedDir)) {
    fs.mkdirSync(finalConfig.failedDir, { recursive: true });
  }

  // Initialize GStreamer path resolver
  const context: RuntimeContext = createCliContext(finalConfig.gstreamerPath);

  // Create watch config
  const watchConfig: WatchConfig = {
    inputDirectory: path.resolve(finalConfig.input),
    outputDirectory: path.resolve(finalConfig.output),
    chunkDurationMinutes: parseInt(finalConfig.chunkDuration, 10),
    outputFormat: finalConfig.format as 'mp4' | 'mkv' | 'mov',
    encoder: finalConfig.encoder as 'x265' | 'nvh265' | 'qsvh265',
    bitrate: finalConfig.bitrate ? parseInt(finalConfig.bitrate, 10) : undefined,
    speedPreset: finalConfig.speedPreset as any,
    watchMode: finalConfig.watch,
    processedDirectory: finalConfig.processedDir ? path.resolve(finalConfig.processedDir) : undefined,
    failedDirectory: finalConfig.failedDir ? path.resolve(finalConfig.failedDir) : undefined,
    concurrency: parseInt(finalConfig.concurrency, 10),
  };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              H265 Transcoder CLI Service                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Input:       ${watchConfig.inputDirectory}`);
  console.log(`  Output:      ${watchConfig.outputDirectory}`);
  console.log(`  Encoder:     ${watchConfig.encoder}`);
  console.log(`  Format:      ${watchConfig.outputFormat}`);
  console.log(`  Chunk:       ${watchConfig.chunkDurationMinutes} minutes`);
  console.log(`  Concurrency: ${watchConfig.concurrency}`);
  console.log(`  Watch Mode:  ${watchConfig.watchMode ? 'Enabled' : 'Disabled'}`);
  if (watchConfig.processedDirectory) {
    console.log(`  Processed:   ${watchConfig.processedDirectory}`);
  }
  if (watchConfig.failedDirectory) {
    console.log(`  Failed:      ${watchConfig.failedDirectory}`);
  }
  console.log('');

  // Track statistics
  let filesProcessed = 0;
  let filesFailed = 0;
  let bytesProcessed = 0;
  const startTime = Date.now();

  // Create processing queue
  const queue = new ProcessingQueue({
    config: watchConfig,
    context,
    onFileStart: (file) => {
      console.log(`\n[Processing] Starting: ${file.name} (${formatBytes(file.size)})`);
    },
    onFileComplete: (file) => {
      filesProcessed++;
      bytesProcessed += file.size;
      console.log(`[Complete] ${file.name}`);
      printStats();
    },
    onFileFailed: (file, error) => {
      filesFailed++;
      console.error(`[Failed] ${file.name}: ${error.message}`);
      printStats();
    },
    onProgress: (file, progress) => {
      const eta = progress.fileEta !== undefined ? formatTime(progress.fileEta) : '--:--';
      const speed = progress.processingSpeed ? `${progress.processingSpeed.toFixed(2)}x` : 'N/A';
      process.stdout.write(
        `\r[${file.name}] ${progress.fileProgress}% | Chunk ${progress.currentChunk}/${progress.totalChunks} | ETA: ${eta} | Speed: ${speed}    `
      );
    },
    onQueueEmpty: () => {
      if (!watchConfig.watchMode) {
        console.log('\n\n[Complete] All files processed');
        printStats();
      }
    },
  });

  function printStats() {
    const elapsed = (Date.now() - startTime) / 1000;
    const status = queue.getStatus();
    console.log(`\n  Stats: ${filesProcessed} processed, ${filesFailed} failed, ${status.pending} pending`);
    console.log(`  Total: ${formatBytes(bytesProcessed)} in ${formatTime(elapsed)}`);
  }

  if (watchConfig.watchMode) {
    // Watch mode - continuous monitoring
    console.log(`[Watch] Monitoring ${watchConfig.inputDirectory} for new video files...`);
    console.log('[Watch] Press Ctrl+C to stop\n');

    const watcher = chokidar.watch(watchConfig.inputDirectory, {
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2 seconds after last change
        pollInterval: 100,
      },
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        '**/*.part',      // Ignore partial downloads
        '**/*.tmp',       // Ignore temp files
        '**/*.crdownload', // Chrome downloads
        '**/node_modules/**', // Ignore node_modules
        '**/dist/**',     // Ignore dist directories
        '**/build/**',    // Ignore build directories
        '**/out/**',      // Ignore out directories
        '**/.git/**',     // Ignore git directories
        '**/*.d.ts',      // Ignore TypeScript definition files
      ],
    });

    watcher
      .on('add', (filePath) => {
        if (isVideoFile(filePath)) {
          console.log(`\n[Watch] New file detected: ${path.basename(filePath)}`);
          queue.addFile(filePath);
        }
      })
      .on('error', (error) => {
        console.error('[Watch] Error:', error);
      });

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n\n[Shutdown] Received shutdown signal...');
      watcher.close();
      await queue.shutdown();
      printStats();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process running
    process.stdin.resume();
  } else {
    // One-shot mode - process existing files and exit
    const files = scanDirectoryRecursive(watchConfig.inputDirectory);
    
    if (files.length === 0) {
      console.log('[Info] No video files found in input directory');
      process.exit(0);
    }

    console.log(`[Info] Found ${files.length} video file(s) to process\n`);

    // Add all files to queue
    for (const file of files) {
      await queue.addFile(file.path);
    }

    // Wait for completion
    await queue.waitForCompletion();
    
    console.log('\n');
    printStats();
    process.exit(filesFailed > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
