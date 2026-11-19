// Types for the dom.js helpers used by the React + TypeScript pages.
export function toast(text: string): void;
export function confirmDialog(message: string, opts?: { title?: string; danger?: boolean; confirmText?: string; cancelText?: string }): Promise<boolean>;
export function esc(s: unknown): string;
