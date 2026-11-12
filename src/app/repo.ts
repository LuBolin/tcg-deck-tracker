import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LocalRepository } from '../data/localRepository';
import type { Repository } from '../data/repository';
import { SupabaseRepository } from '../data/supabaseRepository';
import { loadPrefs } from './prefs';
import { Social } from '../data/social';

export const APP_NAME = 'TCG Deck Tracker';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
/** Undefined when the build has no Supabase settings: the app then runs on browser storage only. */
export const supabase: SupabaseClient | undefined =
  url && key ? createClient(url, key, { auth: { flowType: 'implicit' } }) : undefined; // implicit: a sign-in link works when opened on another device

/** This browser's own storage. Stays available after sign-in, to copy its data into the account. */
export const localRepo = new LocalRepository();

let current: Repository = localRepo;
let account: { id: string; email: string } | undefined;
let social: Social | undefined;

/** Sign-in providers switched on in the Supabase project (Authentication → Providers), for example "google". */
export async function enabledProviders(): Promise<string[]> {
  if (!url || !key) return [];
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!res.ok) return [];
  const body = (await res.json()) as { external?: Record<string, boolean> };
  return Object.entries(body.external ?? {}).filter(([, on]) => on).map(([p]) => p);
}

/** Following and public decks; undefined until signed in. */
export const currentSocial = () => social;

/** The signed-in account, or undefined when data is stored in this browser. */
export const currentAccount = () => account;

/**
 * Pick the storage before the first render: the account when signed in, else this browser.
 * shortcut: no offline mode for accounts; without a session (or a network to refresh it) the app shows browser data.
 */
export async function initRepo() {
  await pickStorage();
  await loadPrefs(current);
}

async function pickStorage() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (user) {
    current = new SupabaseRepository(supabase, user.id);
    account = { id: user.id, email: user.email ?? '' };
    social = new Social(supabase, user.id);
  }
  // Signing in or out (here or in another tab) switches the storage; a reload keeps every page consistent.
  supabase.auth.onAuthStateChange((event, session) => {
    const changed = event === 'SIGNED_OUT' ? !!account : event === 'SIGNED_IN' && session?.user.id !== account?.id;
    if (changed) location.reload();
  });
}

/** The one storage the app talks to; it forwards to the account or browser storage picked by initRepo. */
export const repo: Repository = new Proxy({} as Repository, {
  get: (_t, k) => {
    const v = (current as unknown as Record<PropertyKey, unknown>)[k];
    return typeof v === 'function' ? v.bind(current) : v;
  },
});
