import { SessionManager, copyToClipboard, type ExtensionAPI, type ExtensionContext, type Theme, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { VStack, matchesKey, isKeyRelease, isKeyRepeat, truncateToWidth, visibleWidth, type Component, type TUI, type OverlayHandle } from '@earendil-works/pi-tui';
import { realpath, lstat, readdir, unlink } from 'node:fs/promises';
import { relative, dirname, basename, resolve } from 'node:path';
import { inspectLayout, installLayout, installUserMessageBackground } from './layout.ts';
import { editName } from './dialogs.ts';
import { WORKSPACE_COLOR, paintUserMessageBackground } from './appearance.ts';
import { tree, preview, renameItem, deleteItem, safePath, sanitize, type FileItem } from './files.ts';

type Focus = 'files' | 'sessions' | 'agents';
type Run = { id: string; agent: string; task: string; status: string; started: number; updated: number; ended?: number; detail: unknown };
const date = (n: number | Date) => new Date(n).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function (pi: ExtensionAPI) {
  let ctx: ExtensionContext;
  let tui: TUI | undefined;
  let theme: Theme;
  let root = '';
  let alive = false;
  let epoch = 0;
  let enabled = false;
  let busy = false;
  let leftVisible = true;
  let rightVisible = true;
  let focus: Focus | undefined;
  let promptTarget: Component | null = null;
  let narrowOverlay: OverlayHandle | undefined;
  let restoreLayout: (() => void) | undefined;
  let restoreUserBackground: (() => void) | undefined;
  let removeInput: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let footer: Component | undefined;
  let items: FileItem[] = [];
  let fileIndex = 0;
  let sessions: SessionInfo[] = [];
  let sessionIndex = 0;
  let agentIndex = 0;
  let showHidden = false;
  let query = '';
  let searching = false;
  let limited = false;
  let projectLines: string[] = [];
  let expanded = new Set<string>();
  let fileRevision = 0;
  let fileInputQueue = Promise.resolve();
  let refreshing = false;
  let previewState: { path: string; lines: string[]; top: number } | undefined;
  let adapter: ReturnType<typeof inspectLayout> | undefined;
  const runs = new Map<string, Run>();
  const subscriptions: (() => void)[] = [];
  const repaint = () => tui?.requestRender();
  const report = (e: unknown) => { if (alive) ctx.ui.notify(String(e), 'error'); };
  const launch = (fn: () => Promise<void>) => { void fn().catch(report); };
  const runList = () => [...runs.values()].sort((a, b) => Number(!!a.ended) - Number(!!b.ended) || b.started - a.started);
  const panelHeight = (kind: 'files' | 'project' | 'sessions' | 'agents') => {
    const height = tui?.terminal.rows || 24;
    // Reserve roughly one third for the lower panels (at least 12 rows when
    // space permits). The upper panels use every remaining row.
    const bottom = Math.min(Math.floor(height / 2), Math.max(12, Math.floor(height / 3)));
    return kind === 'files' || kind === 'sessions' ? height - bottom : bottom;
  };
  function box(title: string, lines: string[], width: number, height: number, active = false) {
    if (width < 3 || height < 2) return [];
    const inner = width - 2;
    const border = (s: string) => theme.fg(WORKSPACE_COLOR, active ? theme.bold(s) : s);
    const row = (s: string) => {
      const text = truncateToWidth(s, inner);
      return border('│') + text + ' '.repeat(Math.max(0, inner - visibleWidth(text))) + border('│');
    };
    const label = truncateToWidth(` ${title} `, inner);
    const result = [border('╭' + label + '─'.repeat(Math.max(0, inner - visibleWidth(label))) + '╮')];
    for (let i = 0; i < height - 2; i++) result.push(row(lines[i] || ''));
    result.push(border('╰' + '─'.repeat(inner) + '╯'));
    return result;
  }
  function window<T>(list: T[], selected: number, capacity: number) {
    const start = Math.max(0, Math.min(selected - Math.floor(capacity / 2), list.length - capacity));
    return { start, entries: list.slice(start, start + capacity) };
  }

  async function loadFiles(preferred?: string) {
    const revision = ++fileRevision;
    const generation = epoch;
    const path = preferred || items[fileIndex]?.path;
    const result = await tree(root, expanded, showHidden, query);
    if (!alive || generation !== epoch || revision !== fileRevision) return;
    items = result.items; limited = result.limited;
    const index = items.findIndex(i => i.path === path);
    fileIndex = index >= 0 ? index : Math.max(0, Math.min(fileIndex, items.length - 1));
    repaint();
  }
  async function loadProject() {
    const generation = epoch;
    const lines = [sanitize(root)];
    const git = await pi.exec('git', ['-C', root, 'status', '--porcelain=v1', '--branch'], { timeout: 2000 }).catch(() => undefined);
    if (git?.code === 0) {
      const [branch, ...changes] = git.stdout.trimEnd().split('\n');
      lines.push(`⎇ ${sanitize(branch.replace(/^## /, ''))} · ${changes.filter(Boolean).length} Δ`);
    } else lines.push('Git: não disponível');
    // Presence is informational: it does not imply that Pi loaded these instructions.
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      try {
        const info = await lstat(resolve(root, name));
        if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Não é arquivo');
        lines.push(`☑ ${name} · ${info.mtime.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
      } catch { lines.push(`☐ ${name}`); }
    }

    if (generation === epoch && alive) projectLines = lines;
  }
  async function loadSessions() {
    const generation = epoch;
    const path = sessions[sessionIndex]?.path;
    const list = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
    if (!alive || generation !== epoch) return;
    // Interaction time excludes renames and other metadata-only writes.
    const times = (s: SessionInfo) => s.modified.getTime();
    const sorted = list.sort((a, b) => times(b) - times(a) || a.id.localeCompare(b.id));
    if (focus === 'sessions') {
      const updated = new Map(sorted.map(s => [s.path, s]));
      sessions = [...sessions.flatMap(s => updated.has(s.path) ? [updated.get(s.path)!] : []), ...sorted.filter(s => !sessions.some(old => old.path === s.path))];
    } else sessions = sorted;
    const index = sessions.findIndex(s => s.path === path);
    sessionIndex = index >= 0 ? index : Math.max(0, Math.min(sessionIndex, sessions.length - 1));
  }
  function reconcilePanelVisibility() {
    if (!focus || !tui || previewState || busy) return;
    const visible = focus === 'files' ? leftVisible && tui.terminal.columns >= 100 : rightVisible && tui.terminal.columns >= 140;
    if (!visible && !narrowOverlay) narrowOverlay = tui.showOverlay(panels[focus], { anchor: focus === 'files' ? 'top-left' : 'top-right', width: Math.min(42, tui.terminal.columns), maxHeight: '100%' });
    else if (visible && narrowOverlay) { narrowOverlay.hide(); narrowOverlay = undefined; tui.setFocus(panels[focus]); }
  }
  async function refresh() {
    if (refreshing || !alive) return;
    reconcilePanelVisibility();
    refreshing = true;
    const generation = epoch;
    try { await Promise.all([loadSessions(), loadProject(), focus === 'files' || searching ? Promise.resolve() : loadFiles()]); repaint(); }
    finally { if (generation === epoch) refreshing = false; }
  }
  function release() {
    previewState = undefined;
    narrowOverlay?.hide(); narrowOverlay = undefined;
    focus = undefined;
    if (promptTarget) tui?.setFocus(promptTarget);
    repaint();
  }
  function toggle(which: Focus) {
    if (!enabled || !tui) { ctx?.ui.notify('Workspace indisponível. Use fullscreen e /reload.', 'warning'); return; }
    if (focus === which || previewState) { release(); return; }
    const target = tui.getFocusedComponent();
    if (!focus && target) promptTarget = target;
    narrowOverlay?.hide(); narrowOverlay = undefined;
    focus = which;
    const visible = which === 'files' ? leftVisible && tui.terminal.columns >= 100 : rightVisible && tui.terminal.columns >= 140;
    if (!visible) narrowOverlay = tui.showOverlay(panels[which], { anchor: which === 'files' ? 'top-left' : 'top-right', width: Math.min(42, tui.terminal.columns), maxHeight: '100%' });
    else tui.setFocus(panels[which]);
    if (which === 'files') launch(() => loadFiles());
    repaint();
  }
  async function copyPath(path: string) {
    const generation = epoch;
    const workspaceRoot = root;
    await safePath(workspaceRoot, path);
    await copyToClipboard(relative(workspaceRoot, path));
    if (!alive || generation !== epoch) return;
    release();
    ctx.ui.notify(`Caminho copiado: ${sanitize(relative(workspaceRoot, path))}`, 'info');
  }
  async function expand(item: FileItem) {
    if (!item.directory) return;
    if (expanded.has(item.path)) expanded.delete(item.path); else expanded.add(item.path);
    await loadFiles(item.path);
  }
  async function fileAction(action: 'rename' | 'delete') {
    const item = items[fileIndex];
    if (!item || busy) return;
    busy = true;
    release();
    try {
      await safePath(root, item.path);
      let preferred = item.path;
      if (action === 'rename') {
        const name = await editName(ctx, `Renomear: ${relative(root, item.path)}`, item.name);
        if (name === undefined) return;
        preferred = await renameItem(root, item.path, name.trim());
        expanded.delete(item.path);
      } else {
        const choice = await ctx.ui.select(`Excluir ${sanitize(relative(root, item.path))}?`, ['Cancelar', 'Enviar à lixeira', 'Excluir permanentemente']);
        if (!choice || choice === 'Cancelar') return;
        if (item.directory && (await readdir(item.path)).length) {
          const typed = await ctx.ui.input(`Pasta não vazia. Digite exatamente: ${sanitize(item.name)}`);
          if (typed !== item.name) return;
        }
        if (choice === 'Enviar à lixeira') {
          // Revalidate after the confirmation dialog; never fall back to permanent deletion.
          await safePath(root, item.path);
          // No shell interpolation; gio delegates to the desktop trash implementation.
          const result = await pi.exec('gio', ['trash', '--', item.path], { timeout: 10000 });
          if (result.code !== 0) throw new Error(`Não foi possível usar a lixeira: ${result.stderr || result.stdout}. Nada foi apagado permanentemente.`);
        } else {
          if (!await ctx.ui.confirm('Exclusão definitiva — sem desfazer', sanitize(relative(root, item.path)))) return;
          await deleteItem(root, item.path);
        }
        expanded.delete(item.path);
        preferred = dirname(item.path);
      }
      await loadFiles(preferred);
    } finally { busy = false; if (alive && enabled) toggle('files'); }
  }

  async function filesInput(data: string) {
    if (busy) return;
    if (searching) {
      if (matchesKey(data, 'escape')) { searching = false; query = ''; await loadFiles(); }
      else if (matchesKey(data, 'backspace')) { query = [...query].slice(0, -1).join(''); await loadFiles(); }
      else if (data.length && !/[\x00-\x1f\x7f-\x9f]/.test(data) && !matchesKey(data, 'space')) { query += data; await loadFiles(); }
      else if (matchesKey(data, 'space')) { query += ' '; await loadFiles(); }
      else { searching = false; /* navigation/Enter continues below with filtered results */ }
      if (searching || matchesKey(data, 'escape')) return;
    }
    const item = items[fileIndex];
    if (matchesKey(data, 'escape')) { if (query) { query = ''; await loadFiles(); } else release(); }
    else if (matchesKey(data, 'up')) fileIndex = Math.max(0, fileIndex - 1);
    else if (matchesKey(data, 'down')) fileIndex = Math.min(items.length - 1, fileIndex + 1);
    else if (matchesKey(data, 'home')) fileIndex = 0;
    else if (matchesKey(data, 'end')) fileIndex = Math.max(0, items.length - 1);
    else if (matchesKey(data, 'right') && item?.directory) { expanded.add(item.path); await loadFiles(item.path); }
    else if (matchesKey(data, 'left') && item) {
      if (expanded.has(item.path)) { expanded.delete(item.path); await loadFiles(item.path); }
      else { const parent = items.findIndex(i => i.path === dirname(item.path)); if (parent >= 0) fileIndex = parent; }
    }
    else if (matchesKey(data, 'enter') && item) { if (item.directory) await expand(item); else await copyPath(item.path); }
    else if (data === 'c' && item) await copyPath(item.path);
    else if (matchesKey(data, 'space') && item && !item.directory) {
      const generation = epoch;
      const lines = await preview(root, item.path);
      if (!alive || generation !== epoch || focus !== 'files') return;
      previewState = { path: item.path, lines, top: 0 }; narrowOverlay?.setHidden(true); repaint();
    }
    else if (data === 'r' && item) await fileAction('rename');
    else if (matchesKey(data, 'delete') && item) await fileAction('delete');
    else if (data === '.') { showHidden = !showHidden; await loadFiles(); }
    else if (data === '/') { searching = true; query = ''; }
    repaint();
  }

  function sessionDispatch(action: string) {
    const item = sessions[sessionIndex];
    if (!item || busy) return;
    if (!ctx.isIdle()) { ctx.ui.notify('Aguarde o agente terminar para alterar sessões.', 'warning'); return; }
    release();
    pi.sendUserMessage(`/workspace-session ${JSON.stringify({ action, path: item.path })}`, { expandPromptTemplates: true });
  }
  const panels: Record<Focus, Component> = {
    files: {
      invalidate() {},
      handleInput(data) {
        const generation = epoch;
        fileInputQueue = fileInputQueue.then(async () => {
          if (alive && generation === epoch && focus === 'files') await filesInput(data);
        }).catch(report);
      },
      render(width) {
        const height = panelHeight('files');
        const cap = Math.max(1, height - 6);
        const { start, entries } = window(items, fileIndex, cap);
        const lines = [searching ? `/ ${sanitize(query)}▏` : query ? `Busca: ${sanitize(query)}` : `${basename(root)}/`];
        entries.forEach((item, j) => {
          const marker = item.directory ? expanded.has(item.path) ? '▾' : '▸' : item.link ? '↗' : ' ';
          const name = query ? relative(root, item.path) : ' '.repeat(Math.min(item.depth * 2, 12)) + item.name;
          const text = `${fileIndex === start + j ? '❯' : ' '} ${marker} ${sanitize(name)}`;
          lines.push(fileIndex === start + j && focus === 'files' ? theme.fg('accent', text) : text);
        });
        while (lines.length < height - 5) lines.push('');
        lines.push(sanitize(items[fileIndex] ? relative(root, items[fileIndex].path) : 'Nenhum arquivo'));
        lines.push(limited ? 'Busca limitada · refine o filtro' : 'Enter copiar · Espaço prévia');
        lines.push('R nome · Del excluir · / busca');
        return box('ARQUIVOS · Alt+N', lines, width, height, focus === 'files');
      },
    },
    sessions: {
      invalidate() {},
      handleInput(data) {
        if (matchesKey(data, 'escape')) release();
        else if (matchesKey(data, 'up')) sessionIndex = Math.max(0, sessionIndex - 1);
        else if (matchesKey(data, 'down')) sessionIndex = Math.min(sessions.length - 1, sessionIndex + 1);
        else if (matchesKey(data, 'home')) sessionIndex = 0;
        else if (matchesKey(data, 'end')) sessionIndex = Math.max(0, sessions.length - 1);
        else if (matchesKey(data, 'enter')) sessionDispatch('open');
        else if (data === 'r' || matchesKey(data, 'ctrl+r')) sessionDispatch('rename');
        else if (data === 'd' || matchesKey(data, 'delete')) sessionDispatch('delete');
        repaint();
      },
      render(width) {
        const height = panelHeight('sessions');
        const { start, entries } = window(sessions, sessionIndex, Math.max(1, Math.floor((height - 4) / 2)));
        const lines: string[] = [];
        entries.forEach((s, j) => {
          const current = s.path === ctx.sessionManager.getSessionFile();
          const label = `${focus === 'sessions' && start + j === sessionIndex ? '❯' : ' '}${current ? '●' : ' '} ${sanitize(s.name || s.firstMessage || s.id)}`;
          lines.push(current ? theme.fg('accent', theme.bold(label)) : label, theme.fg('dim', `   ${date(s.modified)}`));
        });
        if (!entries.length) lines.push('Nenhuma sessão salva');
        while (lines.length < height - 3) lines.push('');
        lines.push('Enter abrir · R nome · Del excluir');
        return box('SESSÕES · Alt+S', lines, width, height, focus === 'sessions');
      },
    },
    agents: {
      invalidate() {},
      handleInput(data) {
        const list = runList();
        if (matchesKey(data, 'escape')) release();
        else if (matchesKey(data, 'up')) agentIndex = Math.max(0, agentIndex - 1);
        else if (matchesKey(data, 'down')) agentIndex = Math.min(list.length - 1, agentIndex + 1);
        else if (matchesKey(data, 'enter') && list[agentIndex]) {
          const run = list[agentIndex];
          previewState = { path: `Subagente: ${run.agent}`, lines: JSON.stringify(run, null, 2).split('\n').map(sanitize), top: 0 };
          narrowOverlay?.setHidden(true);
        }
        repaint();
      },
      render(width) {
        const height = panelHeight('agents');
        const list = runList();
        agentIndex = Math.max(0, Math.min(agentIndex, list.length - 1));
        const { start, entries } = window(list, agentIndex, Math.max(1, Math.floor((height - 4) / 3)));
        const lines = [`${list.filter(r => !r.ended).length} ativos · ${list.filter(r => r.ended).length} encerrados`];
        for (const [j, run] of entries.entries()) {
          const seconds = Math.max(0, Math.floor(((run.ended || Date.now()) - run.started) / 1000));
          const icon = run.status === 'completed' ? '✓' : run.status === 'failed' ? '×' : run.status === 'stopped' ? '■' : run.status === 'attention' ? '!' : run.status === 'pending' ? '○' : '◐';
          lines.push(`${focus === 'agents' && agentIndex === start + j ? '❯' : ' '} ${icon} ${sanitize(run.agent)}`, `  ${sanitize(run.task || run.status)}`, `  ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${sanitize(run.status)}`);
        }
        if (!list.length) lines.push('Sem eventos nesta sessão.', 'Integração: pi-subagents', 'Inicie uma execução para monitorar.');
        return box('SUBAGENTES · Alt+A', lines, width, height, focus === 'agents');
      },
    },
  };
  const project: Component = {
    invalidate() {},
    render(width) {
      const height = panelHeight('project');
      const usage = ctx.getContextUsage();
      let input = 0, output = 0, cost = 0;
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== 'message' || entry.message.role !== 'assistant') continue;
        const u = entry.message.usage;
        if (u) { input += u.input || 0; output += u.output || 0; cost += u.cost?.total || 0; }
      }
      const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      const lines = [...projectLines,
        `Modelo: ${ctx.model?.id || '—'}`,
        `Thinking: ${pi.getThinkingLevel()}`,
        `Contexto: ${usage?.percent == null ? '—' : usage.percent.toFixed(1) + '%'}`,
        `Tokens: ↑${compact(input)} ↓${compact(output)}`,
        `Custo: $${cost.toFixed(3)}`];
      try {
        lines.push(...(footer?.render(Math.max(1, width - 2)).slice(2) || []));
        for (const extra of adapter?.extras || []) lines.push(...extra.render(Math.max(1, width - 2)).filter(s => visibleWidth(s) > 0));
      } catch { /* teardown */ }
      return box('PROJETO', lines, width, height);
    },
  };
  const centralPreview: Component = {
    invalidate() {},
    render(width) {
      if (!previewState) return [];
      return box(`PRÉVIA · ${sanitize(previewState.path)}`, [
        ...previewState.lines.slice(previewState.top, previewState.top + Math.max(1, (tui?.terminal.rows || 24) - 4)),
        'Esc voltar · ↑↓ rolar · Enter copiar',
      ], width, tui?.terminal.rows || 24, true);
    },
  };

  function stop() {
    alive = false; epoch++; fileRevision++;
    fileInputQueue = Promise.resolve();
    if (timer) clearInterval(timer);
    timer = undefined;
    removeInput?.(); removeInput = undefined;
    for (const off of subscriptions.splice(0)) off();
    if (focus) release();
    restoreUserBackground?.(); restoreUserBackground = undefined;
    restoreLayout?.(); restoreLayout = undefined;
    enabled = false;
    tui = undefined; adapter = undefined; footer = undefined;
    promptTarget = null; focus = undefined; busy = false; refreshing = false;
  }
  pi.on('session_shutdown', async () => stop());

  pi.on('session_start', async (_, context) => {
    stop(); ctx = context;
    if (ctx.mode !== 'tui') return;
    alive = true; root = await realpath(ctx.cwd);
    items = []; sessions = []; runs.clear(); expanded = new Set(); fileIndex = sessionIndex = agentIndex = 0;
    query = ''; searching = false; showHidden = false; leftVisible = rightVisible = true;
    // A zero-line widget gives us the live TUI without opening a focus-owning dialog.
    ctx.ui.setWidget('personal-workspace-host', (ui, colors) => {
      tui = ui; theme = colors;
      if (!enabled) {
        try {
          adapter = inspectLayout(ui, () => leftVisible, text => colors.fg(WORKSPACE_COLOR, focus ? text : colors.bold(text)));
          restoreUserBackground = installUserMessageBackground(adapter.transcript,
            text => paintUserMessageBackground(colors, text));
          footer = adapter.footer;
          const originalCenter = adapter.center;
          // Keep layout nodes intact when there is no preview; swap only the central pane.
          const center = new VStack([
            { component: originalCenter, basis: 0, grow: 1, minSize: 1, visible: () => !previewState },
            { component: centralPreview, basis: 0, grow: 1, minSize: 1, visible: () => !!previewState },
          ]);
          adapter.center = center;
          restoreLayout = installLayout(adapter,
            // Use each card's exact intrinsic height. Growing zero-basis entries
            // allocates different heights than render() uses, leaving blank gaps.
            new VStack([{ component: panels.files, basis: 'auto', grow: 0, shrink: 0 }, { component: project, basis: 'auto', grow: 0, shrink: 0 }]),
            new VStack([{ component: panels.sessions, basis: 'auto', grow: 0, shrink: 0 }, { component: panels.agents, basis: 'auto', grow: 0, shrink: 0 }]),
            () => leftVisible, () => rightVisible);
          enabled = true;
          promptTarget = ui.getFocusedComponent();
        } catch (error) { ctx.ui.notify(String(error), 'warning'); }
      }
      return { render: () => [], invalidate() {} };
    });
    if (!enabled) return;
    // Narrow terminals expose a focused sidebar via a temporary overlay. Wide mode is real layout.
    removeInput = ctx.ui.onTerminalInput(data => {
      if (busy) return;
      reconcilePanelVisibility();
      const currentFocus = tui?.getFocusedComponent();
      const ownsInput = !!focus || currentFocus === promptTarget;
      // matchesKey() also matches Kitty release/repeat events. A toggle is
      // edge-triggered: handle the press once, never the release or auto-repeat.
      if (ownsInput && isKeyRelease(data)) return { consume: true };
      const toggleKey = (['alt+n', 'alt+s', 'alt+a', 'alt+1', 'alt+3'] as const).some(key => matchesKey(data, key));
      if (ownsInput && toggleKey && isKeyRepeat(data)) return { consume: true };
      if (ownsInput && (matchesKey(data, 'alt+n') || matchesKey(data, 'alt+s') || matchesKey(data, 'alt+a'))) {
        toggle(matchesKey(data, 'alt+n') ? 'files' : matchesKey(data, 'alt+s') ? 'sessions' : 'agents');
        return { consume: true };
      }
      if (ownsInput && (matchesKey(data, 'alt+1') || matchesKey(data, 'alt+3'))) {
        release();
        if (matchesKey(data, 'alt+1')) leftVisible = !leftVisible; else rightVisible = !rightVisible;
        repaint(); return { consume: true };
      }
      if (previewState) {
        if (matchesKey(data, 'escape') || matchesKey(data, 'space')) { previewState = undefined; narrowOverlay?.setHidden(false); narrowOverlay?.focus(); }
        else if (matchesKey(data, 'up')) previewState.top = Math.max(0, previewState.top - 1);
        else if (matchesKey(data, 'down')) previewState.top = Math.min(Math.max(0, previewState.lines.length - 1), previewState.top + 1);
        else if (matchesKey(data, 'pageUp')) previewState.top = Math.max(0, previewState.top - 10);
        else if (matchesKey(data, 'pageDown')) previewState.top = Math.min(Math.max(0, previewState.lines.length - 1), previewState.top + 10);
        else if (matchesKey(data, 'home')) previewState.top = 0;
        else if (matchesKey(data, 'end')) previewState.top = Math.max(0, previewState.lines.length - 5);
        else if (matchesKey(data, 'enter') && focus === 'files') launch(() => copyPath(previewState!.path));
        repaint(); return { consume: true };
      }
      return undefined;
    });
    const observe = (name: string, handler: (data: any) => void) => subscriptions.push(pi.events.on(name, data => {
      if (!alive) return;
      try { handler(data); repaint(); } catch { /* tolerate other plugin versions */ }
    }));
    function update(data: any, forced?: string) {
      if (!data || typeof data !== 'object') return;
      const e = data.event && typeof data.event === 'object' ? { ...data, ...data.event } : data;
      const id = e.childId ? `${e.runId || 'run'}:${e.childId}` : e.id || e.runId;
      if (typeof id !== 'string') return;
      const previous = runs.get(id);
      const status = forced || (e.type === 'needs_attention' || e.to === 'needs_attention' || e.reason === 'supervisor_request' ? 'attention' : e.status === 'started' ? 'running' : e.status || e.to || 'running');
      const terminal = ['completed', 'failed', 'stopped'].includes(status);
      runs.set(id, { id, agent: String(e.agent || previous?.agent || 'subagente'), task: String(e.taskPreview || e.task || e.label || e.message || previous?.task || ''), status,
        started: previous?.started || (typeof e.ts === 'number' ? e.ts : Date.now()), updated: Date.now(), ended: terminal ? Date.now() : undefined, detail: e });
      if (runs.size > 100) { const oldest = [...runs.values()].find(r => r.ended); if (oldest) runs.delete(oldest.id); }
    }
    observe('subagent:async-started', d => update(d, d?.status === 'pending' ? 'pending' : 'running'));
    observe('subagent:child-status', d => update(d));
    observe('subagent:control-event', d => update(d));
    const complete = (d: any) => {
      const state = d?.stopped || d?.state === 'stopped' ? 'stopped' : d?.success === false || (d?.exitCode != null && d.exitCode !== 0) ? 'failed' : 'completed';
      update(d, state);
      const parentId = d?.runId || d?.id;
      for (const run of runs.values()) {
        if (!run.ended && (run.detail as any)?.runId === parentId) { run.status = state; run.ended = Date.now(); }
      }
    };
    observe('subagent:async-complete', complete);
    observe('subagent:foreground-complete', complete);
    await refresh().catch(report);
    if (!alive) return;
    timer = setInterval(() => { launch(refresh); }, 4000); timer.unref();
  });

  pi.registerShortcut('alt+n', { description: 'Workspace: navegador de arquivos', handler: () => toggle('files') });
  pi.registerShortcut('alt+s', { description: 'Workspace: sessões', handler: () => toggle('sessions') });
  pi.registerShortcut('alt+a', { description: 'Workspace: subagentes', handler: () => toggle('agents') });
  pi.registerShortcut('alt+1', { description: 'Workspace: alternar coluna esquerda', handler: () => { release(); leftVisible = !leftVisible; repaint(); } });
  pi.registerShortcut('alt+3', { description: 'Workspace: alternar coluna direita', handler: () => { release(); rightVisible = !rightVisible; repaint(); } });
  pi.registerCommand('workspace-off', { description: 'Desativar workspace e restaurar layout nativo', handler: async () => { stop(); ctx.ui.setWidget('personal-workspace-host', undefined); } });
  pi.registerCommand('workspace', { description: 'Ajuda do workspace pessoal', handler: async (_, c) => c.ui.notify('Alt+N arquivos · Alt+S sessões · Alt+A subagentes · Alt+1/3 colunas · /workspace-off desativa · /reload reativa', 'info') });
  pi.registerCommand('sessions', { description: 'Focar sessões', handler: async () => toggle('sessions') });
  pi.registerCommand('sessions-hide', { description: 'Alternar coluna direita', handler: async () => { release(); rightVisible = !rightVisible; repaint(); } });
  pi.registerCommand('workspace-session', {
    description: 'Ação interna do workspace',
    handler: async (args, commandCtx) => {
      if (busy || commandCtx.mode !== 'tui' || !commandCtx.isIdle()) return;
      busy = true;
      try {
        const { action, path } = JSON.parse(args);
        const list = await SessionManager.list(commandCtx.cwd, commandCtx.sessionManager.getSessionDir());
        const session = list.find(s => s.path === path);
        if (!session) throw new Error('Sessão não encontrada neste projeto.');
        const current = path === commandCtx.sessionManager.getSessionFile();
        if (action === 'open') { if (!current) await commandCtx.switchSession(path); return; }
        if (action === 'rename') {
          const name = await editName(commandCtx, 'Renomear sessão', session.name || '');
          if (name?.trim()) { if (current) pi.setSessionName(sanitize(name.trim())); else SessionManager.open(path).appendSessionInfo(sanitize(name.trim())); }
        } else if (action === 'delete') {
          if (current) commandCtx.ui.notify('Abra outra sessão antes de excluir a atual.', 'warning');
          else if (await commandCtx.ui.confirm('Excluir sessão permanentemente?', `${sanitize(session.name || session.firstMessage || session.id)}\nNão exclua sessões abertas em outro Pi. Esta ação não pode ser desfeita.`)) await unlink(path);
        }
        if (alive) await loadSessions(); repaint();
      } catch (error) { commandCtx.ui.notify(String(error), 'error'); }
      finally { busy = false; }
    },
  });
}
