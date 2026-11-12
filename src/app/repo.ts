import { LocalRepository } from '../data/localRepository';
import type { Repository } from '../data/repository';

/** The one place that picks the storage backend. Swap in the Supabase repository here. */
export const repo: Repository = new LocalRepository();

export const APP_NAME = 'TCG Deck Tracker';
