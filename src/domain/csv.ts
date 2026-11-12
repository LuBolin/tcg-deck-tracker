import type { ParsedLine, ParseResult } from './listParse';

/** Split CSV text into rows. Handles quoted fields, escaped quotes and CRLF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

// Header names used by common collection exports (ManaBox, Moxfield, Dragon Shield, TCGplayer, Deckbox).
const COLUMNS = {
  qty: ['quantity', 'count', 'qty', 'amount', 'have'],
  name: ['name', 'card name', 'card', 'simple name'],
  set: ['set code', 'setcode', 'edition code', 'edition', 'set'],
  number: ['collector number', 'card number', 'collector #', 'number', 'no.', 'no'],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/^\uFEFF/, '');

function findColumn(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.findIndex((h) => norm(h) === n);
    if (i >= 0) return i;
  }
  return -1;
}

/** A CSV with at least a name column in its header. */
export function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim() && !/^sep=/i.test(l.trim()));
  if (!first || !first.includes(',')) return false;
  return findColumn(parseCsvRows(first)[0] ?? [], COLUMNS.name) >= 0;
}

/**
 * Read a collection CSV into list lines. Quantity defaults to 1. A set column whose
 * values look like full set names (spaces) is ignored, so lookup falls back to the name.
 */
export function parseCollectionCsv(text: string): ParseResult {
  const rows = parseCsvRows(text.replace(/^\s*sep=.\s*\r?\n/i, ''));
  const header = rows[0] ?? [];
  const col = {
    qty: findColumn(header, COLUMNS.qty),
    name: findColumn(header, COLUMNS.name),
    set: findColumn(header, COLUMNS.set),
    number: findColumn(header, COLUMNS.number),
  };
  const lines: ParsedLine[] = [];
  const errors: ParseResult['errors'] = [];
  rows.slice(1).forEach((r, i) => {
    const lineNo = i + 2;
    const name = r[col.name]?.trim();
    const qty = col.qty >= 0 ? Number(r[col.qty]) : 1;
    const setRaw = col.set >= 0 ? r[col.set]?.trim() : undefined;
    const set = setRaw && !/\s/.test(setRaw) ? setRaw.toUpperCase() : undefined;
    const number = col.number >= 0 && set ? r[col.number]?.trim() || undefined : undefined;
    const raw = [qty, name, set, number].filter(Boolean).join(' ');
    if (!name || !Number.isFinite(qty) || qty <= 0) {
      errors.push({ lineNo, raw: r.join(',') });
      return;
    }
    lines.push({ lineNo, raw, qty: Math.floor(qty), name, set, number, section: 'main' });
  });
  return { lines, errors };
}

const csvField = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Collection rows as CSV with the column names this app (and most collection apps) read back. */
export function collectionToCsv(rows: { qty: number; name: string; set?: string; number?: string; location: string }[]): string {
  const out = ['Quantity,Name,Set code,Collector number,Location'];
  for (const r of rows) out.push([r.qty, r.name, r.set, r.number, r.location].map(csvField).join(','));
  return out.join('\n');
}
