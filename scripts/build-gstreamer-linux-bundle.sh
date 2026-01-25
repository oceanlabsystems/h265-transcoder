#!/bin/bash
# Build a portable-ish Linux GStreamer bundle using an Ubuntu 20.04 baseline.
#
# Output layout (consumed by runtime resolver):
#   gstreamer/linux/
#     bin/        (gst-launch-1.0, gst-inspect-1.0, gst-discoverer-1.0, ...)
#     lib/        (libgstreamer-1.0.so*, libgst*.so*, and plugins under lib/gstreamer-1.0/)
#     libexec/    (gst-plugin-scanner when available)
#
# Notes:
# - We intentionally DO NOT bundle glibc. Building on Ubuntu 20.04 ensures GLIBC compatibility
#   with newer distros (glibc is backward compatible, not forward compatible).
# - This bundle is best-effort; Linux distros vary. Keep system fallback enabled at runtime.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

OUT_ROOT="$PROJECT_DIR/gstreamer/linux"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to build the Linux GStreamer bundle."
  echo "Install Docker, then re-run:"
  echo "  sudo apt install -y docker.io && sudo usermod -aG docker \$USER"
  exit 1
fi

echo "========================================"
echo "Building Linux GStreamer bundle (Ubuntu 20.04)"
echo "Output: $OUT_ROOT"
echo "========================================"

if [ -d "$OUT_ROOT" ]; then
  # Best-effort to avoid permission issues from prior root-owned docker outputs
  chmod -R u+rwX "$OUT_ROOT" 2>/dev/null || true
fi
rm -rf "$OUT_ROOT" 2>/dev/null || {
  if command -v sudo >/dev/null 2>&1; then
    echo "Previous bundle appears root-owned; retrying cleanup with sudo..."
    sudo rm -rf "$OUT_ROOT"
  else
    echo "ERROR: Unable to remove existing bundle at $OUT_ROOT (permission denied)."
    echo "Please delete it manually (may require sudo) and re-run."
    exit 1
  fi
}
mkdir -p "$OUT_ROOT"

# Build inside Ubuntu 20.04 to lock glibc baseline (2.31)
# Run as root to install packages, then fix permissions afterward
HOST_UID=$(id -u)
HOST_GID=$(id -g)

docker run --rm -i \
  -e HOST_UID="$HOST_UID" \
  -e HOST_GID="$HOST_GID" \
  -v "$PROJECT_DIR:/work" \
  ubuntu:20.04 \
  bash <<'DOCKER_SCRIPT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Install packages as root
# Include VA-API plugins for hardware encoding (msdkh265enc, vaapih265enc)
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav \
  gstreamer1.0-vaapi

mkdir -p /work/gstreamer/linux/bin /work/gstreamer/linux/lib /work/gstreamer/linux/libexec

# Binaries
cp -a /usr/bin/gst-* /work/gstreamer/linux/bin/ || true

