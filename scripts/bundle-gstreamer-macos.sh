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

# Temp files for cleanup (bash 3.x compatible - no arrays in trap)
CLEANUP_TMP_DIR=""
CLEANUP_PROCESSED_FILE=""
CLEANUP_LIBS_FILE=""

cleanup() {
    [[ -n "$CLEANUP_TMP_DIR" ]] && rm -rf "$CLEANUP_TMP_DIR" 2>/dev/null || true
    [[ -n "$CLEANUP_PROCESSED_FILE" ]] && rm -f "$CLEANUP_PROCESSED_FILE" 2>/dev/null || true
    [[ -n "$CLEANUP_LIBS_FILE" ]] && rm -f "$CLEANUP_LIBS_FILE" "${CLEANUP_LIBS_FILE}.tmp" 2>/dev/null || true
}
trap cleanup EXIT

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
GST_IS_FRAMEWORK=0

if [[ -d "$FRAMEWORK_PATH" ]]; then
    echo "Found GStreamer framework at: $FRAMEWORK_PATH"
    echo "  (Official framework - recommended for distribution)"
    GST_SOURCE="$FRAMEWORK_PATH"
    GST_IS_FRAMEWORK=1
elif [[ -d "$HOMEBREW_ARM/lib" ]]; then
    echo "Found Homebrew GStreamer (ARM) at: $HOMEBREW_ARM"
    echo ""
    echo "⚠️  WARNING: Homebrew GStreamer has X11 dependencies that may cause issues!"
    echo "    The official GStreamer framework is recommended for distribution."
    echo "    Install from: https://gstreamer.freedesktop.org/download/"
    echo ""
    GST_SOURCE="$HOMEBREW_ARM"
elif [[ -d "$HOMEBREW_INTEL/lib" ]]; then
    echo "Found Homebrew GStreamer (Intel) at: $HOMEBREW_INTEL"
    echo ""
    echo "⚠️  WARNING: Homebrew GStreamer has X11 dependencies that may cause issues!"
    echo "    The official GStreamer framework is recommended for distribution."
    echo "    Install from: https://gstreamer.freedesktop.org/download/"
    echo ""
    GST_SOURCE="$HOMEBREW_INTEL"
elif [[ -f "$PKG_PATH" ]]; then
    echo "Found GStreamer .pkg, will extract..."
    # Extract pkg to temp location
    CLEANUP_TMP_DIR="$(mktemp -d)"
    TMP_DIR="$CLEANUP_TMP_DIR"
    
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
echo "Copying plugins (selective - excluding unnecessary ones)..."

# Plugins to EXCLUDE (not needed for video encoding):
# - Python plugin: requires Python3.framework, causes timeouts
# - Network plugins: rtsp, rtmp, rtp, udp, etc. (we only process local files)
# - Audio-only plugins: we process video only (but keep basic audio for passthrough)
# - Effects/filters: we don't use video effects
# - Text/subtitle: we don't process subtitles
# - Other unnecessary plugins

EXCLUDE_PATTERNS=(
    "*python*"           # Python plugin (requires framework)
    "*gstpython*"        # Python plugin variants
    "*ges*"              # GStreamer Editing Services (requires Python framework)
    "*gstges*"           # GES plugin variants
    "*nle*"              # Non-linear editing (part of GES, requires Python)
    "*rtsp*"             # RTSP streaming
    "*rtmp*"             # RTMP streaming
    "*rtp*"              # RTP streaming
    "*srt*"              # SRT streaming
    "*webrtc*"           # WebRTC
    "*dtls*"             # DTLS
    "*srtp*"             # SRTP
    "*dv*"                # DV (Digital Video)
    "*dvbsub*"           # DVB subtitles
    "*subtitle*"         # Subtitle plugins
    "*text*"             # Text rendering
    "*overlay*"          # Video overlays (we don't use)
    "*effect*"           # Video effects
    "*equalizer*"        # Audio equalizer
    "*level*"            # Audio level
    "*volume*"            # Audio volume (we pass through)
    "*pulse*"            # PulseAudio (Linux audio, not needed on macOS)
    "*alsa*"             # ALSA (Linux audio)
    "*oss*"              # OSS audio
    "*jack*"             # JACK audio
    "*opencv*"           # OpenCV (computer vision, not needed)
    "*openni*"           # OpenNI (depth sensors)
    "*kate*"             # Kate (text/subtitle)
    "*spandsp*"          # SpanDSP (telephony)
    "*voaacenc*"         # VisualOn AAC (alternative encoder)
    "*voamrwbenc*"       # VisualOn AMR-WB
    "*wildmidi*"         # WildMIDI
    "*zbar*"             # ZBar (barcode scanning)
    "*assrender*"        # ASS subtitle renderer
    "*rsvg*"             # SVG rendering
    "*cairo*"            # Cairo graphics (unless needed by other plugins)
    "*gtk*"              # GTK (GUI toolkit, not needed)
    "*qt*"               # Qt (GUI toolkit, not needed)
    "*gl*"               # OpenGL (unless needed for hardware acceleration)
    "*wayland*"          # Wayland (Linux display server)
    "*x11*"               # X11 (Linux display server)
    "*v4l2*"             # Video4Linux2 (Linux video capture)
    "*v4l*"              # Video4Linux
    "*decklink*"         # DeckLink (video capture cards)
    "*dshow*"            # DirectShow (Windows)
    "*wasapi*"           # WASAPI (Windows audio)
    "*directsound*"      # DirectSound (Windows audio)
    "*winks*"            # Windows Media
    "*winscreencap*"     # Windows screen capture
    "*wasapisrc*"        # WASAPI source
    "*directsoundsrc*"   # DirectSound source
)

