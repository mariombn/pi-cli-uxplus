# Changelog

## 0.1.2

- Fix startup/render crashes from passing hex strings as theme token names: parse custom background colors into concrete Color objects.
- Fall back to native message backgrounds if a cosmetic painter fails.
- Cover the production color helper with real native Markdown in dark/light themes, and run the real-Pi PTY test with a pre-existing user message.

- Tint user chat messages with a muted red background; centralize dark/light colors in `USER_MESSAGE_BACKGROUND`. Restore native backgrounds when disabled.

- Centralize workspace color in `appearance.ts` (`WORKSPACE_COLOR`).
- Apply the shared red to the native Working text and spinner, both standalone and embedded in the prompt border; preserve retry/compaction colors.

- Use red panel borders, with bold borders for the focused panel.
- Add a closed red prompt frame around the existing native editor, preserving cursor/IME markers, autocomplete and mouse coordinate mapping.

- Remove blank vertical gaps between sidebar cards; upper cards use all remaining rows.
- Add regression coverage for exact sidebar heights at 24, 40, 60 and 61 terminal rows.

## 0.1.1

Initial public repository release.

- Three-column fullscreen workspace with responsive sidebars.
- Keyboard file navigation, bounded path search, clipboard integration and text preview.
- Prefilled rename, trash support and confirmed permanent deletion.
- Project/Git/instruction-file information and session usage metrics.
- Session selection, rename and deletion.
- Optional event-based pi-subagents monitor.
- Native-layout recovery with `/workspace-off`.
- Fix Kitty keyboard release and auto-repeat events toggling panel focus twice.
- Automated filesystem/layout/focus tests and a real-Pi Linux PTY smoke test.
- Pi package manifest, MIT license, installation docs and CI.

## 0.1.0

Personal workspace prototype, prior to the public repository.
