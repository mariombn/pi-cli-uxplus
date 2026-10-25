# Contributing

This is an early release targeting Pi 1.4.0. Small, focused pull requests are welcome.

## Setup

Use Node.js 22.19+ and Git. On Linux, install Python 3 for the terminal smoke test.

```bash
npm ci
npm test
npm run test:terminal
```

Try changes with `pi --no-extensions -e ./index.ts --tui-mode fullscreen` to avoid duplicate installed copies. Do not submit an actual LLM prompt during unattended terminal tests.

## Structure

- `index.ts`: extension lifecycle, panels, focus, commands, and event integration.
- `files.ts`: bounded filesystem operations and previews.
- `dialogs.ts`: prefilled rename input with focus/IME support.
- `layout.ts`: version-sensitive Pi layout adapter; keep internal API access isolated here.
- `tests/`: filesystem/layout/focus regression tests and Linux PTY test.

## Expectations

- Preserve the native transcript ScrollView and prompt text/cursor.
- Add regression tests for focus bugs, including Kitty press/repeat/release events.
- Validate narrow terminals, resize, overlays, and teardown.
- Keep filesystem operations constrained to the workspace root.
- Never silently turn a failed trash operation into permanent deletion.
- Do not bundle host-provided Pi packages as runtime dependencies.
- Do not add telemetry, network calls, model calls, or subprocess watchers without documenting the need.
- Document compatibility changes and user-visible behavior in the changelog.

For bugs, include Pi version, OS, terminal, dimensions, shortcut sequence and reproduction steps. Redact credentials, private paths, prompts and session data.

Contributions are provided under this repository's MIT license.
