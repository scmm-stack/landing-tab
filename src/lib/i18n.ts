import { browser } from 'wxt/browser';

export type MessageKey = keyof typeof import('../../public/_locales/en/messages.json');

export function t(key: MessageKey, ...substitutions: string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key;
}
