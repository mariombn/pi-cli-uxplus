import { HStack, VStack, isViewportTUI, type Component, type TUI, type ViewportTUI, type StackEntry } from '@earendil-works/pi-tui';

type StackNode = { type: string; entries: StackEntry[] };
function getLayoutNode(component: Component): StackNode | undefined {
  const getter = (component as any)[Symbol.for('@earendil-works/pi-tui/layout-node')];
  return typeof getter === 'function' ? getter.call(component) : undefined;
}

/** Pi 1.4.x adapter. Only layoutRoot reading is internal; fail closed if its shape changes.
 * Keep the ORIGINAL transcript ScrollView so Pi's search, keyboard and mouse still work.
 */
export function inspectLayout(tui: TUI, showLeft: () => boolean = () => true) {
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
    { ...dockEntry, component: new VStack(dock.entries.map((e, i) => ({ ...e, ...([2, 4, 5].includes(i) ? { visible: () => tui.terminal.columns < 100 || !showLeft() } : {}) }))) },
  ]);
  return { tui: tui as ViewportTUI, original, center, footer, extras };
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
