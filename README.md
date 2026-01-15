# H265 Transcoder

A professional desktop application for batch processing video files into H.265 encoded chunks. Built with Electron, React, and GStreamer, this tool efficiently splits large video files (especially .MOV files) into configurable time-based segments and transcodes them to H.265 format.

## Overview

**H265 Transcoder** is designed for processing large video files, particularly those from underwater cameras or other recording devices. It automatically:

- Scans directories for video files
- Splits videos into configurable time-based chunks (default: 30 minutes)
- Transcodes to H.265 (HEVC) format for efficient storage
- Supports hardware acceleration (NVIDIA NVENC, Intel Quick Sync) and software encoding
- Provides real-time progress tracking with ETA calculations
- Processes multiple files in batch with detailed status updates

## Features

### Core Functionality

- **Batch Processing**: Process entire directories of video files automatically
- **Intelligent Chunking**: Split videos into configurable time segments (default: 30 minutes)
- **Multiple Encoders**:
  - **x265** (Software) - High quality, CPU-based encoding
  - **nvh265** (NVIDIA NVENC) - Hardware-accelerated on NVIDIA GPUs
  - **qsvh265** (Intel Quick Sync) - Hardware-accelerated on Intel GPUs
- **Output Formats**: MP4, MKV, or MOV containers
- **Progress Tracking**: Real-time progress with file-level and chunk-level metrics
- **ETA Calculation**: Accurate time estimates based on processing speed
- **Error Handling**: Robust error detection and reporting

### User Interface

- **Modern Dark Theme**: Clean, professional interface with custom styling
- **Real-time Status**: Live progress bars and status updates
- **File Management**: Easy directory selection and file scanning
- **Configuration Options**: Adjustable chunk duration, encoder, format, and quality settings
- **Responsive Design**: Works across different window sizes

### Technical Features

- **GStreamer Integration**: Bundled GStreamer for reliable video processing
- **Cross-platform**: Windows, macOS, and Linux support
- **Hardware Acceleration**: Automatic detection and use of available hardware encoders
- **Progress Monitoring**: Byte-based and time-based progress calculation
- **Incremental File Writing**: MKV format supports incremental file growth visibility

## Technology Stack

- **Framework**: Electron 31.x
- **Frontend**: React 18.x with TypeScript
- **UI Library**: Ant Design 5.x
- **Styling**: Tailwind CSS with custom CSS variables
- **Video Processing**: GStreamer 1.22.10+
- **Build Tool**: Electron Vite
- **Package Manager**: npm/yarn

## Installation

### Prerequisites

- Node.js 18+ and npm/yarn
- Git (for cloning the repository)

### Setup

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd sub-video-processor
   ```

2. **Install dependencies**:

   ```bash
   yarn
   # or
   npm install
   ```

3. **Download GStreamer** (automatic):

   ```bash
   npm run download-gstreamer
   ```

   This automatically downloads and extracts GStreamer binaries for your platform. The script runs automatically before building, but you can run it manually for development.

   For manual setup instructions, see [docs/GSTREAMER_SETUP.md](docs/GSTREAMER_SETUP.md).

## Development

### Running in Development Mode

```bash
yarn dev
```

This starts the Electron app in development mode with hot module replacement (HMR) enabled.

### Type Checking

```bash
# Check both Node and Web TypeScript
yarn typecheck

# Check only Node code
yarn typecheck:node

# Check only Web code
yarn typecheck:web
```

### Linting and Formatting

```bash
# Format code
yarn format

# Lint and auto-fix
yarn lint
```

## Building

### Development Build

```bash
# Build without packaging
yarn build
```

### Production Builds

Build for specific platforms:

```bash
# Windows (x64 and ia32)
yarn build:win

# Windows 64-bit only
yarn build:win64

# Windows 32-bit only
yarn build:win32

# macOS
yarn build:mac

