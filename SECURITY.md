# Security Policy

## Supported versions

The latest commit on `main` is the only supported version. There are no LTS branches.

## Reporting a vulnerability

**Do not open a public issue or pull request for security problems.**

Instead, report privately via either:

- **GitHub Security Advisories** — preferred. Open <https://github.com/dawoodtrumboo/claude-video-export/security/advisories/new>. This stays private until a fix is published.
- **Email** — `dev@tripdocks.com` with subject prefix `[claude-video-export security]`.

Please include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce (or a minimal proof-of-concept).
- The commit SHA you tested against.
- Your contact for follow-up (optional).

## What to expect

- Acknowledgement of your report within **3 business days**.
- A triage decision (accepted / not a vulnerability / needs more info) within **7 business days**.
- A fix, mitigation, or coordinated disclosure timeline communicated back to you.

## Scope

This is a **local-only** tool — the bundled web server (`server.mjs`) binds to `127.0.0.1` and is intended for use on the operator's own machine. In scope:

- Path-traversal in uploaded project folders.
- Sandbox escape from the headless Chromium render context.
- Code execution via crafted `animations.jsx` / `index.html` payloads.
- Dependency vulnerabilities (Playwright, ffmpeg-static) affecting the tool when used as documented.

Out of scope:

- Exposing the server to a public network (do not do this — the tool isn't designed for it).
- Issues that require a malicious user to already have local code execution on the machine running the exporter.
- Anything in third-party Claude Design / Claude Artifact projects passed in as input — those are user-supplied content.

## Credit

Responsible reports get credit in the release notes for the fix, unless you'd rather stay anonymous.
