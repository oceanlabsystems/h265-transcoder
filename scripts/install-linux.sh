#!/bin/bash
# H265 Transcoder CLI - One-line installer for Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/oceanlabsystems/h265-transcoder/main/scripts/install-linux.sh | bash

set -e

REPO="oceanlabsystems/h265-transcoder"
INSTALL_DIR="/opt/h265-transcoder"
CONFIG_DIR="/etc/h265-transcoder"
BIN_LINK="/usr/local/bin/h265-transcoder-cli"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          H265 Transcoder CLI - Linux Installer               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check for root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}This script requires root privileges. Re-running with sudo...${NC}"
    exec sudo bash "$0" "$@"
fi

# Detect package manager
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt"
    PKG_INSTALL="apt-get install -y"
    PKG_UPDATE="apt-get update"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
    PKG_INSTALL="dnf install -y"
    PKG_UPDATE="dnf check-update || true"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    PKG_INSTALL="yum install -y"
    PKG_UPDATE="yum check-update || true"
else
    echo -e "${RED}ERROR: Unsupported package manager. Please install manually.${NC}"
    exit 1
fi

echo -e "${GREEN}Detected package manager: $PKG_MANAGER${NC}"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js...${NC}"
    if [ "$PKG_MANAGER" = "apt" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        $PKG_INSTALL nodejs
    fi
else
    echo -e "${GREEN}Node.js already installed: $(node --version)${NC}"
fi

# Install GStreamer
echo -e "${YELLOW}Installing GStreamer...${NC}"
$PKG_UPDATE
if [ "$PKG_MANAGER" = "apt" ]; then
    $PKG_INSTALL gstreamer1.0-tools gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-ugly gstreamer1.0-libav
elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
    $PKG_INSTALL gstreamer1 gstreamer1-plugins-base \
        gstreamer1-plugins-good gstreamer1-plugins-bad-free \
        gstreamer1-plugins-ugly-free gstreamer1-libav
fi

# Get latest release
echo -e "${YELLOW}Downloading latest release...${NC}"
LATEST_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep "browser_download_url.*linux-cli.*tar.gz" | cut -d '"' -f 4)

if [ -z "$LATEST_URL" ]; then
    echo -e "${YELLOW}No pre-built release found. Installing from npm...${NC}"
    npm install -g h265-transcoder-cli
else
    # Download and extract
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    curl -fsSL "$LATEST_URL" -o cli.tar.gz
    tar -xzf cli.tar.gz

    # Install
    mkdir -p "$INSTALL_DIR"
    cp -r linux-cli/* "$INSTALL_DIR/"
    
    # Create symlink
    ln -sf "$INSTALL_DIR/h265-transcoder-cli" "$BIN_LINK"
    
    # Cleanup
    cd /
    rm -rf "$TEMP_DIR"
fi

# Create config directory and default config
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
    cat > "$CONFIG_DIR/config.yaml" << 'EOF'
# H265 Transcoder Configuration
# Edit this file to configure the service

# Required: Input directory to monitor
input: /mnt/videos/input

# Required: Output directory for processed files
output: /mnt/videos/output

# Encoder: x265 (CPU), nvh265 (NVIDIA), qsvh265 (Intel)
encoder: x265

# Output format: mp4, mkv, mov
format: mkv

# Chunk duration in minutes
chunkDurationMinutes: 60

# Speed preset for x265
speedPreset: medium

# Enable watch mode
watch: true

# Concurrent processing
concurrency: 1
EOF
    echo -e "${GREEN}Created config file: $CONFIG_DIR/config.yaml${NC}"
fi

# Install systemd service
cat > /etc/systemd/system/h265-transcoder.service << EOF
[Unit]
Description=H265 Video Transcoder Service
After=network.target

[Service]
Type=simple
ExecStart=$BIN_LINK --config $CONFIG_DIR/config.yaml --watch
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Quick Start:${NC}"
echo ""
echo "  1. Edit configuration:"
echo -e "     ${YELLOW}sudo nano $CONFIG_DIR/config.yaml${NC}"
echo ""
echo "  2. Test the CLI:"
echo -e "     ${YELLOW}h265-transcoder-cli --input /path/to/videos --output /path/to/output${NC}"
echo ""
echo "  3. Run as a service:"
echo -e "     ${YELLOW}sudo systemctl enable h265-transcoder${NC}"
echo -e "     ${YELLOW}sudo systemctl start h265-transcoder${NC}"
echo ""
echo "  4. View logs:"
echo -e "     ${YELLOW}sudo journalctl -u h265-transcoder -f${NC}"
echo ""
