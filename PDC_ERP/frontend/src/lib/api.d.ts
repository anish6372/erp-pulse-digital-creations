// Types for api.js, used by the React + TypeScript pages.
export function api<T = any>(path: string, opt?: RequestInit): Promise<T>;
export function runJob<T = any>(path: string, body?: unknown, onProgress?: (p: { done: number; total: number; message?: string }) => void): Promise<T>;
