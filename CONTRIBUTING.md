# Contributing to H265 Transcoder

Thank you for your interest in contributing to H265 Transcoder! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **System information**:
  - OS and version
  - Application version
  - Hardware encoder availability (NVIDIA/Intel)
  - GStreamer version (if known)

### Suggesting Enhancements

Enhancement suggestions are welcome! Please include:

- **Clear title** describing the enhancement
- **Detailed description** of the proposed functionality
- **Use case** explaining why this would be useful
- **Possible implementation** if you have ideas

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the code style** - run `npm run lint` and `npm run format`
3. **Write meaningful commits** using conventional commits (see below)
4. **Test your changes** thoroughly
5. **Update documentation** if needed
6. **Submit a pull request** with a clear description

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Getting Started

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/h265-transcoder.git
cd h265-transcoder

# Install dependencies
npm install

# Download GStreamer
npm run download-gstreamer

# Start development server
npm run dev
```

### Code Style

This project uses:

- **TypeScript** with strict mode
- **ESLint** for linting
- **Prettier** for formatting

Run these before committing:

```bash
npm run lint      # Check and fix linting issues
npm run format    # Format code with Prettier
npm run typecheck # Verify TypeScript types
```

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Use the commit helper:

```bash
npm run commit
```

Or format manually:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(encoder): add VP9 encoder support
fix(progress): correct ETA calculation for large files
docs(readme): update installation instructions
```

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── gstreamer/  # GStreamer pipeline implementations
│   ├── types/      # TypeScript type definitions
│   └── utils/      # Utility functions
├── preload/        # Preload scripts (IPC bridge)
└── renderer/       # React frontend
    └── src/
```

### Testing

Currently, manual testing is recommended:

1. Test with various video formats (MP4, MKV, MOV, AVI)
2. Test different file sizes (small, large, very large)
3. Test all encoder options (x265, nvh265, qsvh265)
4. Verify progress tracking accuracy
5. Test error handling scenarios

### Building

```bash
# Development build
npm run build

# Platform-specific builds
npm run build:win64   # Windows 64-bit
npm run build:win32   # Windows 32-bit
npm run build:mac     # macOS
npm run build:linux   # Linux
```

## Questions?

If you have questions, feel free to:

- Open an issue with the "question" label
- Check existing documentation in the `docs/` folder

Thank you for contributing! 🎉
