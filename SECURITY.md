# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please send an email to [support@oceanlabsystems.com](mailto:support@oceanlabsystems.com) with:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any possible mitigations you've identified

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
- **Updates**: We will provide updates on our progress within 5 business days.
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days.
- **Credit**: We will credit you in the release notes (unless you prefer to remain anonymous).

### Scope

This security policy applies to:

- The H265 Transcoder desktop application
- The source code in this repository
- Build and release artifacts

### Out of Scope

- Vulnerabilities in third-party dependencies (please report these to the respective maintainers)
- Social engineering attacks
- Physical security issues

## Security Considerations

### Application Security

- **Context Isolation**: The Electron app uses context isolation to separate renderer processes from Node.js APIs.
- **IPC Whitelisting**: Only explicitly whitelisted IPC channels are exposed to the renderer process.
- **No Remote Content**: The application does not load remote content or execute remote code.

### Local Processing

- **Local Only**: All video processing happens locally on your machine.
- **No Data Collection**: The application does not collect, transmit, or store any user data externally.
- **No Network Requests**: The application does not make network requests during operation (except for optional auto-update checks if enabled).

### File System Access

- **User-Directed**: File system access is limited to directories explicitly selected by the user.
- **Sandboxed Processing**: Video files are processed through GStreamer pipelines with limited system access.

## Best Practices for Users

1. **Download from Official Sources**: Only download releases from the official GitHub releases page.
2. **Verify Signatures**: When available, verify download signatures.
3. **Keep Updated**: Use the latest version to benefit from security fixes.
4. **Report Issues**: Report any suspicious behavior or security concerns.

Thank you for helping keep H265 Transcoder secure!
