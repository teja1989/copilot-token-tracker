import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileJson, X } from 'lucide-react';
import { fetchExportSnapshot, type FilterParams } from '../api';

interface Props {
  filters: FilterParams;
  onClose: () => void;
}

export function ExportModal({ filters, onClose }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchExportSnapshot(filters)
      .then((snap) => {
        if (!cancelled) setData(snap);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const payload = data
    ? includeEvents
      ? data
      : { ...data, events: undefined }
    : null;

  const jsonText = payload ? JSON.stringify(payload, null, 2) : '';
  const previewText =
    jsonText.length > 24_000
      ? `${jsonText.slice(0, 24_000)}\n\n... (${(jsonText.length / 1024).toFixed(1)} KB total — click Download JSON for complete file)`
      : jsonText;

  const handleDownload = () => {
    if (!jsonText) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentpulse-telemetry-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!jsonText) return;
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="m-card flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/12 text-blue-600 dark:text-blue-400">
              <FileJson className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Export Telemetry JSON</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Review snapshot matching your active filters, copy, or download locally
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={includeEvents}
              onChange={(e) => setIncludeEvents(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-blue-600"
            />
            Include raw span events array
          </label>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              {jsonText ? `${(jsonText.length / 1024).toFixed(1)} KB` : ''}
            </span>
            <button
              onClick={handleCopy}
              disabled={loading || !jsonText}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              onClick={handleDownload}
              disabled={loading || !jsonText}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download .json
            </button>
          </div>
        </div>

        <div className="m-subtle mt-3 flex-1 overflow-auto rounded-xl p-4">
          {loading ? (
            <div className="py-12 text-center font-mono text-xs text-[var(--text-muted)]">
              Generating telemetry snapshot...
            </div>
          ) : (
            <pre className="font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
              {previewText}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
