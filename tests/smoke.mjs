import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
let modules = process.env.PI_NODE_MODULES;
if (!modules) {
  try {
    const require = createRequire(import.meta.url);
    modules = resolve(dirname(require.resolve('@earendil-works/pi-coding-agent')), '../../..');
  } catch {
    const version = (await readFile(join(homedir(), '.pi/agent/install/current-version'), 'utf8')).trim();
    modules = join(homedir(), '.pi/agent/install/releases', version, 'node_modules');
  }
}
const load = path => import(pathToFileURL(join(modules, path)).href);
const { loadExtensions, createExtensionRuntime } = await load('@earendil-works/pi-coding-agent/dist/core/extensions/loader.js');
const { createEventBus } = await load('@earendil-works/pi-coding-agent/dist/core/event-bus.js');
const { VStack, ScrollView, visibleWidth } = await load('@earendil-works/pi-tui/dist/index.js');
const { VIEWPORT_TUI } = await load('@earendil-works/pi-tui/dist/tui.js');
const { renderLayoutFrame } = await load('@earendil-works/pi-tui/dist/layout.js');
const { createJiti } = await load('jiti/lib/jiti.mjs');
const jiti = createJiti(import.meta.url);
const fsModel = await jiti.import(join(project, 'files.ts'));

const root = await mkdtemp(join(tmpdir(), 'pi-workspace-test-'));
const outside = await mkdtemp(join(tmpdir(), 'pi-workspace-outside-'));
let extension, ctx;
try {
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'README.md'), 'hello\n');
  await writeFile(join(root, 'src', 'app.ts'), 'export const answer = 42;\n');
  await writeFile(join(root, 'AGENTS.md'), 'project instructions');
  await writeFile(join(root, '.hidden'), 'hidden test fixture');
  await writeFile(join(outside, 'keep.txt'), 'keep');
  await symlink(outside, join(root, 'external'));
  const sorted = await fsModel.children(root, root, false);
  assert.equal(sorted[0].name, 'src');
  assert(!sorted.some(i => i.name === 'node_modules' || i.name === '.hidden'));
  assert((await fsModel.children(root, root, true)).some(i => i.name === '.hidden'));
  assert(!(await fsModel.tree(root, new Set(), false)).items.some(i => i.name === 'app.ts'));
  assert((await fsModel.tree(root, new Set(), false, 'app.ts')).items.some(i => i.name === 'app.ts'));
  assert((await fsModel.preview(root, join(root, 'src/app.ts')))[0].includes('42'));
  await assert.rejects(fsModel.safePath(root, root));
  await assert.rejects(fsModel.safePath(root, join(root, 'external/keep.txt')));
  await assert.rejects(fsModel.preview(root, join(root, 'external/keep.txt')));
  await assert.rejects(fsModel.renameItem(root, join(root, 'README.md'), '../escape'));
  await assert.rejects(fsModel.renameItem(root, join(root, 'README.md'), 'AGENTS.md'));
  await fsModel.renameItem(root, join(root, 'README.md'), 'README2.md');
  await fsModel.deleteItem(root, join(root, 'README2.md'));
  await access(join(outside, 'keep.txt'));
  await fsModel.deleteItem(root, join(root, 'external'));
  await access(join(outside, 'keep.txt')); // removing a link must not touch its target

  const runtime = createExtensionRuntime();
  runtime.getThinkingLevel = () => 'medium';
  const bus = createEventBus();
  const result = await loadExtensions([join(project, 'index.ts')], root, bus, runtime);
  assert.deepEqual(result.errors, []);
  extension = result.extensions[0];
  const empty = { render: () => [], invalidate() {} };
  const editor = { render: () => ['> prompt preservado'], invalidate() {}, handleInput() {} };
  const footer = { render: () => ['path', 'stats', 'extension status'], invalidate() {} };
  const transcript = new ScrollView({ render: () => Array.from({ length: 100 }, (_, i) => `chat ${i}`), invalidate() {} }, { primary: true });
  const original = new VStack([{ component: transcript, basis: 0, grow: 1 }, { component: new VStack([empty, empty, empty, editor, empty, footer]), basis: 'auto' }]);
  let focused = editor;
  let listener;
  let layout = original;
  let overlayCount = 0;
  const notifications = [];
  const tui = {
    [VIEWPORT_TUI]: true, mode: 'fullscreen', terminal: { columns: 160, rows: 40 },
    get layoutRoot() { return layout; },
    setLayoutRoot(r) { layout = r; },
    getFocusedComponent: () => focused,
    setFocus(c) { focused = c; }, requestRender() {},
    showOverlay(component) {
      overlayCount++;
      focused = component;
      return { hide() { overlayCount--; focused = editor; }, setHidden(hidden) { focused = hidden ? editor : component; }, focus() { focused = component; } };
    },
  };
  ctx = {
    mode: 'tui', cwd: root, isIdle: () => true, model: { id: 'test-model' }, getContextUsage: () => ({ percent: 12 }),
    sessionManager: { getSessionDir: () => join(root, 'sessions'), getSessionFile: () => undefined, getEntries: () => [] },
    ui: {
      setWidget(k, factory) { if (factory) factory(tui, { fg: (_k, s) => s, bold: s => s }); },
      notify(...args) { notifications.push(args); },
      onTerminalInput(fn) { listener = fn; return () => { listener = undefined; }; },
    },
  };
  for (const fn of extension.handlers.get('session_start')) await fn({}, ctx);
  assert.notEqual(layout, original, JSON.stringify(notifications));
  function key(data) {
    const result = listener?.(data);
    if (!result?.consume) focused?.handleInput?.(data);
  }
  const render = () => renderLayoutFrame(layout, tui.terminal.columns, tui.terminal.rows, () => {});
  for (const width of [160, 140, 120, 99, 60]) {
    tui.terminal.columns = width;
    const frame = render();
    assert.equal(frame.lines.length, 40);
    assert(frame.lines.every(line => visibleWidth(line) <= width));
  }
  tui.terminal.columns = 160;
  const frame = render();
  assert(frame.lines.some(line => line.includes('ARQUIVOS')));
  assert(frame.lines.some(line => line.includes('SESSÕES')));
  assert(frame.lines.some(line => line.includes('Modelo: test-model')));
  assert(frame.lines.some(line => line.includes('prompt preservado')));
  assert.equal(frame.primaryScrollView, transcript, 'must reuse native transcript scroll view');
  for (const shortcut of ['\x1bn', '\x1bs', '\x1ba']) {
    for (let i = 0; i < 10; i++) {
      key(shortcut); assert.notEqual(focused, editor);
      key(shortcut); assert.equal(focused, editor);
    }
    key(shortcut); key('\x1b'); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(focused, editor);
  }
  // Kitty protocol sends press/repeat/release separately. Release must NOT toggle.
  for (const code of [110, 115, 97]) {
    key(`\x1b[${code};3u`);
    const panel = focused;
    assert.notEqual(panel, editor);
    key(`\x1b[${code};3:2u`);
    assert.equal(focused, panel, 'auto-repeat must not toggle focus');
    key(`\x1b[${code};3:3u`);
    assert.equal(focused, panel, 'key release must not toggle focus');
    key(`\x1b[${code};3u`);
    assert.equal(focused, editor);
    key(`\x1b[${code};3:3u`);
    assert.equal(focused, editor);
  }
  key('\x1bn');
  tui.terminal.columns = 80;
  key('\x1b[B'); assert.equal(overlayCount, 1, 'resize keeps a focused hidden panel reachable');
  key('\x1bn'); assert.equal(overlayCount, 0); assert.equal(focused, editor);
  key('\x1bn'); assert.equal(overlayCount, 1);
  key('\x1bn'); assert.equal(overlayCount, 0); assert.equal(focused, editor);
  tui.terminal.columns = 160;
  key('\x1bn'); key('/'); key('app.ts'); key('\x1b[B'); key(' ');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(render().lines.some(line => line.includes('PRÉVIA')));
  key('\x1b'); assert(!render().lines.some(line => line.includes('PRÉVIA')));
  key('\x1b'); await new Promise(resolve => setTimeout(resolve, 30)); // clear search filter
  key('\x1b'); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(focused, editor);
  bus.emit('subagent:async-started', { id: 'test-run', agent: 'reviewer', task: 'Revisão' });
  assert(render().lines.some(line => line.includes('reviewer')));
  bus.emit('subagent:async-complete', { runId: 'test-run', exitCode: 0 });
  assert(render().lines.some(line => line.includes('✓ reviewer')));
  for (const fn of extension.handlers.get('session_shutdown')) await fn({}, ctx);
  assert.equal(layout, original);
  assert.equal(listener, undefined);
  console.log('PASS: filesystem guards, sorting, hidden files, search, preview, rename/delete, 5 widths, native scroll preservation, 30 focus cycles, Esc, narrow overlay, subagent events and teardown.');
} finally {
  if (extension && ctx) for (const fn of extension.handlers.get('session_shutdown')) await fn({}, ctx);
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}
