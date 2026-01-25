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

## Supported Platforms

| Platform | Versions | Hardware Encoding |
| -------- | -------- | ----------------- |
| **Windows** | Windows 10/11 | NVIDIA NVENC, Intel Quick Sync |
| **macOS** | macOS 11+ (Big Sur) | Apple VideoToolbox |
| **Linux** | Ubuntu 22.04+, Debian 12+ | Intel VA-API, NVIDIA NVENC |

> **Note:** Older Linux distributions (e.g. 20.04) are not supported due to GStreamer version requirements.

## Installation

### Desktop Application (Windows/macOS/Linux)

Download the latest installer from [Releases](https://github.com/oceanlabsystems/h265-transcoder/releases):

| Platform | Download                          | Notes |
| -------- | --------------------------------- | ----- |
| Windows  | `h265-transcoder-X.X.X-setup.exe` | GStreamer bundled, ready to use |
| macOS    | `h265-transcoder-X.X.X.dmg`       | GStreamer bundled, ready to use |
| Linux    | `h265-transcoder-X.X.X.deb`       | **Recommended** — GStreamer bundled |
| Linux    | `h265-transcoder-X.X.X.AppImage`  | GStreamer bundled |

The installer includes both the GUI application and CLI service tools.

### Linux Requirements

The Linux builds bundle GStreamer, but **hardware encoding requires system drivers**:

```bash
# Ubuntu 22.04+ / Debian 12+ — Install Intel VA-API drivers for hardware encoding
sudo apt install intel-media-va-driver vainfo

# Verify VA-API is working
vainfo
```

If `vainfo` shows your GPU and supported profiles, hardware encoding will work automatically.

### Docker (Headless Linux Servers)

#### Software Encoding (Works Everywhere)

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

#### Hardware Encoding (Intel VA-API)

For Intel hardware encoding in Docker, you need to pass through the GPU:

```bash
# Verify host has VA-API working first
vainfo

# Run with GPU passthrough
docker run -d \
  --name h265-transcoder \
  --restart unless-stopped \
  --device /dev/dri:/dev/dri \
  -v $(pwd)/input:/input:ro \
  -v $(pwd)/output:/output \
  -v $(pwd)/config:/config \
  oceanlabsystems/h265-transcoder:latest
```

Update your `config.yaml` to use hardware encoding:

```yaml
encoder: vaapih265  # Intel VA-API hardware encoder
```

#### Docker Compose

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

| Encoder       | Type             | Speed     | Platform | Requirements |
| ------------- | ---------------- | --------- | -------- | ------------ |
| **x265**      | Software (CPU)   | 0.1-0.3x  | All      | None (always available) |
| **nvh265**    | NVIDIA NVENC     | 0.5-1.0x  | All      | NVIDIA GPU + drivers |
| **qsvh265**   | Intel Quick Sync | 0.25-0.4x | Win/Mac  | Intel GPU + drivers |
| **vaapih265** | Intel VA-API     | 0.3-0.5x  | Linux    | Intel GPU + `intel-media-va-driver` |
| **vtenc**     | VideoToolbox     | 0.4-0.6x  | macOS    | Apple Silicon or Intel Mac |

Speed is relative to video duration (1.0x = realtime).

The application automatically detects available hardware encoders and recommends the best option.

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

**Linux note:** `npm run download-gstreamer` does not download binaries on Linux. It checks for a system GStreamer install and prints distro-specific install commands if missing.

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

### Linux: Hardware Encoder Not Detected

If the app only shows "x265 (software)" on Linux, your VA-API drivers may be missing or misconfigured.

#### 1. Check VA-API Status

```bash
# Install vainfo tool
sudo apt install vainfo

# Check if VA-API is working
vainfo
```

**Expected output** (Intel GPU):
```
vainfo: VA-API version: 1.22 (libva 2.12.0)
vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics
vainfo: Supported profile and entrypoints
      VAProfileHEVCMain               : VAEntrypointEncSlice
      ...
```

#### 2. Install Intel VA-API Drivers

```bash
# Ubuntu 22.04+ / Debian 12+
sudo apt install intel-media-va-driver

# For older Intel GPUs (Broadwell and earlier)
sudo apt install i965-va-driver

# Verify installation
vainfo
```

#### 3. Common VA-API Errors

| Error | Solution |
| ----- | -------- |
| `vaInitialize failed` | Install `intel-media-va-driver` or `i965-va-driver` |
| `LIBVA_DRIVER_NAME` issues | Set `export LIBVA_DRIVER_NAME=iHD` (or `i965` for older GPUs) |
| Permission denied on `/dev/dri` | Add user to `video` and `render` groups: `sudo usermod -aG video,render $USER` |

#### 4. Clear GStreamer Cache

After installing drivers, clear the plugin cache:

```bash
rm -f ~/.cache/gstreamer-1.0/registry.bin
```

Then restart the application.

### Linux: Unsupported Distribution

The Linux builds require **Ubuntu 22.04+** or **Debian 12+**. Older distributions have incompatible GStreamer versions.

If you're on an older system, use Docker instead:

```bash
docker run -d --device /dev/dri:/dev/dri \
  -v /path/to/input:/input:ro \
  -v /path/to/output:/output \
  oceanlabsystems/h265-transcoder:latest
```

### Windows/macOS: Encoder Not Available

- **nvh265**: Install [NVIDIA GPU drivers](https://www.nvidia.com/drivers)
- **qsvh265**: Install [Intel Graphics drivers](https://www.intel.com/content/www/us/en/download-center/home.html)
- **Fallback**: Use `x265` (works on all systems)

### Docker: Hardware Encoding Not Working

```bash
# 1. Verify host has working VA-API
vainfo

# 2. Check /dev/dri exists and is accessible
ls -la /dev/dri/

# 3. Run container with GPU passthrough
docker run --device /dev/dri:/dev/dri ...

# 4. Inside container, verify VA-API works
docker exec -it h265-transcoder vainfo
```

### Docker: Permission Denied

```bash
# Ensure output directory is writable
chmod 777 ./output

# Or run with specific user
docker run --user $(id -u):$(id -g) ...

# For GPU access, add user to video group
sudo usermod -aG video $USER
```

### Progress Stuck at 0%

MP4/MOV formats buffer until chunk completion. Use MKV format for incremental progress visibility.

### GStreamer Not Found (Development)

```bash
# Linux: Install system GStreamer
sudo apt install gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav gstreamer1.0-vaapi

# Windows: Run download script
npm run download-gstreamer
```

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
