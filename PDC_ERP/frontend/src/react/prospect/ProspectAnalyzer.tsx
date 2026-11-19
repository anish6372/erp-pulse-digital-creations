// Prospect Analyzer (Admin only), written in React + TypeScript. The rest of the app is plain JS;
// this page is mounted into its <section> by mount.tsx, and reuses the same API helper,
// toasts, confirm dialog and CSS classes, so it looks and behaves like every other page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, confirmDialog } from '../../lib/dom.js';
import { analyze, deleteReport, fetchConfig, fetchReports, rowToReport } from './prospectApi';
import { NewReportForm, ReportHistory, ReportView } from './components';
import type { Report, ReportForm, ReportRow } from './types';

export default function ProspectAnalyzer() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [current, setCurrent] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([fetchConfig(), fetchReports()]);
      setEnabled(cfg.enabled);
      setRows(list);
    } catch {
      setEnabled(false);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Scroll down to the report whenever a new one is opened.
  useEffect(() => {
    if (current) reportRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [current]);

  const handleSubmit = async (form: ReportForm): Promise<boolean> => {
    setBusy(true);
    try {
      const report = await analyze(form);
      setCurrent(report);
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message || 'Could not generate the report');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (row: ReportRow) => {
    const ok = await confirmDialog(`Delete the report for ${row.business_name}?`, { title: 'Delete Report', confirmText: 'Delete' });
    if (!ok) return;
    try {
      await deleteReport(row.id);
      toast('Report deleted');
      if (current?.id === row.id) setCurrent(null);
      setRows((rs) => rs.filter((r) => r.id !== row.id)); // optimistic: no need to refetch the list
    } catch (e) {
      toast((e as Error).message || 'Could not delete report');
    }
  };

  return (
    <>
      <div className="title">
        <h1>Prospect Analyzer</h1>
        <p>Give it a business's website and Instagram, get back a SWOT and a tailored pitch strategy before you walk in. Leads added in Client Hunter appear here automatically.</p>
      </div>

      {enabled === false && (
        <div className="notice warn">
          AI strategy generation isn't configured yet (no Anthropic API key set on the server). Everything else on this page still works; you just won't get a generated report.
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <NewReportForm disabled={enabled === false} busy={busy} onSubmit={handleSubmit} />
          <ReportHistory rows={rows} selectedId={current?.id} onView={(r) => setCurrent(rowToReport(r))} onDelete={handleDelete} />
        </div>
      )}

      <div ref={reportRef}>{current && <ReportView report={current} />}</div>
    </>
  );
}