# Linux
yarn build:linux
```

**Note**: GStreamer is automatically included in the build. Ensure you've run `npm run download-gstreamer` before building.

### Build Output

Built applications are output to the `dist/` directory:

- **Windows**: NSIS installer (`.exe`)
- **macOS**: DMG package
- **Linux**: AppImage and DEB packages

## Usage

### Basic Workflow

1. **Select Input Directory**: Click "Select Input Directory" and choose the folder containing your video files
2. **Select Output Directory**: Choose where processed chunks should be saved
3. **Configure Settings**:
   - **Chunk Duration**: Set the length of each output chunk (default: 30 minutes)
   - **Output Format**: Choose MP4, MKV, or MOV
   - **Encoder**: Select x265 (Software), nvh265 (NVIDIA), or qsvh265 (Intel)
   - **Speed Preset**: For x265 encoder, choose encoding speed vs quality tradeoff
4. **Start Processing**: Click "Start Processing" to begin batch processing

### Configuration Options

#### Chunk Duration

- Range: 1-60 minutes
- Default: 30 minutes
- Videos are split at this interval

#### Output Format

- **MP4**: Widely compatible, buffers until completion (files appear after chunk is done)
- **MKV**: Supports incremental writing (files grow as they're processed)
- **MOV**: QuickTime format, buffers until completion

#### Encoders

##### x265 (Software)

- Works on all systems
- High quality output
- Configurable speed presets: ultrafast, veryfast, faster, fast, medium, slow, slower, veryslow
- Slower than hardware encoders but more compatible

##### nvh265 (NVIDIA NVENC)

- Requires NVIDIA GPU with NVENC support
- Fast encoding (typically 0.5x-1.0x realtime)
- Best performance for NVIDIA GPU users
- Automatically falls back to x265 if unavailable

##### qsvh265 (Intel Quick Sync)

- Requires Intel CPU with integrated graphics
- Fast encoding (typically 0.25x-0.4x realtime)
- Good for systems with Intel integrated graphics
- Automatically falls back to x265 if unavailable

### Progress Tracking

The application provides detailed progress information:

- **File Progress**: Overall progress for the current file (0-100%)
- **Chunk Progress**: Progress within the current chunk (0-100%)
- **Processing Speed**: Encoding speed relative to video duration (e.g., 0.5x = half realtime)
- **ETA**: Estimated time remaining for current chunk, current file, and overall batch
- **File Information**: Current file name, chunk number, and total chunks

### Output Files

Processed files are named using the pattern:

```text
{original-filename}_01.{format}
{original-filename}_02.{format}
...
```

For example, `VIDEO001.MOV` becomes:

- `VIDEO001_01.mp4`
- `VIDEO001_02.mp4`
- `VIDEO001_03.mp4`
- etc.

## Architecture

### Project Structure

```text
sub-video-processor/
├── src/
│   ├── main/              # Electron main process
│   │   ├── gstreamer/     # GStreamer pipeline implementations
│   │   │   ├── video-split.ts    # Main video splitting logic
│   │   │   ├── video-encode.ts   # Encoding utilities
│   │   │   └── ...
│   │   ├── types/         # TypeScript type definitions
│   │   ├── utils/         # Utility functions
│   │   └── index.ts       # Main process entry point
│   ├── preload/           # Preload scripts (IPC bridge)
│   └── renderer/          # React frontend
│       └── src/
│           ├── App.tsx    # Main application component
│           └── ...
├── gstreamer/             # Bundled GStreamer binaries
├── resources/             # App icons and resources
├── scripts/              # Build and utility scripts
└── docs/                 # Documentation
```

### Key Components

**Main Process** (`src/main/index.ts`)

- Manages Electron window lifecycle
- Handles IPC communication
- Coordinates video processing
- Manages file system operations

**Video Processing** (`src/main/gstreamer/video-split.ts`)

- GStreamer pipeline construction
- Progress tracking and ETA calculation
- Chunk file management
- Error handling and recovery

**Renderer Process** (`src/renderer/src/App.tsx`)

- React-based UI
- User interaction handling
- Progress display
- Configuration management

**Preload Script** (`src/preload/index.ts`)

- Secure IPC bridge between renderer and main process
- Exposes safe API to frontend

## GStreamer Integration

This application bundles GStreamer to avoid requiring users to install third-party dependencies. The bundled GStreamer is automatically:

- Downloaded during build preparation
- Extracted to the `gstreamer/` directory
- Included in the final application package
- Configured with proper environment variables at runtime

For detailed GStreamer setup information, see [docs/GSTREAMER_SETUP.md](docs/GSTREAMER_SETUP.md).

### GStreamer Pipeline

The application uses GStreamer pipelines for video processing:

```text
uridecodebin → videoconvert → [encoder] → h265parse → splitmuxsink
```

- **uridecodebin**: Automatically handles demuxing and decoding of various formats
- **videoconvert**: Converts to encoder-compatible format (NV12 for hardware, I420 for software)
- **encoder**: x265enc, nvh265enc, or qsvh265enc
- **h265parse**: Parses H.265 stream
- **splitmuxsink**: Splits output into time-based chunks

## CI/CD and Releases

This project uses GitHub Actions for automated builds and releases. See [docs/CI_CD.md](docs/CI_CD.md) for detailed information.

### Creating a Release

```bash
# Patch release (1.0.0 -> 1.0.1)
npm run release-patch

