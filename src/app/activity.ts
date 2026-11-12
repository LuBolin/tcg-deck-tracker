import { getPref } from './prefs';
import { currentSocial } from './repo';

/** Pref key: when the player last opened the Activity page (ISO time of the newest item seen). */
export const ACTIVITY_SEEN = 'activity-seen';

/** New activity since the player last opened the Activity page (0 when signed out). */
export async function unreadActivity(): Promise<number> {
  const social = currentSocial();
  if (!social) return 0;
  const seen = getPref<string>(ACTIVITY_SEEN, '');
  return (await social.feed(50)).filter((f) => f.createdAt > seen).length;
}
