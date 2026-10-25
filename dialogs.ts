import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Input, truncateToWidth, visibleWidth, matchesKey, isKeyRelease } from '@earendil-works/pi-tui';
import { sanitize } from './files.ts';

export function editName(ctx: ExtensionContext, title: string, initial: string) {
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const input = new Input({ prompt: '> ' });
    // setValue() leaves the cursor at zero; bracketed paste inserts at the end
    // without interpreting a filename as a shortcut.
    input.handleInput(`\u001b[200~${sanitize(initial)}\u001b[201~`);
    input.onSubmit = value => done(value);
    input.onEscape = () => done(undefined);
    return {
      get focused() { return input.focused; },
      set focused(value: boolean) { input.focused = value; },
      invalidate() { input.invalidate(); },
      handleInput(data: string) {
        if (isKeyRelease(data)) return;
        if (matchesKey(data, 'ctrl+c')) done(undefined);
        else input.handleInput(data);
        tui.requestRender();
      },
      render(width: number) {
        const w = Math.max(1, width - 2);
        const row = (text: string) => {
          text = truncateToWidth(text, w);
          return '│' + text + ' '.repeat(Math.max(0, w - visibleWidth(text))) + '│';
        };
        return ['╭' + '─'.repeat(w) + '╮', row(theme.fg('accent', sanitize(title))), row(''),
          ...input.render(w).map(row), row(''), row('Enter confirmar · Esc cancelar'), '╰' + '─'.repeat(w) + '╯'];
      },
    };
  }, { overlay: true, overlayOptions: { width: '70%', maxHeight: '80%', anchor: 'center' } });
}
