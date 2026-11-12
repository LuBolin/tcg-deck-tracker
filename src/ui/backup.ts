/** Per-viewer reminder state for local backups. Storage can be unavailable; then the nudge simply shows. */
const LAST = 'last-backup';
const SNOOZE = 'backup-snoozed-until';
const DAY = 864e5;

const get = (k: string) => {
  try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; }
};
const put = (k: string, v: number) => {
  try { localStorage.setItem(k, String(v)); } catch { /* convenience only */ }
};

export const markBackedUp = () => put(LAST, Date.now());
export const snoozeBackupNudge = () => put(SNOOZE, Date.now() + 7 * DAY);

/** Remind when there is something worth losing and no backup in 14 days. */
export function shouldNudgeBackup(deckCount: number): boolean {
  if (deckCount < 3) return false;
  const now = Date.now();
  return now - get(LAST) > 14 * DAY && now > get(SNOOZE);
}
