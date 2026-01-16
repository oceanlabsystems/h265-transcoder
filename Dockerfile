# H265 Transcoder CLI - Docker Image
# Lightweight image for headless video transcoding

FROM node:20-slim

LABEL maintainer="Oceanlab Systems <support@oceanlabsystems.com>"
LABEL description="H265 Video Transcoder - Automated batch transcoding service"

# Install GStreamer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts

# Copy CLI code
COPY out/cli ./cli
COPY installer/service/config.example.yaml ./config.example.yaml

# Create directories for volumes
RUN mkdir -p /input /output /config

# Default config location
ENV CONFIG_PATH=/config/config.yaml

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('OK')" || exit 1

# Run the CLI in watch mode
ENTRYPOINT ["node", "cli/cli/index.js"]
CMD ["--config", "/config/config.yaml", "--watch"]
