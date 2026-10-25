# Pi CLI UX+

A keyboard-first, three-column workspace for [Pi](https://pi.dev): file navigation and project information on the left, the native chat in the center, sessions and subagent monitoring on the right.

**Early release · tested with Pi 1.4.0 · fullscreen required.** Interface labels currently use Brazilian Portuguese.

[Português](README.pt-BR.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)

```text
┌─ FILES ──────────┬─ CHAT ─────────────────────┬─ SESSIONS ─────────┐
│ Tree / search   │ Native conversation       │ Current session ●  │
│                 │ and tool output           │ Recent sessions    │
├─ PROJECT ───────┤                           ├─ SUBAGENTS ────────┤
│ Root, Git       │                           │ Running / attention│
│ Instruction docs├─ PROMPT ──────────────────┤ Completed / failed │
│ Model and usage │ Your text stays intact    │ Run details        │
└─────────────────┴───────────────────────────┴────────────────────┘
```

## Install

```bash
pi install git:github.com/mariombn/pi-cli-uxplus
```

Then restart Pi, or run `/reload`. For a pinned, reproducible version:

```bash
pi install git:github.com/mariombn/pi-cli-uxplus@v0.1.2
```

Run in fullscreen mode:

```bash
pi --tui-mode fullscreen
```

**Migrating from the original personal `session-sidebar` extension?** Move its directory out of `~/.pi/agent/extensions/` before installing this package. Do not load both copies: they register the same shortcuts and layout integration. Keep your backup outside the auto-loaded extensions directory.

Update an unpinned installation with `pi update --extensions`. Pinned tags stay pinned. To uninstall, use `pi remove git:github.com/mariombn/pi-cli-uxplus` with the source you originally installed, then restart Pi.

## Features

- Real side-by-side layout on wide terminals, not overlays covering the chat.
- File tree sorted by directory, extension, and name; bounded recursive path search.
- Copy a project-relative path to the system clipboard and return to the prompt.
- File preview outside the conversation; rename and confirmed deletion.
- Project root, Git status, root-level instruction file timestamps, model and usage metrics.
- Project sessions sorted by latest activity, with rename and confirmed deletion.
- Optional live event integration with `pi-subagents`; no subagents are started by this extension.
- Responsive sidebars, explicit focus indicators, and a command to restore Pi's native layout.

## Appearance

`appearance.ts` defines `WORKSPACE_COLOR`, currently the active theme's `error` (red) token. Panel borders, the prompt frame, and the native Working text/spinner share this color. Retry/compaction status colors stay native. `USER_MESSAGE_BACKGROUND` in the same file defines muted red backgrounds for dark/light themes, applied only to user messages in the chat. Assistant and tool messages retain their native backgrounds. Change these constants and run `/reload` to experiment. Disabling the workspace restores native user-message backgrounds.

## Keyboard controls

| Shortcut | Action |
|---|---|
| **Alt+N** | Toggle file browser ↔ prompt |
| **Alt+S** | Toggle sessions ↔ prompt |
| **Alt+A** | Toggle subagents ↔ prompt |
| **Alt+1 / Alt+3** | Toggle left/right column visibility |
| **Esc** | Return to the prompt, or close a preview/dialog |

The active panel has an accented border; `❯` marks the selection and `●` the current session. Prompt text and cursor position are preserved. Kitty keyboard release events are ignored, and auto-repeat does not repeatedly toggle focus.

### File browser

| Key | Action |
|---|---|
| ↑ / ↓, Home / End | Select an item |
| → / ← | Expand / collapse or select the parent |
| Enter on a directory | Expand/collapse |
| Enter on a file | Copy relative path and return to prompt |
| C | Copy file/directory path and return to prompt |
| Space | Preview the selected file |
| R | Rename, with the current name prefilled |
| Delete | Choose cancel, trash, or permanent deletion |
| / | Search relative paths recursively |
| . | Show/hide dotfiles |

Expanding folders does **not** change the agent's working directory. Copying does not paste or submit a prompt. Clipboard support follows Pi's native implementation and the terminal environment; a failed copy does not pretend to succeed.

Search is case-insensitive substring matching over relative paths. Arrow keys leave text entry and navigate results. Enter copies the selection. Esc clears the filter; another Esc returns to the prompt. Searches are bounded to 1,500 visited directories, 3,000 results, and depth 24, with a visible limit notice.

Directories precede files; files are grouped by extension and then name. `.git`, `node_modules`, `.venv`, and `__pycache__` are excluded. This version does **not** implement full `.gitignore` matching. Symlink directories are not traversed.

### Preview

Space opens a text preview in the center column without adding anything to the conversation or sending it to the model. ↑/↓, PageUp/PageDown and Home/End scroll. Esc returns to the previous selection. Enter copies the path when previewing a browser file.

Previews are limited to 128 KiB / 2,000 lines. Binary files show metadata. Terminal control characters are sanitized; external symlink targets are blocked.

### File mutation safety

- Mutations are constrained to the workspace root, including real-path validation of parent directories.
- The root itself cannot be renamed or deleted.
- Renaming accepts a name, not a path; an existing destination is rejected at the preflight check. Imports are not rewritten.
- The destination check and OS rename are not an atomic no-overwrite transaction: avoid concurrent writers to the same paths.
- Removing a symlink removes the link, not its target.
- Nonempty directories require typing their name before deletion.
- Trash uses **`gio trash` on Linux**. Missing or failed trash support never silently falls back to permanent deletion.
- Permanent deletion requires another explicit confirmation and has no undo.
- File operations are not blocked while the agent is running. Avoid modifying files that another process or agent is writing.

### Project information

Shows the workspace root, Git branch/change count, the presence and modification dates of `AGENTS.md` / `CLAUDE.md` **in the root**, model, thinking level, context percentage, message token totals, and reported cost. File presence does not mean Pi loaded the file's instructions. Costs are reported message totals, not a subscription billing estimate.

Native footer information is moved out of the central prompt area; extension statuses and widgets appear in the project area when space permits. On short terminals, excess project information may be clipped. Tests are never run automatically.

### Sessions

Lists sessions for the current working directory in descending `SessionInfo.modified` order. Ordering stays stable while the panel has focus.

↑/↓ and Home/End select; Enter opens; R/Ctrl+R rename; Delete/D delete after confirmation. Wait until the agent is idle to switch or mutate sessions. Open another session before deleting the current one. Session deletion permanently removes its JSONL file, not project files. Do not mutate a session open in another Pi process.

### Subagents (optional)

Works with `pi-subagents` events: `async-started`, `child-status`, `control-event`, `async-complete`, and `foreground-complete`. Install that extension separately if you want subagent monitoring. The workspace works without it.

Shows agent, task/latest activity, state, and duration. ↑/↓ select; Enter opens the received run details. States: ○ pending, ◐ running, ! attention, ✓ completed, × failed, ■ stopped. No stop/steer controls are exposed.

Monitoring covers **events received since activation**. It does not restore runs predating `/reload`, and cannot show information the installed `pi-subagents` version does not emit. Up to 100 records are retained, evicting old terminal records when possible. Tests simulate these events; they do not launch real subagents.

## Responsive layout

- **140+ columns:** three columns.
- **100–139:** chat + left column; right panels open temporarily by shortcut.
- **Below 100:** chat, with temporary panels via shortcuts.
- Manually hidden columns are still accessible by shortcut.
- Upper panels use the remaining vertical space without gaps; lower panels reserve roughly one third of the height, with a 12-row minimum when space permits.

## Recovery and compatibility

- `/workspace`: shortcut help.
- `/workspace-off`: restore the native layout, footer, and widgets.
- `/reload`: activate again.
- `/sessions`: focus sessions.
- `/sessions-hide`: toggle the right column.

This extension preserves the native transcript `ScrollView`, rather than replacing chat scrolling, search, or selection. It does not modify Pi's installed files, replace the editor, or start a second terminal renderer. RPC, JSON, and print modes do not mount the workspace.

**Compatibility caveat:** layout mounting uses `ViewportTUI.setLayoutRoot()`, but obtaining the current root and its layout nodes, and overriding the native user-message Markdown background callback, requires a guarded **internal adapter in `layout.ts`**. Only Pi 1.4.0 has been tested. If the expected structure changes, the adapter refuses to mount. New Pi releases require retesting; do not combine this with another root-layout modifier.

## Development

Node.js 22.19+ and Git are required. Python 3 is needed only for the Linux PTY test.

```bash
git clone https://github.com/mariombn/pi-cli-uxplus.git
cd pi-cli-uxplus
npm ci
npm test
npm run test:terminal
```

`npm test` uses temporary directories to test file guards, sorting, search, preview, rename/delete, five terminal widths, native scroll preservation, focus cycles, Kitty press/repeat/release events, narrow overlays, simulated subagent events, and teardown.

`npm run test:terminal` launches real Pi in a Linux pseudoterminal with an ephemeral session. It tests focus, Kitty events, a prefilled rename, cancelled deletion, preview, layout recovery and clean exit. It does not submit an LLM prompt or alter the user's clipboard. `PI_NODE_MODULES` and `PI_BIN` can override dependency/executable discovery.

Try the checkout with `pi --no-extensions -e ./index.ts --tui-mode fullscreen`; `--no-extensions` avoids loading another installed copy during development. Review code before installing extensions: they execute with your OS permissions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report your Pi version, OS, terminal, dimensions, and whether your terminal uses the Kitty keyboard protocol. Never include credentials, session transcripts, or private project contents in issue attachments.

## License

[MIT](LICENSE) © Mario de Moraes.
