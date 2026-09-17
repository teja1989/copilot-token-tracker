import type { UsageDb } from '../storage/db.js';
import type { ExportSink } from './sink.js';
import { chatEventToExportDocument, toolCallEventToExportDocument, type ExportEnvelope } from './toExportDocument.js';

export interface ExportOutcome {
  exportedCount: number;
  /** True when there was simply nothing new to send — not a failure, just a no-op cycle. */
  hadNothingNew: boolean;
}

/**
 * Exports every chat/tool-call row newer than the export watermark, then advances the
 * watermark to the newest timestamp actually sent — but only after `sink.send()`
 * resolves. If it throws, this function does NOT catch it: the watermark is left
 * exactly where it was (we never reach the line that would move it), so the next
 * scheduled call naturally retries the same rows. The caller (extension.ts's refresh())
 * is responsible for catching and logging that error — this function's only job is
 * "read what's unexported, send it, advance the watermark on success."
 */
export async function exportNewEvents(db: UsageDb, sink: ExportSink, envelope: ExportEnvelope): Promise<ExportOutcome> {
  const sinceMs = db.getExportWatermarkMs();
  const chatRows = db.getChatEventsSince(sinceMs);
  const toolRows = db.getToolCallEventsSince(sinceMs);

  if (chatRows.length === 0 && toolRows.length === 0) {
    return { exportedCount: 0, hadNothingNew: true };
  }

  const documents = [
    ...chatRows.map((row) => chatEventToExportDocument(row, envelope)),
    ...toolRows.map((row) => toolCallEventToExportDocument(row, envelope))
  ];

  await sink.send(documents);

  const newestTimestampMs = Math.max(...chatRows.map((r) => r.timestampMs), ...toolRows.map((r) => r.timestampMs));
  db.setExportWatermarkMs(newestTimestampMs);

  return { exportedCount: documents.length, hadNothingNew: false };
}