# Minor release (1.0.0 -> 1.1.0)
npm run release-minor

# Major release (1.0.0 -> 2.0.0)
npm run release-major
```

This automatically:

- Updates version numbers
- Generates changelog
- Creates git tags
- Triggers GitHub Actions to build for Windows, macOS, and Linux
- Creates a GitHub Release with downloadable installers

## Troubleshooting

### GStreamer Not Found

**Error**: `GStreamer executable not found`

**Solutions**:

1. Run `npm run download-gstreamer` to download GStreamer
2. Verify `gstreamer/{arch}/bin/gst-launch-1.0.exe` exists
3. Check the file structure matches expected layout
4. See [docs/GSTREAMER_SETUP.md](docs/GSTREAMER_SETUP.md) for manual setup

### Encoder Not Available

**Error**: `Access violation` or encoder-specific errors

**Solutions**:

- **nvh265**: Ensure NVIDIA GPU drivers are installed and up to date
- **qsvh265**: Ensure Intel GPU drivers are installed; may not be available in all GStreamer builds
- **Fallback**: Use x265 (Software) encoder which works on all systems

### Progress Stuck at 0%

**Cause**: MP4/MOV formats buffer until completion, so files don't appear until chunks are finished

**Solutions**:

- Use MKV format for incremental file growth visibility
- Wait for processing to complete (progress is time-based for buffering formats)
- Check console logs for actual processing status

### Large File Processing

**Issue**: Very large files (>10GB) may have incorrect duration detection

**Solutions**:

- The application automatically estimates duration from file size if detection fails
- Processing will continue with estimated duration
- Check console logs for duration estimation warnings

### Build Issues

**Issue**: Build fails or GStreamer not included

**Solutions**:

1. Ensure `npm run download-gstreamer` completed successfully
2. Check `gstreamer/` directory exists with proper structure
3. Verify `prebuild` script runs before build
4. Check build logs for specific errors

## Development Guidelines

### Code Style

- TypeScript strict mode enabled
- ESLint and Prettier configured
- Follow existing code patterns
- Use conventional commits (see `package.json` for commitizen config)

### Adding Features

1. **Main Process**: Add IPC handlers in `src/main/index.ts`
2. **Preload**: Expose safe API in `src/preload/index.ts`
3. **Renderer**: Use exposed API in React components
4. **Types**: Define types in `src/main/types/types.ts`

### Testing

- Manual testing recommended for video processing
- Test with various file formats and sizes
- Verify hardware encoder availability on target systems
- Test error handling and recovery

## License

Proprietary - © Online Systems

## Support

For issues, questions, or contributions, please refer to the project repository or contact the development team.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/)
- [ESLint Extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier Extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

---

**Version**: 1.0.0  
**Author**: Oceanlab Systems  
**Homepage**: <https://www.oceanlabsystems.com>
