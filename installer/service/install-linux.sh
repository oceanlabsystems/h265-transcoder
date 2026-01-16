#!/bin/bash
# H265 Transcoder Linux Service Installer

set -e

INSTALL_DIR="/opt/h265-transcoder"
CONFIG_DIR="/etc/h265-transcoder"
SERVICE_USER="transcoder"
SERVICE_NAME="h265-transcoder"

echo "========================================"
echo "H265 Transcoder Linux Service Installer"
echo "========================================"
echo ""

# Check for root privileges
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root (use sudo)"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi

echo "Node.js version: $(node --version)"
echo ""

# Create service user if not exists
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating service user: $SERVICE_USER"
    useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
fi

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p /var/lib/h265-transcoder

# Copy CLI files (adjust source path as needed)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/../cli" ]; then
    echo "Copying CLI files..."
    cp -r "$SCRIPT_DIR/../cli" "$INSTALL_DIR/"
fi

# Create default config if not exists
if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
    echo "Creating default configuration..."
    cat > "$CONFIG_DIR/config.yaml" << 'EOF'
# H265 Transcoder Service Configuration
# Edit this file to configure the service

# Required: Input directory to monitor for new video files
input: /mnt/videos/input

# Required: Output directory for processed files
output: /mnt/videos/output

# Encoder: x265 (CPU), nvh265 (NVIDIA GPU), qsvh265 (Intel GPU)
encoder: x265

# Output format: mp4, mkv, mov
format: mkv

# Chunk duration in minutes
chunkDurationMinutes: 60

# Speed preset for x265
speedPreset: medium

# Enable watch mode (required for service)
watch: true

# Optional: Move processed originals here
# processedDir: /mnt/videos/processed

# Optional: Move failed files here
# failedDir: /mnt/videos/failed

# Number of files to process simultaneously
concurrency: 1
EOF
fi

# Copy systemd service file
echo "Installing systemd service..."
cp "$SCRIPT_DIR/h265-transcoder.service" /etc/systemd/system/

# Set permissions
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/h265-transcoder
chmod 644 /etc/systemd/system/h265-transcoder.service

# Reload systemd
systemctl daemon-reload

echo ""
echo "========================================"
echo "Installation complete!"
echo "========================================"
echo ""
echo "Service Name: $SERVICE_NAME"
echo "Config File:  $CONFIG_DIR/config.yaml"
echo ""
echo "Next steps:"
echo "1. Edit the config file: sudo nano $CONFIG_DIR/config.yaml"
echo "2. Update the service file with your video directories:"
echo "   sudo nano /etc/systemd/system/h265-transcoder.service"
echo "3. Enable the service: sudo systemctl enable $SERVICE_NAME"
echo "4. Start the service: sudo systemctl start $SERVICE_NAME"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo ""
