# Electron UI template with antd

An Electron application with React and TypeScript.
Showcases the AntD React UI Library
Developed for quickly spinning up functional desktop UIs.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ yarn
```

### GStreamer Setup

This application bundles GStreamer to avoid requiring users to install third-party dependencies.

**Automatic Setup (Recommended):**

```bash
# Download and extract GStreamer binaries
$ npm run download-gstreamer
```

This will automatically download and extract GStreamer for your platform. The script runs automatically before building.

**Manual Setup:**
If automatic setup fails, see [docs/GSTREAMER_SETUP.md](docs/GSTREAMER_SETUP.md) for manual installation instructions.

### Development

```bash
$ yarn dev
```

### Build

```bash
# For windows
$ yarn build:win

# For macOS
$ yarn build:mac

# For Linux
$ yarn build:linux
```

**Note:** GStreamer is automatically included in the build. Ensure you've run `npm run download-gstreamer` before building.

## CI/CD and Releases

This project uses GitHub Actions for automated builds and releases. See [docs/CI_CD.md](docs/CI_CD.md) for details.

**Creating a release:**

```bash
npm run release-patch   # 1.0.0 -> 1.0.1
npm run release-minor   # 1.0.0 -> 1.1.0
npm run release-major   # 1.0.0 -> 2.0.0
```

This automatically builds for Windows, macOS, and Linux, and creates a GitHub Release with downloadable installers.
