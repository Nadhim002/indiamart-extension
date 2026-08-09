import type { LeadRecord } from '@/types';
import { LEAD_HISTORY_HEADER_ROW, buildLeadHistoryRow } from '@shared/leadHistoryPayload';

function escape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// Pure: turns recorded leads into a CSV string. No DOM, no side effects — the
// caller handles fetching leads and triggering the download.
//
// Rows are built from the same buildLeadHistoryRow() the Drive sync uses
// (@shared/leadHistoryPayload) — one column contract for both, so the CSV
// export and the sheet synced to Drive can never drift apart.
export function leadsToCsv(leads: LeadRecord[], deviceId: string): string {
  const rows = leads.map((l) => buildLeadHistoryRow(l, deviceId).map(escape).join(','));
  return [LEAD_HISTORY_HEADER_ROW.join(','), ...rows].join('\n');
}
