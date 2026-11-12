import { useState } from 'react';
import { games } from '../games';

const KEY = 'last-game';

/** The game picker's value, remembered per viewer so pages open on the game last used. */
export function useGameChoice(): [string, (id: string) => void] {
  const [id, setId] = useState(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable: use the default */ }
    return games().some((g) => g.id === saved) ? saved! : games()[0]?.id ?? '';
  });
  const choose = (next: string) => {
    setId(next);
    try { localStorage.setItem(KEY, next); } catch { /* convenience only */ }
  };
  return [id, choose];
}
