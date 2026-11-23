import { useEffect, useState } from 'react';
import { CheckCircle2, FolderPlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import type { DiscoveredSourceStatus } from '../types';

interface AgentPulseConfigData {
  vscodeDirs: string[];
  copilotTraceDbs: string[];
  copilotChatLogDirs: string[];
  claudeDirs: string[];
  antigravityDirs: string[];
  codexDirs: string[];
}

interface ConfigApiResponse {
  config: AgentPulseConfigData;
  loadedFrom: string[];
  globalConfigPath: string;
}

type EditablePathKey = 'vscodeDirs' | 'copilotChatLogDirs' | 'claudeDirs' | 'codexDirs';

interface PathSectionDef {
  key: EditablePathKey;
  label: string;
  description: string;
  placeholder: string;
}

const EMPTY_CONFIG: AgentPulseConfigData = {
  vscodeDirs: [],
  copilotTraceDbs: [],
  copilotChatLogDirs: [],
  claudeDirs: [],
  antigravityDirs: [],
  codexDirs: [],
};

const PATH_SECTIONS: PathSectionDef[] = [
  {
    key: 'vscodeDirs',
    label: 'VS Code / Cursor Data Directories',
    description: 'Custom VS Code, Insiders, VSCodium, or Cursor User data folders.',
    placeholder: '/Users/you/Library/Application Support/Code',
  },
  {
    key: 'copilotChatLogDirs',
    label: 'Copilot Chat Log & Session Directories',
    description: 'Extra folders containing GitHub Copilot Chat.log or chatSessions JSONL files.',
    placeholder: '/path/to/copilot-chat-logs',
  },
  {
    key: 'claudeDirs',
    label: 'Claude Code Project Directories',
    description: 'Additional Claude Code transcript roots beyond ~/.claude/projects.',
    placeholder: '~/.claude/projects',
  },
  {
    key: 'codexDirs',
    label: 'OpenAI Codex Session Directories',
    description: 'Additional Codex CLI session roots beyond ~/.codex/sessions.',
    placeholder: '~/.codex/sessions',
  },
];

interface Props {
  sources: DiscoveredSourceStatus[];
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal({ sources, onClose, onSaved }: Props) {
  const [config, setConfig] = useState<AgentPulseConfigData>(EMPTY_CONFIG);
  const [loadedFrom, setLoadedFrom] = useState<string[]>([]);
  const [globalConfigPath, setGlobalConfigPath] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<EditablePathKey, string>>({
    vscodeDirs: '',
    copilotChatLogDirs: '',
    claudeDirs: '',
    codexDirs: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/config');
        if (!res.ok) {
          throw new Error(`Failed to load config (${res.status})`);
        }
        const data = (await res.json()) as ConfigApiResponse;
        if (cancelled) return;
        setConfig({
          vscodeDirs: data.config?.vscodeDirs ?? [],
          copilotTraceDbs: data.config?.copilotTraceDbs ?? [],
          copilotChatLogDirs: data.config?.copilotChatLogDirs ?? [],
          claudeDirs: data.config?.claudeDirs ?? [],
          antigravityDirs: data.config?.antigravityDirs ?? [],
          codexDirs: data.config?.codexDirs ?? [],
        });
        setLoadedFrom(data.loadedFrom ?? []);
        setGlobalConfigPath(data.globalConfigPath ?? '');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load configuration');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddPath = (key: EditablePathKey) => {
    const trimmed = drafts[key].trim();
    if (!trimmed) return;
    setSavedNotice(null);
    setConfig((prev) => {
      if (prev[key].includes(trimmed)) return prev;
      return {
        ...prev,
        [key]: [...prev[key], trimmed],
      };
    });
    setDrafts((prev) => ({ ...prev, [key]: '' }));
  };

  const handleRemovePath = (key: EditablePathKey, target: string) => {
    setSavedNotice(null);
    setConfig((prev) => ({
      ...prev,
      [key]: prev[key].filter((p) => p !== target),
    }));
  };

  const handleSaveAndRescan = async () => {
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const putRes = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!putRes.ok) {
        throw new Error(`Failed to save config (${putRes.status})`);
      }

      const scanRes = await fetch('/api/scan', { method: 'POST' });
      if (!scanRes.ok) {
        throw new Error(`Saved config, but rescan failed (${scanRes.status})`);
      }
      let scanDetail = '';
      try {
        const scanData = (await scanRes.json()) as { added?: number; scannedFiles?: number };
        if (typeof scanData.scannedFiles === 'number') {
          scanDetail = ` · ${scanData.scannedFiles} file${scanData.scannedFiles === 1 ? '' : 's'} scanned`;
        }
        if (typeof scanData.added === 'number' && scanData.added > 0) {
          scanDetail += ` (+${scanData.added} spans)`;
        }
      } catch {
        // Ignore empty/non-JSON scan response
      }

      onSaved();
      setSavedNotice(`Saved & rescanned${scanDetail}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const detectedCount = sources.filter((s) => s.detected).length;
  const totalSpans = sources.reduce((sum, s) => sum + s.eventsIngested, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="m-card flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Local Source Paths & Discovery Settings
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Add custom telemetry directories for corporate or portable installs. AgentPulse watches these paths live.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Live summary of detected sources & span counts */}
          <div className="m-subtle rounded-xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Detected Sources ({detectedCount}/{sources.length})
              </span>
              <span className="m-pill rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                {totalSpans.toLocaleString()} live spans
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sources.map((src) => (
                <div
                  key={src.source}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        src.detected ? 'bg-emerald-500' : 'bg-[var(--text-muted)]/40'
                      }`}
                    />
                    <span className="truncate font-medium text-[var(--text-primary)]">{src.label}</span>
                  </div>
                  <span className="m-pill ml-2 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]">
                    {src.eventsIngested.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {savedNotice && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}

          {loading ? (
            <div className="m-subtle flex items-center justify-center gap-2 rounded-xl py-10 text-xs text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading configuration…
            </div>
          ) : (
            <div className="space-y-3.5">
              {PATH_SECTIONS.map((section) => {
                const items = config[section.key];
                return (
                  <div key={section.key} className="m-subtle rounded-xl p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{section.label}</h3>
                        <p className="text-[11px] text-[var(--text-muted)]">{section.description}</p>
                      </div>
                      <span className="m-pill rounded-full px-2 py-0.5 font-mono text-[11px]">
                        {items.length}
                      </span>
                    </div>

                    {items.length > 0 && (
                      <ul className="mt-2.5 space-y-1.5">
                        {items.map((dirPath) => (
                          <li
                            key={dirPath}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5"
                          >
                            <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
                              {dirPath}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemovePath(section.key, dirPath)}
                              aria-label={`Remove ${dirPath}`}
                              className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-2.5 flex gap-2">
                      <input
                        type="text"
                        value={drafts[section.key]}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [section.key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddPath(section.key);
                          }
                        }}
                        placeholder={section.placeholder}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddPath(section.key)}
                        disabled={!drafts[section.key].trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
          <div className="min-w-0 flex-1 font-mono text-[11px] text-[var(--text-muted)]">
            {globalConfigPath ? (
              <span className="block truncate" title={globalConfigPath}>
                Config: {globalConfigPath}
              </span>
            ) : null}
            {loadedFrom.length > 0 ? (
              <span className="block truncate" title={loadedFrom.join(', ')}>
                Loaded from {loadedFrom.length} file{loadedFrom.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAndRescan()}
              disabled={loading || saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {saving ? 'Saving & Rescanning…' : 'Save & Rescan Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
