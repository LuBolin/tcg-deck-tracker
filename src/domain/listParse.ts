/** Generic deck-list text parsing. Game adapters supply the format rules. */

export interface ParsedLine {
  lineNo: number;
  raw: string;
  qty: number;
  name: string;
  set?: string;
  number?: string;
  section: string;
}

export interface ParseError {
  lineNo: number;
  raw: string;
  /** Section the line was in, so a corrected line lands in the same place. */
  section?: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  errors: ParseError[];
}

export interface Printing {
  name: string;
  set?: string;
  number?: string;
}

export interface ListFormat {
  /** A section id for a header line, 'ignore' for a line to skip, or undefined when it is not a header. */
  header(line: string): string | 'ignore' | undefined;
  /** Split the text after the quantity into a name and an optional printing. */
  splitPrinting(rest: string): Printing;
  /** MTGO-style lists put the sideboard after a blank line. */
  blankLineStartsSideboard?: boolean;
}

const QTY_LINE = /^(\d+)\s*x?\s+(.+)$/i;

export function parseList(text: string, format: ListFormat): ParseResult {
  const lines: ParsedLine[] = [];
  const errors: ParseError[] = [];
  let section = 'main';
  let sawCard = false;
  const rows = text.split(/\r?\n/);
  // MTGO-style "blank line = sideboard" applies only when the list has no sideboard header.
  const blankBreaks = format.blankLineStartsSideboard && !rows.some((r) => r.trim() && !QTY_LINE.test(r.trim()) && format.header(r.trim()) === 'sideboard');

  rows.forEach((rawLine, i) => {
    const raw = rawLine.trim();
    const lineNo = i + 1;
    if (!raw) {
      if (blankBreaks && sawCard && section === 'main') section = 'sideboard';
      return;
    }
    const m = QTY_LINE.exec(raw);
    if (m) {
      const qty = Number(m[1]);
      const p = format.splitPrinting(m[2].trim());
      if (qty <= 0 || !p.name) {
        errors.push({ lineNo, raw, section });
        return;
      }
      lines.push({ lineNo, raw, qty, section, ...p });
      sawCard = true;
      return;
    }
    const h = format.header(raw);
    if (h === 'ignore') return;
    if (h !== undefined) {
      section = h;
      return;
    }
    errors.push({ lineNo, raw, section });
  });

  return { lines, errors };
}

/** "Lightning Bolt (2X2) 117" → set 2X2, number 117. Also drops an Arena foil marker "*F*". */
export function splitArena(rest: string): Printing | undefined {
  const m = /^(.*?)\s+\(([A-Za-z0-9]{2,8})\)\s+(\S+?)(?:\s+\*F\*)?$/.exec(rest);
  return m ? { name: m[1].trim(), set: m[2].toUpperCase(), number: m[3] } : undefined;
}

/** "Iono PAL 185" → set PAL, number 185. */
export function splitTrailingSetNumber(rest: string): Printing | undefined {
  // A set code may start with a digit (30C) but must contain a letter, so plain numbers are never codes.
  const m = /^(.*?)\s+((?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{1,7})\s+([A-Za-z]{0,4}\d+[A-Za-z]?)$/.exec(rest);
  return m ? { name: m[1].trim(), set: m[2], number: m[3] } : undefined;
}

/** "4 Iono" style lines and printed lines share one output shape. */
export function formatPrinting(qty: number, p: Printing): string {
  return [String(qty), p.name, p.set, p.number].filter(Boolean).join(' ');
}
