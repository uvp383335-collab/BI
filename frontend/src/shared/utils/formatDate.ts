/** Formats an ISO date string as a locale-aware date + time, e.g. "Aug 17, 2026, 9:00 AM". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
