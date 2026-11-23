import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { EfficiencyInsight } from '../types';

interface Props {
  insights: EfficiencyInsight[];
}

const BORDER_ACCENT: Record<EfficiencyInsight['severity'], string> = {
  high: 'border-l-rose-500',
  medium: 'border-l-amber-500',
  low: 'border-l-blue-500',
  positive: 'border-l-emerald-500',
};

export function EfficiencyInsights({ insights }: Props) {
  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Telemetry Diagnostics</h3>
        <span className="m-pill rounded-full px-2.5 py-0.5 font-mono text-[11px]">{insights.length} signals</span>
      </div>

      {insights.length === 0 ? (
        <div className="m-subtle rounded-xl p-4 text-xs text-[var(--text-muted)]">
          No anomalies detected.
        </div>
      ) : (
        <div className="space-y-2.5">
          {insights.map((item) => (
            <div
              key={item.id}
              className={`m-subtle rounded-xl border-l-4 p-3.5 ${BORDER_ACCENT[item.severity]}`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                {item.severity === 'positive' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : item.severity === 'high' ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                ) : (
                  <Info className="h-4 w-4 shrink-0 text-amber-500" />
                )}
                <span>{item.title}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{item.description}</p>
              <p className="mt-1.5 text-[11px] font-medium text-[var(--text-primary)]">
                → {item.recommendation}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
