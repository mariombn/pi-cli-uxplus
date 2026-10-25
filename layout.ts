import { Container, HStack, VStack, isViewportTUI, stripTerminalSequences, truncateToWidth, visibleWidth, type TuiMouseEvent, type Component, type TUI, type ViewportTUI, type StackEntry } from '@earendil-works/pi-tui';

function hasWorking(component: Component): boolean {
  const node = component as Component & { kind?: string; children?: Component[] };
  return node.kind === 'working' || (node.children || []).some(hasWorking);
}

/** Paint the native working row at render time, keeping its animation/timer.
 * Retry/compaction indicators retain their native warning/status colors.
 */
export class WorkingStatusColor extends Container {
  constructor(private readonly status: Component, private readonly paint: (text: string) => string) {
    super(); this.addChild(status);
  }
  override render(width: number): string[] {
    const lines = this.status.render(width);
    return hasWorking(this.status) ? lines.map(line => this.paint(stripTerminalSequences(line))) : lines;
  }
}

/** Decorate the existing editor instead of replacing it: preserve cursor, undo,
 * autocomplete, application handlers and IME markers. Native borders are reused.
 */
export class PromptFrame extends Container {
  private extraTop = 0;
  constructor(private readonly editor: Component, private readonly paint: (text: string) => string) {
    super();
    this.addChild(editor);
  }
  override render(width: number): string[] {
    if (width < 3) return this.editor.render(width);
    const inner = width - 2;
    const restore: (() => void)[] = [];
    let embeddedWorking = false;
    const recolor = (component: Component) => {
      const candidate = component as Component & { borderColor?: (text: string) => string; children?: Component[];
        embedWorkingStatus?: boolean; workingStatusIndicator?: { kind?: string } };
      if (candidate.embedWorkingStatus && candidate.workingStatusIndicator?.kind === 'working') embeddedWorking = true;
      if (typeof candidate.borderColor === 'function') {
        const original = candidate.borderColor;
        candidate.borderColor = this.paint;
        restore.push(() => { candidate.borderColor = original; });
      }
      for (const child of candidate.children || []) recolor(child);
    };
    let lines: string[];
    try { recolor(this.editor); lines = this.editor.render(inner); }
    finally { for (const reset of restore.reverse()) reset(); }
    const native = stripTerminalSequences(lines[0] || '').startsWith('─');
    let bottom = -1;
    if (native) {
      for (let i = lines.length - 1; i > 0; i--) {
        if (stripTerminalSequences(lines[i]).startsWith('─')) { bottom = i; break; }
      }
    }
    this.extraTop = native ? 0 : 1;
    const pad = (text: string) => {
      text = truncateToWidth(text, inner);
      return text + ' '.repeat(Math.max(0, inner - visibleWidth(text)));
    };
    const result = lines.map((line, index) => {
      if (native && index === 0) return this.paint('╭') + pad(embeddedWorking ? this.paint(stripTerminalSequences(line)) : line) + this.paint('╮');
      if (native && index === bottom) return this.paint('╰') + pad(line) + this.paint('╯');
      // Completion menus remain outside the prompt border, as in the native editor.
      if (native && bottom >= 0 && index > bottom) return ' ' + pad(line) + ' ';
      return this.paint('│') + pad(line) + this.paint('│');
    });
    if (!native) {
      result.unshift(this.paint('╭' + '─'.repeat(inner) + '╮'));
      result.push(this.paint('╰' + '─'.repeat(inner) + '╯'));
    }
    return result;
  }
  override handleMouse(event: TuiMouseEvent) {
    if (event.x < 1 || event.x >= event.width - 1 || event.y < this.extraTop) return undefined;
    return this.editor.handleMouse?.({ ...event, x: event.x - 1, y: event.y - this.extraTop,
      width: Math.max(1, event.width - 2), height: Math.max(1, event.height - this.extraTop * 2) });
  }
}

type StackNode = { type: string; entries: StackEntry[]; component?: Component };
function getLayoutNode(component: Component): StackNode | undefined {
  const getter = (component as any)[Symbol.for('@earendil-works/pi-tui/layout-node')];
  return typeof getter === 'function' ? getter.call(component) : undefined;
}

