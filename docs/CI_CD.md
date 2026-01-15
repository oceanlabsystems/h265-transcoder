# CI/CD Build and Release

This project uses GitHub Actions to automatically build and release the application for Windows, macOS, and Linux.

## How It Works

### Automatic Builds

The CI workflow (`.github/workflows/build.yml`) automatically triggers when:

1. **Tagged Releases**: Push a version tag (e.g., `v1.0.0`) to trigger builds for all platforms
2. **Manual Trigger**: Use the "Run workflow" button in GitHub Actions

### Build Process

For each platform:

1. **Windows**:
   - Downloads and extracts GStreamer MSI
   - Builds NSIS installer (.exe)
   - Uploads to artifacts

2. **macOS**:
   - Downloads macOS GStreamer .pkg
   - Extracts GStreamer framework
   - Builds DMG installer
   - Uploads to artifacts

3. **Linux (Ubuntu)**:
   - Installs GStreamer via system packages
   - Builds AppImage and DEB packages
   - Uploads to artifacts

### Release Process

When a version tag is pushed (e.g., `v1.0.0`):

1. All three platforms build in parallel
2. Artifacts are uploaded
3. A GitHub Release is automatically created
4. Installers are attached to the release for download

## Creating a Release

### Option 1: Using npm scripts (Recommended)

```bash
# Patch release (1.0.0 -> 1.0.1)
npm run release-patch

# Minor release (1.0.0 -> 1.1.0)
npm run release-minor

# Major release (1.0.0 -> 2.0.0)
npm run release-major
```

These scripts will:
- Update version in `package.json`
- Generate/update `CHANGELOG.md`
- Create a git tag
- Push to the repository
- Trigger CI/CD builds

### Option 2: Manual Tag

```bash
# Update version in package.json manually
# Then create and push tag:
git tag v1.0.0
git push origin v1.0.0
```

### Option 3: GitHub UI

1. Go to **Releases** → **Draft a new release**
2. Create a new tag (e.g., `v1.0.0`)
3. Add release notes
4. Publish release
5. CI will build and attach installers

## Downloading Artifacts

### From GitHub Actions

1. Go to **Actions** tab
2. Click on the latest workflow run
3. Scroll down to **Artifacts**
4. Download:
   - `windows-installer` - Windows .exe installer
   - `macos-installer` - macOS .dmg file
   - `linux-installer` - Linux AppImage and DEB

### From GitHub Release

1. Go to **Releases** page
2. Click on the release version
3. Download installers from the **Assets** section

## Build Configuration

### Platform-Specific Settings

- **Windows**: NSIS installer with x64 architecture
- **macOS**: Universal DMG (x64 + ARM64)
- **Linux**: AppImage and DEB packages for x64

### GStreamer Handling

- **Windows**: Bundled GStreamer from MSI extraction
- **macOS**: Bundled GStreamer framework
- **Linux**: Uses system-installed GStreamer (not bundled)

## Troubleshooting

### Build Fails

1. Check the workflow logs in GitHub Actions
2. Verify GStreamer download/extraction succeeded
3. Ensure all dependencies are listed in `package.json`

### Missing Artifacts

- Artifacts are retained for 90 days
- Check if the build step completed successfully
- Verify file paths match the upload patterns

### Release Not Created

- Ensure the tag starts with `v` (e.g., `v1.0.0`)
- Check that all build jobs completed successfully
- Verify `GITHUB_TOKEN` has release permissions

## Manual Builds

If you need to build locally:

```bash
# Windows
npm run build:win64

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Note: macOS builds require a macOS machine. Windows builds require Windows.
