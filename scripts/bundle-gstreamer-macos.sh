#!/bin/bash
# Bundle GStreamer for macOS with proper dylib path rewriting.
#
# This script:
# 1. Extracts the official GStreamer .pkg (or uses system-installed GStreamer)
# 2. Copies all required binaries, plugins, and dylibs
# 3. Rewrites all library paths to use @loader_path relative references
#
# Output layout:
#   gstreamer/macos/
#     bin/        (gst-launch-1.0, gst-inspect-1.0, gst-discoverer-1.0, ...)
#     lib/        (libgstreamer-1.0.dylib, libglib-2.0.0.dylib, etc.)
#       gstreamer-1.0/  (plugins)
#     libexec/    (gst-plugin-scanner)
#
# Usage:
#   ./scripts/bundle-gstreamer-macos.sh
#
# Requirements:
#   - macOS (for install_name_tool and otool)
#   - Either: GStreamer.framework installed, or the .pkg file downloaded

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

OUT_ROOT="$PROJECT_DIR/gstreamer/macos"
PKG_PATH="$PROJECT_DIR/gstreamer/gstreamer-1.0-1.22.10-universal.pkg"

# GStreamer framework location when installed via .pkg
FRAMEWORK_PATH="/Library/Frameworks/GStreamer.framework/Versions/1.0"

# Homebrew GStreamer locations (fallback)
HOMEBREW_INTEL="/usr/local/opt/gstreamer"
HOMEBREW_ARM="/opt/homebrew/opt/gstreamer"

echo "========================================"
echo "Bundling GStreamer for macOS"
echo "Output: $OUT_ROOT"
echo "========================================"

# Check we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: This script must be run on macOS"
    echo "macOS is required for install_name_tool and otool"
    exit 1
fi

# Find GStreamer source
GST_SOURCE=""

if [[ -d "$FRAMEWORK_PATH" ]]; then
    echo "Found GStreamer framework at: $FRAMEWORK_PATH"
    GST_SOURCE="$FRAMEWORK_PATH"
elif [[ -d "$HOMEBREW_ARM/lib" ]]; then
    echo "Found Homebrew GStreamer (ARM) at: $HOMEBREW_ARM"
    GST_SOURCE="$HOMEBREW_ARM"
elif [[ -d "$HOMEBREW_INTEL/lib" ]]; then
    echo "Found Homebrew GStreamer (Intel) at: $HOMEBREW_INTEL"
    GST_SOURCE="$HOMEBREW_INTEL"
