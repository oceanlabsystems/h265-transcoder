# H265 Transcoder

A professional video transcoding solution with both a desktop GUI application and a headless CLI service. Built with Electron, React, and GStreamer, this tool efficiently splits large video files into configurable time-based segments and transcodes them to H.265 format.

## Overview

**H265 Transcoder** is designed for processing large video files, particularly those from underwater cameras or other recording devices. It offers two modes of operation:

- **GUI Application** - Desktop app for manual batch processing with visual progress tracking
- **CLI Service** - Headless service for automated directory monitoring and processing

### Key Features

- 🎬 Batch process entire directories of video files
- ✂️ Split videos into configurable time-based chunks
- 🚀 Hardware acceleration (NVIDIA NVENC, Intel Quick Sync) or software encoding
- 👁️ **Watch Mode** - Monitor directories for new files and process automatically
- 🐳 **Docker Support** - Easy deployment on Linux servers
- ⚡ Real-time progress tracking with ETA calculations
- 🔄 Auto-restart on failure when running as a service

## Installation

### Desktop Application (Windows/macOS/Linux)

Download the latest installer from [Releases](https://github.com/oceanlabsystems/h265-transcoder/releases):

| Platform | Download                          |
| -------- | --------------------------------- |
| Windows  | `h265-transcoder-X.X.X-setup.exe` |
| macOS    | `h265-transcoder-X.X.X.dmg`       |
| Linux    | `h265-transcoder-X.X.X.AppImage`  |

The installer includes both the GUI application and CLI service tools.

### Docker (Headless Linux Servers)

The recommended way to run on headless servers:

```bash
# Create directories
mkdir -p h265-transcoder/{input,output,config}
cd h265-transcoder

# Create configuration
cat > config/config.yaml << 'EOF'
input: /input
output: /output
encoder: x265
format: mkv
chunkDurationMinutes: 60
watch: true
concurrency: 1
EOF

# Run with Docker
docker run -d \
  --name h265-transcoder \
  --restart unless-stopped \
  -v $(pwd)/input:/input:ro \
  -v $(pwd)/output:/output \
  -v $(pwd)/config:/config \
  oceanlabsystems/h265-transcoder:latest
```

Or use Docker Compose:

```bash
curl -O https://raw.githubusercontent.com/oceanlabsystems/h265-transcoder/main/docker-compose.yml
# Edit docker-compose.yml to set your paths
docker-compose up -d
```

### One-Line Install (Linux)

For direct installation on Linux servers:

```bash
curl -fsSL https://raw.githubusercontent.com/oceanlabsystems/h265-transcoder/main/scripts/install-linux.sh | sudo bash
```

## Usage

### GUI Application

1. **Select Input Directory** - Choose folder containing video files
2. **Select Output Directory** - Choose destination for processed files
3. **Configure Settings**:
   - **Chunk Duration**: Length of each output segment (1-120 minutes)
   - **Output Format**: MP4, MKV, or MOV
   - **Encoder**: x265 (CPU), NVIDIA NVENC, or Intel Quick Sync
   - **Speed Preset**: Encoding speed vs quality tradeoff (x265 only)
4. **Start Processing** - Click "Start Batch" for one-time processing

#### Watch Mode (GUI)

Click **"Watch Mode"** to continuously monitor the input directory:

- New files are automatically detected and queued
- Processing continues until you stop watch mode
- Status shows processed/queued/failed counts

### CLI Service

#### Basic Commands

```bash
# One-time batch processing
h265-transcoder-cli --input /videos/in --output /videos/out

# Watch mode (continuous monitoring)
h265-transcoder-cli --input /videos/in --output /videos/out --watch

# With configuration file
h265-transcoder-cli --config /etc/h265-transcoder/config.yaml --watch

# Full options
h265-transcoder-cli \
  --input /videos/in \
  --output /videos/out \
  --encoder x265 \
  --format mkv \
  --chunk-duration 60 \
  --speed-preset medium \
  --watch \
  --processed-dir /videos/done \
  --failed-dir /videos/failed
```

#### Configuration File

```yaml
# /etc/h265-transcoder/config.yaml
input: /mnt/videos/input
output: /mnt/videos/output
encoder: x265 # x265, nvh265, qsvh265
format: mkv # mp4, mkv, mov
chunkDurationMinutes: 60
speedPreset: medium # ultrafast to veryslow
watch: true
processedDir: /mnt/videos/processed # Optional
failedDir: /mnt/videos/failed # Optional
concurrency: 1
```

#### Running as a Service

**Linux (systemd):**

```bash
sudo systemctl enable h265-transcoder
sudo systemctl start h265-transcoder
sudo journalctl -u h265-transcoder -f  # View logs
```

**Windows:**
Use the Start Menu shortcuts or run as Administrator:

```powershell
# Install service
.\service\install-service.ps1

# Manage service
Start-Service H265TranscoderService
Stop-Service H265TranscoderService
```

## Encoders

| Encoder     | Type             | Speed     | Compatibility |
| ----------- | ---------------- | --------- | ------------- |
| **x265**    | Software (CPU)   | 0.1-0.3x  | All systems   |
| **nvh265**  | NVIDIA NVENC     | 0.5-1.0x  | NVIDIA GPUs   |
| **qsvh265** | Intel Quick Sync | 0.25-0.4x | Intel GPUs    |

Speed is relative to video duration (1.0x = realtime).

## Output Files

Files are named with sequential chunk numbers:

```
VIDEO001.MOV → VIDEO001_01.mkv, VIDEO001_02.mkv, VIDEO001_03.mkv, ...
```

## Docker Configuration

### Environment Variables

| Variable      | Description         | Default               |
| ------------- | ------------------- | --------------------- |
| `CONFIG_PATH` | Path to config file | `/config/config.yaml` |
| `NODE_ENV`    | Node environment    | `production`          |

### Volumes

| Path         | Description                                |
| ------------ | ------------------------------------------ |
| `/input`     | Source video files (read-only recommended) |
| `/output`    | Processed output files                     |
| `/config`    | Configuration file                         |
| `/processed` | Optional: move originals after success     |
| `/failed`    | Optional: move failed files                |

### Docker Compose Example

```yaml
version: "3.8"
services:
  h265-transcoder:
    image: oceanlabsystems/h265-transcoder:latest
    container_name: h265-transcoder
    restart: unless-stopped
    volumes:
      - /mnt/nas/incoming:/input:ro
      - /mnt/nas/transcoded:/output
      - ./config:/config
    environment:
      - NODE_ENV=production
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
git clone https://github.com/oceanlabsystems/h265-transcoder.git
cd h265-transcoder
npm install
npm run download-gstreamer
```

### Development Commands

```bash
# Run GUI in development mode
npm run dev

# Build CLI only
npm run cli:build

# Run CLI in development
npm run cli:dev -- --input ./test/in --output ./test/out

# Build for production
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux

# Build Docker image
npm run docker:build
```

### Project Structure

```
h265-transcoder/
├── src/
│   ├── main/              # Electron main process
│   │   ├── gstreamer/     # Video processing wrapper
│   │   ├── types/         # TypeScript types
│   │   └── utils/         # Utilities
│   ├── preload/           # IPC bridge
│   ├── renderer/          # React GUI
│   └── core/              # Shared code (CLI + Electron)
│       ├── gstreamer/     # Core video processing
│       ├── types/         # Shared types
│       └── utils/         # Shared utilities
├── cli/                   # CLI entry point
├── installer/             # Service installation scripts
│   └── service/
├── gstreamer/             # Bundled GStreamer (Windows)
├── Dockerfile             # Docker image definition
└── docker-compose.yml     # Docker Compose template
```

## Troubleshooting

### GStreamer Not Found

```bash
# Linux: Install system GStreamer
sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-libav

# Windows: Run download script
npm run download-gstreamer
```

### Encoder Not Available

- **nvh265**: Install NVIDIA GPU drivers
- **qsvh265**: Install Intel GPU drivers
- **Fallback**: Use `x265` (works on all systems)

### Docker: Permission Denied

```bash
# Ensure output directory is writable
chmod 777 ./output
# Or run with specific user
docker run --user $(id -u):$(id -g) ...
```

### Progress Stuck at 0%

MP4/MOV formats buffer until chunk completion. Use MKV format for incremental progress visibility.

## CI/CD

Automated builds via GitHub Actions. Create releases with:

```bash
npm run release-patch  # 1.0.0 → 1.0.1
npm run release-minor  # 1.0.0 → 1.1.0
npm run release-major  # 1.0.0 → 2.0.0
```

## License

MIT

## Support

- **Issues**: [GitHub Issues](https://github.com/oceanlabsystems/h265-transcoder/issues)
- **Homepage**: [oceanlabsystems.com](https://www.oceanlabsystems.com)

---

**Version**: 1.2.0  
**Author**: Oceanlab Systems  
**License**: [MIT](LICENSE)
