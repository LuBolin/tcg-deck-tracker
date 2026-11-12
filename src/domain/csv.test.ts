import { describe, expect, it } from 'vitest';
import { looksLikeCsv, parseCollectionCsv, parseCsvRows } from './csv';

describe('collection CSV', () => {
  it('splits quoted fields with commas and quotes', () => {
    expect(parseCsvRows('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('reads a ManaBox-style export', () => {
    const text = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity\n"Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",neo,Kamigawa: Neon Dynasty,141,normal,rare,2\nLightning Bolt,2x2,Double Masters 2022,117,foil,uncommon,4';
    expect(looksLikeCsv(text)).toBe(true);
    const r = parseCollectionCsv(text);
    expect(r.lines.map((l) => [l.qty, l.name, l.set, l.number])).toEqual([
      [2, 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'NEO', '141'],
      [4, 'Lightning Bolt', '2X2', '117'],
    ]);
  });

  it('reads a Dragon Shield export with sep= line and ignores full set names', () => {
    const text = 'sep=,\nFolder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number\nBinder,3,0,Iono,PAL,Paldea Evolved,185\nBinder,1,0,Arven,Scarlet & Violet,SVI,166';
    const r = parseCollectionCsv(text);
    expect(r.lines.map((l) => [l.qty, l.name, l.set, l.number])).toEqual([
      [3, 'Iono', 'PAL', '185'],
      [1, 'Arven', undefined, undefined],
    ]);
  });

  it('reports rows without a name or a valid quantity, and is not fooled by deck lists', () => {
    const r = parseCollectionCsv('Count,Name\n2,Opt\nx,Shock\n1,');
    expect(r.lines.map((l) => l.name)).toEqual(['Opt']);
    expect(r.errors.map((e) => e.lineNo)).toEqual([3, 4]);
    expect(looksLikeCsv('4 Lightning Bolt\n2 Opt')).toBe(false);
  });
});

describe('collection CSV export', async () => {
  const { collectionToCsv } = await import('./csv');
  it('round-trips through the importer, quoting commas and quotes', () => {
    const csv = collectionToCsv([
      { qty: 3, name: 'Krenko, Mob Boss', set: 'M13', number: '139', location: 'Binder' },
      { qty: 1, name: 'Say "Hi"', location: 'Deck A' },
    ]);
    const r = parseCollectionCsv(csv);
    expect(r.lines.map((l) => [l.qty, l.name, l.set, l.number])).toEqual([[3, 'Krenko, Mob Boss', 'M13', '139'], [1, 'Say "Hi"', undefined, undefined]]);
  });
});