elif [[ -f "$PKG_PATH" ]]; then
    echo "Found GStreamer .pkg, will extract..."
    # Extract pkg to temp location
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    
    echo "Extracting .pkg to temporary location..."
    pkgutil --expand "$PKG_PATH" "$TMP_DIR/expanded"
    
    # Find and extract the payload
    PAYLOAD_DIR="$TMP_DIR/payload"
    mkdir -p "$PAYLOAD_DIR"
    
    # GStreamer .pkg contains nested packages
    for pkg in "$TMP_DIR/expanded"/*.pkg; do
        if [[ -f "$pkg/Payload" ]]; then
            echo "Extracting payload from $(basename "$pkg")..."
            cd "$PAYLOAD_DIR"
            cat "$pkg/Payload" | gunzip -dc | cpio -i 2>/dev/null || true
        fi
    done
    
    # Look for extracted framework
    if [[ -d "$PAYLOAD_DIR/Library/Frameworks/GStreamer.framework/Versions/1.0" ]]; then
        GST_SOURCE="$PAYLOAD_DIR/Library/Frameworks/GStreamer.framework/Versions/1.0"
        echo "Extracted framework to: $GST_SOURCE"
    else
        echo "ERROR: Could not find GStreamer framework in extracted .pkg"
        echo "Please install GStreamer from: https://gstreamer.freedesktop.org/download/"
        exit 1
    fi
else
    echo "ERROR: GStreamer not found!"
    echo ""
    echo "Please install GStreamer using one of these methods:"
    echo ""
    echo "Option 1: Install official GStreamer framework (recommended)"
    echo "  1. Download from: https://gstreamer.freedesktop.org/download/"
    echo "  2. Install the .pkg file"
    echo "  3. Re-run this script"
    echo ""
    echo "Option 2: Install via Homebrew"
    echo "  brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav"
    echo ""
    echo "Option 3: Download the .pkg to the gstreamer folder"
    echo "  The script will extract it automatically."
    exit 1
fi

# Clean and create output directory
rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT/bin" "$OUT_ROOT/lib/gstreamer-1.0" "$OUT_ROOT/libexec/gstreamer-1.0"

echo ""
echo "Copying binaries..."

# Copy main binaries
BINARIES=(
    "gst-launch-1.0"
    "gst-inspect-1.0"
    "gst-discoverer-1.0"
    "gst-typefind-1.0"
)

for bin in "${BINARIES[@]}"; do
    if [[ -f "$GST_SOURCE/bin/$bin" ]]; then
        cp -a "$GST_SOURCE/bin/$bin" "$OUT_ROOT/bin/"
        echo "  ✓ $bin"
    else
        echo "  ⚠ $bin not found (optional)"
    fi
done

# Copy plugin scanner
if [[ -f "$GST_SOURCE/libexec/gstreamer-1.0/gst-plugin-scanner" ]]; then
    cp -a "$GST_SOURCE/libexec/gstreamer-1.0/gst-plugin-scanner" "$OUT_ROOT/libexec/gstreamer-1.0/"
    echo "  ✓ gst-plugin-scanner"
fi

echo ""
echo "Copying plugins..."

# Copy all plugins
if [[ -d "$GST_SOURCE/lib/gstreamer-1.0" ]]; then
    cp -a "$GST_SOURCE/lib/gstreamer-1.0/"*.dylib "$OUT_ROOT/lib/gstreamer-1.0/" 2>/dev/null || true
    PLUGIN_COUNT=$(ls -1 "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ Copied $PLUGIN_COUNT plugins"
else
    echo "  ⚠ Plugin directory not found"
fi

echo ""
echo "Collecting library dependencies..."

# Function to get all dylib dependencies of a binary
get_deps() {
    otool -L "$1" 2>/dev/null | awk 'NR>1 {print $1}' | grep -v "^/System" | grep -v "^/usr/lib" || true
}

# Function to copy a dylib and return its basename
copy_lib() {
    local lib_path="$1"
    local lib_name
    
    # Resolve symlinks to get the real file
    if [[ -L "$lib_path" ]]; then
        lib_path="$(readlink -f "$lib_path" 2>/dev/null || realpath "$lib_path" 2>/dev/null || echo "$lib_path")"
    fi
    
    if [[ ! -f "$lib_path" ]]; then
        return 1
    fi
    
    lib_name="$(basename "$lib_path")"
    
    # Skip if already copied
    if [[ -f "$OUT_ROOT/lib/$lib_name" ]]; then
        return 0
    fi
    
    cp -a "$lib_path" "$OUT_ROOT/lib/"
    echo "    $lib_name"
    return 0
}

# Collect all dependencies recursively
declare -A PROCESSED_LIBS
LIBS_TO_PROCESS=()

# Start with binaries
for bin in "$OUT_ROOT/bin/"*; do
    [[ -f "$bin" ]] || continue
    for dep in $(get_deps "$bin"); do
        LIBS_TO_PROCESS+=("$dep")
    done
done

# Add plugins
for plugin in "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib; do
    [[ -f "$plugin" ]] || continue
    for dep in $(get_deps "$plugin"); do
        LIBS_TO_PROCESS+=("$dep")
    done
done

# Add libexec binaries
for libexec_bin in "$OUT_ROOT/libexec/gstreamer-1.0/"*; do
    [[ -f "$libexec_bin" ]] || continue
    for dep in $(get_deps "$libexec_bin"); do
        LIBS_TO_PROCESS+=("$dep")
    done
done

# Process all dependencies (up to 10 iterations for transitive deps)
for iteration in {1..10}; do
    NEW_LIBS=()
    
    for lib_path in "${LIBS_TO_PROCESS[@]}"; do
        # Skip if already processed
        [[ -n "${PROCESSED_LIBS[$lib_path]:-}" ]] && continue
        PROCESSED_LIBS["$lib_path"]=1
        
        # Try to find the library
        actual_path=""
        
        # Check various locations
        if [[ -f "$lib_path" ]]; then
            actual_path="$lib_path"
        elif [[ -f "$GST_SOURCE/lib/$(basename "$lib_path")" ]]; then
            actual_path="$GST_SOURCE/lib/$(basename "$lib_path")"
        elif [[ -f "/opt/homebrew/lib/$(basename "$lib_path")" ]]; then
            actual_path="/opt/homebrew/lib/$(basename "$lib_path")"
        elif [[ -f "/usr/local/lib/$(basename "$lib_path")" ]]; then
            actual_path="/usr/local/lib/$(basename "$lib_path")"
        fi
        
        if [[ -n "$actual_path" ]] && [[ -f "$actual_path" ]]; then
            if copy_lib "$actual_path"; then
                # Get transitive dependencies
                for dep in $(get_deps "$actual_path"); do
                    if [[ -z "${PROCESSED_LIBS[$dep]:-}" ]]; then
                        NEW_LIBS+=("$dep")
                    fi
                done
            fi
        fi
    done
    
    # If no new libraries found, we're done
    [[ ${#NEW_LIBS[@]} -eq 0 ]] && break
    
    LIBS_TO_PROCESS=("${NEW_LIBS[@]}")
done

LIB_COUNT=$(ls -1 "$OUT_ROOT/lib/"*.dylib 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "  ✓ Copied $LIB_COUNT libraries"

echo ""
echo "Rewriting library paths..."

# Function to rewrite library paths in a binary
rewrite_paths() {
    local binary="$1"
    local relative_lib_path="$2"  # e.g., "../lib" from bin, "../../lib" from lib/gstreamer-1.0
    
    # Get current dependencies
    for old_path in $(get_deps "$binary"); do
        local lib_name
        lib_name="$(basename "$old_path")"
        
        # Check if we have this library bundled
        if [[ -f "$OUT_ROOT/lib/$lib_name" ]]; then
            local new_path="@loader_path/$relative_lib_path/$lib_name"
            install_name_tool -change "$old_path" "$new_path" "$binary" 2>/dev/null || true
        fi
    done
    
    # Also fix the library's own ID if it's a dylib
    if [[ "$binary" == *.dylib ]]; then
        local lib_name
        lib_name="$(basename "$binary")"
        install_name_tool -id "@loader_path/$lib_name" "$binary" 2>/dev/null || true
    fi
}

# Rewrite paths in binaries (bin -> ../lib)
echo "  Rewriting bin/* ..."
for bin in "$OUT_ROOT/bin/"*; do
    [[ -f "$bin" ]] || continue
    rewrite_paths "$bin" "../lib"
done

# Rewrite paths in libraries (lib -> .)
echo "  Rewriting lib/*.dylib ..."
for lib in "$OUT_ROOT/lib/"*.dylib; do
    [[ -f "$lib" ]] || continue
    rewrite_paths "$lib" "."
done

# Rewrite paths in plugins (lib/gstreamer-1.0 -> ..)
echo "  Rewriting lib/gstreamer-1.0/*.dylib ..."
for plugin in "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib; do
    [[ -f "$plugin" ]] || continue
    rewrite_paths "$plugin" ".."
done

# Rewrite paths in libexec binaries (libexec/gstreamer-1.0 -> ../../lib)
echo "  Rewriting libexec/* ..."
for libexec_bin in "$OUT_ROOT/libexec/gstreamer-1.0/"*; do
    [[ -f "$libexec_bin" ]] || continue
    rewrite_paths "$libexec_bin" "../../lib"
done

echo ""
echo "Verifying bundle..."

# Test that gst-inspect can run
export DYLD_LIBRARY_PATH="$OUT_ROOT/lib"
export GST_PLUGIN_PATH="$OUT_ROOT/lib/gstreamer-1.0"
export GST_PLUGIN_SCANNER="$OUT_ROOT/libexec/gstreamer-1.0/gst-plugin-scanner"

if "$OUT_ROOT/bin/gst-inspect-1.0" --version >/dev/null 2>&1; then
    echo "  ✓ gst-inspect-1.0 runs successfully"
    VERSION=$("$OUT_ROOT/bin/gst-inspect-1.0" --version 2>&1 | head -1)
    echo "    $VERSION"
else
    echo "  ⚠ gst-inspect-1.0 test failed (may still work at runtime)"
fi

# Check for VideoToolbox encoder
if "$OUT_ROOT/bin/gst-inspect-1.0" vtenc_h265 >/dev/null 2>&1; then
    echo "  ✓ vtenc_h265 (VideoToolbox H.265 encoder) available"
else
    echo "  ⚠ vtenc_h265 not found - VideoToolbox encoding may not be available"
fi

echo ""
echo "========================================"
echo "✓ macOS GStreamer bundle created at: $OUT_ROOT"
echo ""
echo "Bundle contents:"
echo "  - $(ls -1 "$OUT_ROOT/bin/" 2>/dev/null | wc -l | tr -d ' ') binaries"
echo "  - $(ls -1 "$OUT_ROOT/lib/"*.dylib 2>/dev/null | wc -l | tr -d ' ') libraries"
echo "  - $(ls -1 "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib 2>/dev/null | wc -l | tr -d ' ') plugins"
echo ""
echo "Next steps:"
echo "  1. Build your macOS app: npm run build:mac"
echo "  2. The bundle will be included in the app automatically"
echo "========================================"
