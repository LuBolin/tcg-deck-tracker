import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { demoAdapter } from '../games/demo';
import { readList } from './importing';

describe('readList', () => {
  it('reports progress in chunks and keeps every line', async () => {
    const text = Array.from({ length: 100 }, () => '1 Ember Fox BAS 1').join('\n');
    const seen: [number, number][] = [];
    const { resolved } = await readList(demoAdapter, text, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([[40, 100], [80, 100], [100, 100]]);
    expect(resolved.filter((r) => r.card).length).toBe(100);
  });
});
