/** "just now", "5 min ago", "3 h ago", "2 d ago" from a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") or ISO string. */
export function ago(stamp: string, now = Date.now()): string {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : stamp.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