if [[ -d "$GST_SOURCE/lib/gstreamer-1.0" ]]; then
    PLUGINS_COPIED=0
    PLUGINS_SKIPPED=0
    
    for plugin in "$GST_SOURCE/lib/gstreamer-1.0/"*.dylib; do
        [[ -f "$plugin" ]] || continue
        plugin_name=$(basename "$plugin")
        
        # Check if this plugin should be excluded
        should_exclude=false
        for pattern in "${EXCLUDE_PATTERNS[@]}"; do
            if [[ "$plugin_name" == $pattern ]]; then
                should_exclude=true
                break
            fi
        done
        
        if [[ "$should_exclude" == true ]]; then
            echo "  ⊘ Skipping $plugin_name (not needed for video encoding)"
            ((PLUGINS_SKIPPED++))
        else
            cp -a "$plugin" "$OUT_ROOT/lib/gstreamer-1.0/" 2>/dev/null && ((PLUGINS_COPIED++)) || true
        fi
    done
    
    PLUGIN_COUNT=$(ls -1 "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ Copied $PLUGINS_COPIED plugins ($PLUGINS_SKIPPED excluded)"
    echo "  ✓ Total plugins in bundle: $PLUGIN_COUNT"
    echo ""
    echo "  Note: This selective bundling reduces size while keeping all video encoding"
    echo "        functionality. If you encounter missing element errors, you may need"
    echo "        to add specific plugins back."
else
    echo "  ⚠ Plugin directory not found"
fi

echo ""
echo "Collecting library dependencies..."

# Function to get all dylib dependencies of a binary
get_deps() {
    otool -L "$1" 2>/dev/null | awk 'NR>1 {print $1}' | grep -v "^/System" | grep -v "^/usr/lib" || true
}

# Function to copy a dylib (returns 0 if copied, 1 if skipped/failed)
copy_lib() {
    local lib_path="$1"
    local lib_name
    
    # Resolve symlinks to get the real file
    # Note: macOS doesn't have readlink -f, use a loop instead
    while [[ -L "$lib_path" ]]; do
        local link_target
        link_target="$(readlink "$lib_path")"
        if [[ "$link_target" == /* ]]; then
            lib_path="$link_target"
        else
            lib_path="$(dirname "$lib_path")/$link_target"
        fi
    done
    
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

# Use a file to track processed libraries (bash 3.x compatible)
CLEANUP_PROCESSED_FILE=$(mktemp)
PROCESSED_FILE="$CLEANUP_PROCESSED_FILE"

is_processed() {
    grep -q "^$1$" "$PROCESSED_FILE" 2>/dev/null
}

mark_processed() {
    echo "$1" >> "$PROCESSED_FILE"
}

# Collect initial dependencies from binaries, plugins, and libexec
CLEANUP_LIBS_FILE=$(mktemp)
LIBS_TO_PROCESS="$CLEANUP_LIBS_FILE"

# Start with binaries
for bin in "$OUT_ROOT/bin/"*; do
    [[ -f "$bin" ]] || continue
    get_deps "$bin" >> "$LIBS_TO_PROCESS"
done

# Add plugins
for plugin in "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib; do
    [[ -f "$plugin" ]] || continue
    get_deps "$plugin" >> "$LIBS_TO_PROCESS"
done

# Add libexec binaries
for libexec_bin in "$OUT_ROOT/libexec/gstreamer-1.0/"*; do
    [[ -f "$libexec_bin" ]] || continue
    get_deps "$libexec_bin" >> "$LIBS_TO_PROCESS"
done

# Process all dependencies (up to 10 iterations for transitive deps)
for iteration in 1 2 3 4 5 6 7 8 9 10; do
    NEW_LIBS=$(mktemp)
    has_new=0
    
    # Sort and unique the list
    sort -u "$LIBS_TO_PROCESS" > "${LIBS_TO_PROCESS}.tmp"
    mv "${LIBS_TO_PROCESS}.tmp" "$LIBS_TO_PROCESS"
    
    while IFS= read -r lib_path || [[ -n "$lib_path" ]]; do
        [[ -z "$lib_path" ]] && continue
        
        # Skip if already processed
        is_processed "$lib_path" && continue
        mark_processed "$lib_path"
        
        # Try to find the library
        actual_path=""
        lib_basename="$(basename "$lib_path")"
        
        # Check various locations (prioritize GStreamer source/framework)
        if [[ -f "$lib_path" ]]; then
            actual_path="$lib_path"
        elif [[ -f "$GST_SOURCE/lib/$lib_basename" ]]; then
            actual_path="$GST_SOURCE/lib/$lib_basename"
        elif [[ -f "/Library/Frameworks/GStreamer.framework/Versions/1.0/lib/$lib_basename" ]]; then
            # Fallback to installed framework even if using different source
            actual_path="/Library/Frameworks/GStreamer.framework/Versions/1.0/lib/$lib_basename"
        elif [[ -f "/opt/homebrew/lib/$lib_basename" ]]; then
            actual_path="/opt/homebrew/lib/$lib_basename"
        elif [[ -f "/usr/local/lib/$lib_basename" ]]; then
            actual_path="/usr/local/lib/$lib_basename"
        # Also check Homebrew opt directories for transitive deps
        elif [[ -d "/opt/homebrew/opt" ]]; then
            # Search in Homebrew opt packages (slow but thorough)
            for opt_dir in /opt/homebrew/opt/*/lib; do
                if [[ -f "$opt_dir/$lib_basename" ]]; then
                    actual_path="$opt_dir/$lib_basename"
                    break
                fi
            done
        fi
        
        if [[ -n "$actual_path" ]] && [[ -f "$actual_path" ]]; then
            if copy_lib "$actual_path"; then
                # Get transitive dependencies
                for dep in $(get_deps "$actual_path"); do
                    if ! is_processed "$dep"; then
                        echo "$dep" >> "$NEW_LIBS"
                        has_new=1
                    fi
                done
            fi
        fi
    done < "$LIBS_TO_PROCESS"
    
    # If no new libraries found, we're done
    if [[ $has_new -eq 0 ]]; then
        rm -f "$NEW_LIBS"
        break
    fi
    
    mv "$NEW_LIBS" "$LIBS_TO_PROCESS"
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
echo "Re-signing binaries (required after install_name_tool modifications)..."

# After modifying binaries with install_name_tool, their code signatures are invalidated.
# macOS will kill unsigned binaries, so we need to re-sign them.
# Using ad-hoc signing (--sign -) which doesn't require a developer certificate.

sign_binary() {
    local binary="$1"
    if [[ -f "$binary" ]]; then
        # Remove any existing signature and re-sign with ad-hoc signature
        codesign --force --sign - "$binary" 2>/dev/null && return 0
        return 1
    fi
    return 1
}

# Sign all binaries
echo "  Signing bin/* ..."
SIGN_COUNT=0
SIGN_FAIL=0
for bin in "$OUT_ROOT/bin/"*; do
    [[ -f "$bin" ]] || continue
    if sign_binary "$bin"; then
        SIGN_COUNT=$((SIGN_COUNT + 1))
    else
        SIGN_FAIL=$((SIGN_FAIL + 1))
        echo "    ⚠ Failed to sign: $(basename "$bin")"
    fi
done
echo "    Signed $SIGN_COUNT binaries"

# Sign all libraries
echo "  Signing lib/*.dylib ..."
SIGN_COUNT=0
for lib in "$OUT_ROOT/lib/"*.dylib; do
    [[ -f "$lib" ]] || continue
    if sign_binary "$lib"; then
        SIGN_COUNT=$((SIGN_COUNT + 1))
    fi
done
echo "    Signed $SIGN_COUNT libraries"

# Sign all plugins
echo "  Signing lib/gstreamer-1.0/*.dylib ..."
SIGN_COUNT=0
for plugin in "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib; do
    [[ -f "$plugin" ]] || continue
    if sign_binary "$plugin"; then
        SIGN_COUNT=$((SIGN_COUNT + 1))
    fi
done
echo "    Signed $SIGN_COUNT plugins"

# Sign libexec binaries
echo "  Signing libexec/* ..."
for libexec_bin in "$OUT_ROOT/libexec/gstreamer-1.0/"*; do
    [[ -f "$libexec_bin" ]] || continue
    sign_binary "$libexec_bin"
done
echo "    Done"

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
    echo "    Try running manually: $OUT_ROOT/bin/gst-inspect-1.0 --version"
fi

# Check for applemedia plugin (provides VideoToolbox encoders)
echo ""
echo "Checking Apple media support..."
if [[ -f "$OUT_ROOT/lib/gstreamer-1.0/libgstapplemedia.dylib" ]]; then
    echo "  ✓ libgstapplemedia.dylib present"
    
    # Try to load the plugin
    APPLEMEDIA_OUTPUT=$("$OUT_ROOT/bin/gst-inspect-1.0" applemedia 2>&1) || true
    if echo "$APPLEMEDIA_OUTPUT" | grep -q "Plugin Details"; then
        echo "  ✓ applemedia plugin loads successfully"
        # List available elements
        ELEMENTS=$(echo "$APPLEMEDIA_OUTPUT" | grep -E "^\s+vtenc|^\s+vtdec|^\s+avf" | head -10)
        if [[ -n "$ELEMENTS" ]]; then
            echo "    Available elements:"
            echo "$ELEMENTS" | while read -r line; do echo "      $line"; done
        fi
    else
        echo "  ⚠ applemedia plugin failed to load"
        # Show error if any
        ERRORS=$(echo "$APPLEMEDIA_OUTPUT" | grep -i "error\|failed\|not loaded" | head -5)
        if [[ -n "$ERRORS" ]]; then
            echo "    Errors:"
            echo "$ERRORS" | while read -r line; do echo "      $line"; done
        fi
    fi
else
    echo "  ⚠ libgstapplemedia.dylib not found in bundle"
fi

# Check for VideoToolbox H.265 encoder specifically
if "$OUT_ROOT/bin/gst-inspect-1.0" vtenc_h265 >/dev/null 2>&1; then
    echo "  ✓ vtenc_h265 (VideoToolbox H.265 encoder) available"
else
    echo "  ⚠ vtenc_h265 not found - VideoToolbox H.265 encoding not available"
    # Check if we at least have x265
    if "$OUT_ROOT/bin/gst-inspect-1.0" x265enc >/dev/null 2>&1; then
        echo "    (x265enc software encoder is available as fallback)"
    fi
fi

echo ""
echo "========================================"
echo "✓ macOS GStreamer bundle created at: $OUT_ROOT"
echo ""

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "$OUT_ROOT" 2>/dev/null | awk '{print $1}' || echo "unknown")
BIN_COUNT=$(ls -1 "$OUT_ROOT/bin/" 2>/dev/null | wc -l | tr -d ' ')
LIB_COUNT=$(ls -1 "$OUT_ROOT/lib/"*.dylib 2>/dev/null | wc -l | tr -d ' ')
PLUGIN_COUNT=$(ls -1 "$OUT_ROOT/lib/gstreamer-1.0/"*.dylib 2>/dev/null | wc -l | tr -d ' ')

echo "Bundle contents:"
echo "  - $BIN_COUNT binaries"
echo "  - $LIB_COUNT libraries"
echo "  - $PLUGIN_COUNT plugins"
echo "  - Total size: $BUNDLE_SIZE"
echo ""
echo "Size optimization:"
echo "  - Unnecessary plugins excluded (network, audio effects, subtitles, etc.)"
echo "  - Python plugin excluded (causes timeouts, not needed)"
echo "  - This reduces bundle size while maintaining all video encoding features"
echo ""
echo "Next steps:"
echo "  1. Build your macOS app: npm run build:mac"
echo "  2. The bundle will be included in the app automatically"
echo ""
echo "Note: If you encounter 'No such element' errors, you may need to add"
echo "      specific plugins back. Check the exclusion list in this script."
echo "========================================"
