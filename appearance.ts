import type { Theme } from '@earendil-works/pi-coding-agent';
import { parseColor } from '@earendil-works/pi-tui';

/** Shared theme token for workspace borders, prompt and working indicator.
 * Uses the active theme's red rather than hardcoding terminal escape sequences.
 */
export const WORKSPACE_COLOR = 'error' as const;

/** Subtle red backgrounds, keeping native user-message text readable. */
export const USER_MESSAGE_BACKGROUND = {
  dark: '#35171c',
  light: '#f8dfe3',
} as const;

const userBackgroundColors = {
  dark: parseColor(USER_MESSAGE_BACKGROUND.dark),
  light: parseColor(USER_MESSAGE_BACKGROUND.light),
};

/** Theme.style strings are TOKEN NAMES, not hex literals. Pass concrete Colors. */
export function paintUserMessageBackground(theme: Pick<Theme, 'style' | 'appearance'>, text: string) {
  return theme.style(text, { bg: userBackgroundColors[theme.appearance] });
}
