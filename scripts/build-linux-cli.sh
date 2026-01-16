#!/bin/bash
# Build script for Linux CLI-only deployment
# Run this on a Linux machine or in WSL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/dist/linux-cli"

echo "========================================"
echo "Building H265 Transcoder CLI for Linux"
echo "========================================"

cd "$PROJECT_DIR"

# Clean previous build
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Build CLI
echo "Building CLI..."
npm run cli:build

# Copy CLI files
echo "Copying CLI files..."
cp -r out/cli "$OUTPUT_DIR/"

# Copy only required node_modules (production dependencies)
echo "Copying dependencies..."
mkdir -p "$OUTPUT_DIR/node_modules"

# These are the runtime dependencies needed for CLI
DEPS="commander chokidar yaml"
for dep in $DEPS; do
  if [ -d "node_modules/$dep" ]; then
    cp -r "node_modules/$dep" "$OUTPUT_DIR/node_modules/"
  fi
done

# Copy chokidar dependencies
for subdep in readdirp braces picomatch fill-range to-regex-range is-number normalize-path glob-parent is-glob is-extglob anymatch binary-extensions is-binary-path; do
  if [ -d "node_modules/$subdep" ]; then
    cp -r "node_modules/$subdep" "$OUTPUT_DIR/node_modules/"
  fi
done

# Copy service files
echo "Copying service files..."
cp -r installer/service "$OUTPUT_DIR/"

# Create launcher script
cat > "$OUTPUT_DIR/h265-transcoder-cli" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/cli/cli/index.js" "$@"
EOF
chmod +x "$OUTPUT_DIR/h265-transcoder-cli"

# Create install script
cat > "$OUTPUT_DIR/install.sh" << 'EOF'
#!/bin/bash
# H265 Transcoder CLI Installer for Linux

set -e

INSTALL_DIR="/opt/h265-transcoder"
CONFIG_DIR="/etc/h265-transcoder"
BIN_LINK="/usr/local/bin/h265-transcoder-cli"

echo "Installing H265 Transcoder CLI..."

# Check for root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo)"
  exit 1
fi

# Check dependencies
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed"
  echo "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

if ! command -v gst-launch-1.0 &> /dev/null; then
  echo "ERROR: GStreamer is not installed"
  echo "Install with: sudo apt-get install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav"
  exit 1
fi

# Install files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/cli" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/h265-transcoder-cli" "$INSTALL_DIR/"

# Create symlink
ln -sf "$INSTALL_DIR/h265-transcoder-cli" "$BIN_LINK"

# Create config directory and default config
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
  cp "$SCRIPT_DIR/service/config.example.yaml" "$CONFIG_DIR/config.yaml"
  echo "Created default config at $CONFIG_DIR/config.yaml"
fi

# Copy systemd service file
cp "$SCRIPT_DIR/service/h265-transcoder.service" /etc/systemd/system/
systemctl daemon-reload

echo ""
echo "Installation complete!"
echo ""
echo "Usage:"
echo "  h265-transcoder-cli --input /path/to/input --output /path/to/output --watch"
echo ""
echo "To run as a service:"
echo "  1. Edit config: sudo nano $CONFIG_DIR/config.yaml"
echo "  2. Enable: sudo systemctl enable h265-transcoder"
echo "  3. Start: sudo systemctl start h265-transcoder"
echo ""
EOF
chmod +x "$OUTPUT_DIR/install.sh"

# Create tarball
echo "Creating tarball..."
cd "$PROJECT_DIR/dist"
tar -czvf h265-transcoder-cli-linux.tar.gz linux-cli

echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"
echo ""
echo "Output: $PROJECT_DIR/dist/h265-transcoder-cli-linux.tar.gz"
echo ""
echo "To deploy on a Linux server:"
echo "  1. Copy the tarball to the server"
echo "  2. Extract: tar -xzvf h265-transcoder-cli-linux.tar.gz"
echo "  3. Install: cd linux-cli && sudo ./install.sh"
echo ""