# Plugins (Ubuntu/Debian layout)
if [ -d /usr/lib/x86_64-linux-gnu/gstreamer-1.0 ]; then
  mkdir -p /work/gstreamer/linux/lib/gstreamer-1.0
  cp -a /usr/lib/x86_64-linux-gnu/gstreamer-1.0/* /work/gstreamer/linux/lib/gstreamer-1.0/
  
  # Verify critical plugins are included
  echo "Verifying critical plugins are bundled..."
  if [ -f /work/gstreamer/linux/lib/gstreamer-1.0/libgstvaapi.so ]; then
    echo "  ✓ libgstvaapi.so found"
  else
    echo "  ✗ WARNING: libgstvaapi.so not found in bundle!"
  fi
  if [ -f /work/gstreamer/linux/lib/gstreamer-1.0/libgstmsdk.so ]; then
    echo "  ✓ libgstmsdk.so found"
  else
    echo "  ✗ WARNING: libgstmsdk.so not found in bundle!"
  fi
fi

# Core libs (best-effort: copy GStreamer-related libs; do NOT copy libc)
# Include VA-API libraries for hardware encoding support
if [ -d /usr/lib/x86_64-linux-gnu ]; then
  find /usr/lib/x86_64-linux-gnu -maxdepth 1 -type f \( \
    -name 'libgstreamer-*.so*' -o \
    -name 'libgst*.so*' -o \
    -name 'liborc-*.so*' -o \
    -name 'libffi.so*' -o \
    -name 'libglib-2.0.so*' -o \
    -name 'libgobject-2.0.so*' -o \
    -name 'libgmodule-2.0.so*' -o \
    -name 'libgio-2.0.so*' -o \
    -name 'libgthread-2.0.so*' -o \
    -name 'libgirepository-1.0.so*' -o \
    -name 'libva*.so*' -o \
    -name 'libdrm.so*' \
  \) -print0 | xargs -0 -I{} cp -a {} /work/gstreamer/linux/lib/ || true
fi

# Plugin scanner (location varies by distro/build)
if [ -f /usr/libexec/gstreamer-1.0/gst-plugin-scanner ]; then
  mkdir -p /work/gstreamer/linux/libexec/gstreamer-1.0
  cp -a /usr/libexec/gstreamer-1.0/gst-plugin-scanner /work/gstreamer/linux/libexec/gstreamer-1.0/
fi

if [ -f /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner ]; then
  mkdir -p /work/gstreamer/linux/libexec/gstreamer-1.0
  cp -a /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner /work/gstreamer/linux/libexec/gstreamer-1.0/
fi

echo 'Collecting and bundling shared-library dependencies (ldd closure)...'

BUNDLE_ROOT=/work/gstreamer/linux
LIBDIR="$BUNDLE_ROOT/lib"
PLUGINDIR="$BUNDLE_ROOT/lib/gstreamer-1.0"
BINDIR="$BUNDLE_ROOT/bin"

mkdir -p "$LIBDIR"

# Libraries we should NOT bundle (glibc + loader + kernel/vdso)
should_skip_lib() {
  case "$1" in
    *linux-vdso.so.*) return 0 ;;
    */ld-linux-*.so.*) return 0 ;;
    */libc.so.6) return 0 ;;
    */libm.so.*) return 0 ;;
    */libpthread.so.*) return 0 ;;
    */librt.so.*) return 0 ;;
    */libdl.so.*) return 0 ;;
  esac
  return 1
}

copy_lib() {
  src="$1"
  if [ ! -f "$src" ]; then
    return 0
  fi
  if should_skip_lib "$src"; then
    return 0
  fi
  base=$(basename "$src")
  if [ -e "$LIBDIR/$base" ]; then
    return 0
  fi
  cp -a "$src" "$LIBDIR/"

  # If it's a symlink, also copy its real target (best-effort)
  if [ -L "$src" ]; then
    real=$(readlink -f "$src" || true)
    if [ -n "$real" ] && [ -f "$real" ]; then
      realbase=$(basename "$real")
      if [ ! -e "$LIBDIR/$realbase" ] && ! should_skip_lib "$real"; then
        cp -a "$real" "$LIBDIR/"
      fi
    fi
  fi
}

deps_for() {
  f="$1"
  # ldd output varies; capture only absolute paths of resolved libs
  ldd "$f" 2>/dev/null | awk '
    /=>/ { if ($3 ~ /^\//) print $3 }
    /^[[:space:]]*\// { print $1 }
  ' | sort -u
}

# Iterate a few times to capture transitive deps of newly copied libs.
for i in 1 2 3 4 5; do
  changed=0

  # Check binaries + plugins + already-copied libs
  targets=$(find "$BINDIR" "$PLUGINDIR" "$LIBDIR" -type f 2>/dev/null || true)
  for t in $targets; do
    for dep in $(deps_for "$t"); do
      base=$(basename "$dep")
      if [ ! -e "$LIBDIR/$base" ] && ! should_skip_lib "$dep"; then
        copy_lib "$dep"
        changed=1
      fi
    done
  done

  if [ "$changed" -eq 0 ]; then
    break
  fi
done

echo 'Dependency bundling complete.'

echo 'Bundle created. Verifying bundled gst-inspect runs (inside container)...'
/work/gstreamer/linux/bin/gst-inspect-1.0 --version || true

# Fix ownership of output files to match host user
chown -R "$HOST_UID:$HOST_GID" /work/gstreamer/linux || true
DOCKER_SCRIPT

echo ""
echo "✓ Linux GStreamer bundle written to: $OUT_ROOT"
echo "Next: build your Linux app (AppImage/DEB) and test on your target distro."