/** Pi 1.4.x user-message adapter. Override only the user Markdown's background,
 * not the whole theme or transcript rendering. Discover new messages before each
 * document render; restore all native callbacks when the workspace is disabled.
 */
export function installUserMessageBackground(transcript: Component, paint: (text: string) => string) {
  const document = getLayoutNode(transcript)?.component;
  if (!document) throw new Error('Layout do Pi incompatível: documento do chat.');
  type Style = { bgColor?: (text: string) => string };
  const saved = new Map<Style, { background: Style['bgColor']; replacement: (text: string) => string; component: Component }>();
  const originalRender = document.render;
  function visit(component: Component, user = false) {
    const candidate = component as Component & { children?: Component[]; defaultTextStyle?: Style };
    user = user || component.constructor.name === 'UserMessageComponent';
    const style = candidate.defaultTextStyle;
    if (user && style && typeof style.bgColor === 'function' && !saved.has(style)) {
      const background = style.bgColor;
      const replacement = (text: string) => {
        try { return paint(text); }
        catch { return background(text); } // Cosmetic errors must not crash Pi's renderer.
      };
      saved.set(style, { background, replacement, component });
      style.bgColor = replacement;
      component.invalidate();
    }
    for (const child of candidate.children || []) visit(child, user);
  }
  function render(this: Component, width: number) {
    visit(document!);
    return originalRender.call(this, width);
  }
  document.render = render;
  document.invalidate();
  return () => {
    if (document.render === render) document.render = originalRender;
    for (const [style, original] of saved) {
      if (style.bgColor === original.replacement) style.bgColor = original.background;
      original.component.invalidate();
    }
    saved.clear();
    document.invalidate();
  };
}

/** Pi 1.4.x adapter. Only layoutRoot reading is internal; fail closed if its shape changes.
 * Keep the ORIGINAL transcript ScrollView so Pi's search, keyboard and mouse still work.
 */
export function inspectLayout(tui: TUI, showLeft: () => boolean = () => true, paintPrompt: (text: string) => string = text => text) {
  if (!isViewportTUI(tui)) throw new Error('Workspace exige fullscreen. Use /settings → modo fullscreen e /reload.');
  const original = (tui as TUI & { layoutRoot?: Component }).layoutRoot;
  if (!original) throw new Error('Layout do Pi incompatível: raiz não disponível.');
  const root = getLayoutNode(original);
  if (root?.type !== 'vstack' || root.entries.length !== 2) throw new Error('Layout do Pi incompatível: estrutura central.');
  const [transcript, dockEntry] = root.entries;
  const dock = getLayoutNode(dockEntry.component);
  if (dock?.type !== 'vstack' || dock.entries.length !== 6) throw new Error('Layout do Pi incompatível: input dock.');
  const footer = dock.entries.at(-1)!.component;
  const extras = [dock.entries[2].component, dock.entries[4].component];
  const center = new VStack([
    { ...transcript },
    { ...dockEntry, component: new VStack(dock.entries.map((e, i) => ({ ...e, ...(i === 3 ? { component: new PromptFrame(e.component, paintPrompt) } : i === 1 ? { component: new WorkingStatusColor(e.component, paintPrompt) } : {}), ...([2, 4, 5].includes(i) ? { visible: () => tui.terminal.columns < 100 || !showLeft() } : {}) }))) },
  ]);
  return { tui: tui as ViewportTUI, original, center, footer, extras, transcript: transcript.component };
}
export function installLayout(adapter: ReturnType<typeof inspectLayout>, left: Component, right: Component,
  showLeft: () => boolean, showRight: () => boolean) {
  const layout = new HStack([
    { component: left, basis: 30, minSize: 24, maxSize: 38, shrink: 1, visible: v => showLeft() && v.width >= 100 },
    { component: adapter.center, basis: 0, grow: 1, minSize: 40 },
    { component: right, basis: 30, minSize: 24, maxSize: 38, shrink: 1, visible: v => showRight() && v.width >= 140 },
  ], { gap: 1 });
  adapter.tui.setLayoutRoot(layout);
  return () => adapter.tui.setLayoutRoot(adapter.original);
}
