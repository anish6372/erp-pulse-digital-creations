// Typed wrappers around the app's existing fetch helper, so components never deal with untyped JSON.
import { api } from '../../lib/api.js';
import type { Report, ReportForm, ReportRow } from './types';

const parse = <T,>(json: string | null | undefined, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Turns a stored row (JSON columns as text) into a Report the UI can show. */
export function rowToReport(r: ReportRow): Report {
  return {
    id: r.id,
    business_name: r.business_name,
    website_url: r.website_url,
    instagram: {
      handle: r.instagram_handle,
      followers: r.instagram_followers,
      last_post: r.instagram_last_post,
      posting_frequency: r.instagram_posting_frequency,
      notes: r.instagram_notes,
    },
    website_signals: parse(r.website_signals, {}),
    swot: parse(r.swot, {}),
    strategy: r.strategy,
  };
}

export async function fetchConfig(): Promise<{ enabled: boolean }> {
  return api('/api/prospect/config');
}

export async function fetchReports(): Promise<ReportRow[]> {
  const d: { rows?: ReportRow[] } = await api('/api/prospect');
  return d.rows ?? [];
}

export async function analyze(form: ReportForm): Promise<Report> {
  return api('/api/prospect/analyze', { method: 'POST', body: JSON.stringify(form) });
}

export async function deleteReport(id: number): Promise<void> {
  await api('/api/prospect/' + id, { method: 'DELETE' });
}
