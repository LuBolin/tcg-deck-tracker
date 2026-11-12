import { describe, expect, it } from 'vitest';
import { parseList } from '../domain/listParse';
import { parseWantList } from '../domain/wantlist';
import { createMtgAdapter, mainType } from './mtg';
import { createPokemonAdapter, functionalId, normalizeEnergyName } from './pokemon';

/** A fake fetch that answers from a table of URL prefixes. */
function fakeFetch(routes: [string, (init?: RequestInit) => unknown][]) {
  const calls: string[] = [];
  const fn = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    calls.push(url);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new Error(`Request failed (404): ${url}`);
    return route[1](init) as T;
  };
  return { fn, calls };
}

describe('pokemon', () => {
  const T = 'https://api.tcgdex.net/v2/en';
  const iono = { id: 'sv02-185', localId: '185', name: 'Iono', category: 'Trainer', image: 'https://img/sv02/185', set: { id: 'sv02', name: 'Paldea Evolved' } };
  const ionoReprint = { ...iono, id: 'sv04.5-080', localId: '080', set: { id: 'sv04.5', name: 'Paldean Fates' } };
  const fire = { id: 'sve-002', localId: '002', name: 'Fire Energy', category: 'Energy', set: { id: 'sve', name: 'SV Energy' } };
  const { fn, calls } = fakeFetch([
    [`${T}/sets?abbreviation.official=PAL`, () => [{ id: 'sv02' }]],
    [`${T}/sets?abbreviation.official=SVE`, () => [{ id: 'sve' }]],
    [`${T}/sets?abbreviation.official=`, () => []],
    [`${T}/sets/sv02`, () => ({ id: 'sv02', abbreviation: { official: 'PAL' }, cards: [{ id: 'sv02-185', localId: '185', name: 'Iono' }] })],
    [`${T}/sets/sve`, () => ({ id: 'sve', abbreviation: { official: 'SVE' }, cards: [{ id: 'sve-002', localId: '002', name: 'Fire Energy' }] })],
    [`${T}/sets/sv04.5`, () => ({ id: 'sv04.5', abbreviation: { official: 'PAF' }, cards: [] })],
    [`${T}/cards/sv02-185`, () => iono],
    [`${T}/cards/sv04.5-080`, () => ionoReprint],
    [`${T}/cards/sve-002`, () => fire],
    [`${T}/cards?name=eq:Iono`, () => [{ id: 'sv04.5-080', localId: '080', name: 'Iono', image: 'x' }, { id: 'A1-1', localId: '1', name: 'Iono', image: 'https://a/tcgp/A1/1' }]],
    [`${T}/cards?name=eq:`, () => []],
  ]);
  const adapter = createPokemonAdapter(fn);

  it('parses a Pokemon TCG Live export and skips its headers', () => {
    const r = parseList('Pokémon: 0\nTrainer: 5\n4 Iono PAL 185\n1 Iono\nEnergy: 4\n4 Basic {R} Energy SVE 2\nTotal Cards: 9', adapter.listFormat);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.qty, l.name, l.set, l.number])).toEqual([
      [4, 'Iono', 'PAL', '185'],
      [1, 'Iono', undefined, undefined],
      [4, 'Basic {R} Energy', 'SVE', '2'],
    ]);
  });

  it('resolves by set code and number, then by name, and treats reprints as one card', async () => {
    const { lines } = parseList('4 Iono PAL 185\n1 Iono\n4 Basic {R} Energy SVE 2\n1 Nothing Here XYZ 9\n1 Iono SVE 2', adapter.listFormat);
    const r = await adapter.resolve(lines);
    // The last line has a wrong printing (SVE 2 is Fire Energy): the name wins.
    expect(r.map((x) => x.card?.name)).toEqual(['Iono', 'Iono', 'Fire Energy', undefined, 'Iono']);
    expect(r[0].card!.id).toBe(r[1].card!.id); // PAL 185 and the PAF reprint are the same in play
    expect(r[0].card).toMatchObject({ set: 'PAL', number: '185', category: 'Trainer', imageUrl: 'https://img/sv02/185/low.webp' });
    expect(r[2].card).toMatchObject({ id: 'energy:fire energy', set: 'SVE', number: '2' });
    expect(calls.filter((c) => c.includes('/sets/sv02')).length).toBe(1); // cached
  });

  it('tells apart same-name Pokemon with different attacks', () => {
    const a = functionalId({ name: 'Pikachu ex', category: 'Pokemon', hp: 200, attacks: [{ name: 'Thunder', damage: 200 }] });
    const b = functionalId({ name: 'Pikachu ex', category: 'Pokemon', hp: 190, attacks: [{ name: 'Volt', damage: 120 }] });
    const a2 = functionalId({ name: 'Pikachu ex', category: 'Pokemon', hp: 200, attacks: [{ name: 'Thunder', damage: 200 }] });
    expect(a).not.toBe(b);
    expect(a).toBe(a2);
  });

  it('normalizes basic energy names', () => {
    expect(normalizeEnergyName('Basic {R} Energy')).toBe('Fire Energy');
    expect(normalizeEnergyName('Basic Water Energy')).toBe('Water Energy');
  });

  it('exports in Pokemon TCG Live format and reads want-list prices', () => {
    const text = adapter.formatList([
      { cardId: 'x', name: 'Iono', qty: 4, section: 'main', set: 'PAL', number: '185', category: 'Trainer' },
      { cardId: 'y', name: 'Charmander', qty: 2, section: 'main', set: 'MEW', number: '4', category: 'Pokémon' },
    ]);
    expect(text).toBe('Pokémon: 2\n2 Charmander MEW 4\n\nTrainer: 4\n4 Iono PAL 185');
    const { items } = parseWantList('Want to buy\n2 Iono PAL 185 @ $3.50', adapter.listFormat);
    expect(items[0]).toMatchObject({ qty: 2, name: 'Iono', set: 'PAL', number: '185', price: '$3.50' });
  });
});

describe('mtg', () => {
  const S = 'https://api.scryfall.com';
  const bolt = { oracle_id: 'bolt', name: 'Lightning Bolt', layout: 'normal', set: '2x2', collector_number: '117', type_line: 'Instant', image_uris: { small: 's' } };
  const fable = {
    oracle_id: 'fable', name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', layout: 'transform', set: 'neo', collector_number: '141',
    type_line: 'Enchantment — Saga // Enchantment Creature — Goblin Shaman',
    card_faces: [{ name: 'Fable of the Mirror-Breaker', image_uris: { small: 'f' } }, { name: 'Reflection of Kiki-Jiki' }],
  };
  const fireIce = { oracle_id: 'fireice', name: 'Fire // Ice', layout: 'split', set: 'mh2', collector_number: '290', type_line: 'Instant // Instant', card_faces: [{ name: 'Fire' }, { name: 'Ice' }] };
  const { fn } = fakeFetch([
    [`${S}/cards/collection`, (init) => {
      const ids = JSON.parse(String(init?.body)).identifiers as Record<string, string>[];
      if (ids.some((id) => id.name?.includes('//'))) throw new Error('Scryfall does not find "A // B" names');
      const all = [bolt, fable, fireIce];
      return {
        data: ids.flatMap((id) =>
          all.filter((c) => (id.name ? c.name.toLowerCase().startsWith(id.name.toLowerCase()) : c.set === id.set && c.collector_number === id.collector_number)),
        ),
      };
    }],
    [`${S}/cards/search?q=zzz`, () => { throw new Error('Request failed (404): search'); }],
    [`${S}/cards/search`, () => ({ data: [bolt] })],
  ]);
  const adapter = createMtgAdapter(fn);

  it('parses Arena and plain lists with sideboards', () => {
    const arena = parseList('Commander\n1 Fable of the Mirror-Breaker\n\nDeck\n4 Lightning Bolt (2X2) 117\n\nSideboard\n2 Duress', adapter.listFormat);
    expect(arena.lines.map((l) => [l.section, l.name, l.set])).toEqual([
      ['commander', 'Fable of the Mirror-Breaker', undefined],
      ['main', 'Lightning Bolt', '2X2'],
      ['sideboard', 'Duress', undefined],
    ]);
    const plain = parseList('4 Lightning Bolt\n4x Opt\n\n2 Duress', adapter.listFormat);
    expect(plain.lines.map((l) => l.section)).toEqual(['main', 'main', 'sideboard']);
  });

  it('resolves printings, falls back to names, and uses front-face names', async () => {
    const { lines } = parseList('4 Lightning Bolt (2X2) 117\n2 Lightning Bolt (XXX) 1\n3 Fable of the Mirror-Breaker\n1 Not A Card\n2 Fire // Ice\n1 Fable of the Mirror-Breaker (2X2) 117', adapter.listFormat);
    const r = await adapter.resolve(lines);
    // The last line points at Lightning Bolt's printing: the name wins.
    expect(r.map((x) => x.card?.id)).toEqual(['bolt', 'bolt', 'fable', undefined, 'fireice', 'fable']);
    expect(r[4].card?.name).toBe('Fire // Ice');
    expect(r[0].card).toMatchObject({ set: '2X2', number: '117', category: 'Instant' });
    expect(r[2].card).toMatchObject({ name: 'Fable of the Mirror-Breaker', category: 'Enchantment' });
  });

  it('exports Arena format and treats "no results" as empty', async () => {
    expect(adapter.formatList([
      { cardId: 'bolt', name: 'Lightning Bolt', qty: 4, section: 'main', set: '2X2', number: '117' },
      { cardId: 'd', name: 'Duress', qty: 2, section: 'sideboard' },
    ])).toBe('Deck\n4 Lightning Bolt (2X2) 117\n\nSideboard\n2 Duress');
    expect(await adapter.search('zzz')).toEqual([]);
    expect((await adapter.search('bolt')).map((c) => c.name)).toEqual(['Lightning Bolt']);
  });

  it('picks the main card type', () => {
    expect(mainType('Artifact Creature — Golem')).toBe('Creature');
    expect(mainType('Basic Land — Mountain')).toBe('Land');
  });
});

describe('game detection', () => {
  it('spots Pokémon and MTG list formats', async () => {
    const { detectGame } = await import('./index');
    expect(detectGame('Pokémon: 12\n4 Charmander MEW 4')).toBe('pokemon');
    expect(detectGame('4 Basic {R} Energy SVE 2')).toBe('pokemon');
    expect(detectGame('4 Lightning Bolt (2X2) 117')).toBe('mtg');
    expect(detectGame('4 Opt\n\nSideboard\n2 Duress')).toBe('mtg');
    expect(detectGame('4 Iono')).toBeUndefined();
  });
});

describe('yugioh', async () => {
  const { createYugiohAdapter, ydkToList } = await import('./yugioh');
  const { validateDeck, describeIssue } = await import('../domain/rules');
  const ash = { id: 14558127, name: 'Ash Blossom & Joyous Spring', type: 'Tuner Monster', frameType: 'effect', card_prices: [{ tcgplayer_price: '0.44' }], banlist_info: {} };
  const talker = { id: 86066372, name: 'Accesscode Talker', type: 'Link Monster', frameType: 'link', banlist_info: { ban_tcg: 'Limited' } };
  const pot = { id: 84211599, name: 'Pot of Prosperity', type: 'Spell Card', frameType: 'spell', banlist_info: { ban_tcg: 'Forbidden' } };
  const all = [ash, talker, pot];
  const { fn, calls } = fakeFetch([
    ['https://db.ygoprodeck.com/api/v7/cardinfo.php?id=', () => ({ data: all.filter((c) => calls.at(-1)!.includes(String(c.id))) })],
    ['https://db.ygoprodeck.com/api/v7/cardinfo.php?name=', () => {
      const names = decodeURIComponent(calls.at(-1)!.split('name=')[1]).toLowerCase().split('|');
      const data = all.filter((c) => names.includes(c.name.toLowerCase()));
      if (!data.length) throw new Error('Request failed (400): none');
      return { data };
    }],
  ]);
  const adapter = createYugiohAdapter(fn);

  it('turns a .ydk file into counted lines by section', () => {
    expect(ydkToList('#created by X\n#main\n14558127\n14558127\n84211599\n#extra\n86066372\n!side\n')).toBe(
      'Main Deck\n2 #14558127\n1 #84211599\n\nExtra Deck\n1 #86066372\n',
    );
  });

  it('resolves passcodes and names, and moves Extra Deck monsters to the Extra Deck', async () => {
    const { parseList } = await import('../domain/listParse');
    const ydk = parseList(adapter.preprocess!('#main\n14558127\n#extra\n86066372'), adapter.listFormat);
    const r1 = await adapter.resolve(ydk.lines);
    expect(r1.map((r) => [r.card?.name, r.line.section])).toEqual([['Ash Blossom & Joyous Spring', 'main'], ['Accesscode Talker', 'extra']]);
    const plain = parseList('3 ash blossom & joyous spring\n1 Accesscode Talker\n1 Not Real', adapter.listFormat);
    const r2 = await adapter.resolve(plain.lines);
    expect(r2.map((r) => [r.card?.id, r.line.section])).toEqual([['14558127', 'main'], ['86066372', 'extra'], [undefined, 'main']]);
    expect(r2[0].card).toMatchObject({ category: 'Monster', price: 0.44 });
  });

  it('applies the banlist and the 40-60 main deck range', async () => {
    const { toCard } = await import('./yugioh');
    const cards = new Map(all.map((c) => [String(c.id), toCard(c)]));
    const lines = [
      { cardId: '14558127', name: ash.name, qty: 3, section: 'main' },
      { cardId: '84211599', name: pot.name, qty: 1, section: 'main' },
      { cardId: '86066372', name: talker.name, qty: 2, section: 'extra' },
    ];
    expect(validateDeck(lines, adapter.deckRules(), cards).map(describeIssue)).toEqual([
      'Deck has 4 cards; it needs at least 40',
      'Pot of Prosperity is forbidden',
      '2 copies of Accesscode Talker; the limit is 1',
    ]);
  });
});

describe('lorcana', async () => {
  const { createLorcanaAdapter } = await import('./lorcana');
  const elsa = { name: 'Elsa', version: 'Spirit of Winter', type: ['Character'], cost: 8, collector_number: '42', set: { code: '1', name: 'The First Chapter' }, prices: { usd: 2.5 }, legalities: { core: 'legal', infinity: 'legal' }, image_uris: { digital: { small: 'e' } } };
  const elsaOther = { ...elsa, version: 'Snow Queen', cost: 6, collector_number: '41' };
  const song = { name: 'Be Prepared', version: null, type: ['Action', 'Song'], cost: 7, collector_number: '128', set: { code: '1', name: 'The First Chapter' }, legalities: { core: 'not_legal', infinity: 'legal' } };
  const { fn, calls } = fakeFetch([
    ['https://api.lorcast.com/v0/cards/search?q=', () => {
      const q = decodeURIComponent(calls.at(-1)!.split('q=')[1]).toLowerCase();
      return { results: [elsa, elsaOther, song].filter((c) => q.split(' ').every((w) => `${c.name} ${c.version ?? ''}`.toLowerCase().includes(w))) };
    }],
  ]);
  const adapter = createLorcanaAdapter(fn);

  it('matches "Name - Version" exactly and keeps versions apart', async () => {
    const { parseList } = await import('../domain/listParse');
    const { lines } = parseList('4 Elsa - Spirit of Winter\n2 elsa - snow queen\n3 Be Prepared\n1 Elsa - Nope', adapter.listFormat);
    const r = await adapter.resolve(lines);
    expect(r.map((x) => x.card?.name)).toEqual(['Elsa - Spirit of Winter', 'Elsa - Snow Queen', 'Be Prepared', undefined]);
    expect(r[0].card!.id).not.toBe(r[1].card!.id);
    expect(r[2].card).toMatchObject({ category: 'Song', legal: ['infinity'], cost: 7 });
    expect(adapter.formatList(r.filter((x) => x.card).map((x) => ({ cardId: x.card!.id, name: x.card!.name, qty: x.line.qty, section: 'main' })))).toBe(
      '4 Elsa - Spirit of Winter\n2 Elsa - Snow Queen\n3 Be Prepared',
    );
  });
});

describe('yugioh ydk export', async () => {
  const { toYdk, ydkToList } = await import('./yugioh');
  it('writes one passcode per copy and reads back the same counts', () => {
    const ydk = toYdk([
      { cardId: '14558127', name: 'Ash', qty: 2, section: 'main' },
      { cardId: '86066372', name: 'Talker', qty: 1, section: 'extra' },
      { cardId: '94145021', name: 'Droll', qty: 1, section: 'sideboard' },
    ]);
    expect(ydk).toBe('#created by TCG Deck Tracker\n#main\n14558127\n14558127\n#extra\n86066372\n!side\n94145021');
    expect(ydkToList(ydk)).toBe('Main Deck\n2 #14558127\n\nExtra Deck\n1 #86066372\n\nSide Deck\n1 #94145021\n');
  });
});

describe('one piece', async () => {
  const { createOnePieceAdapter } = await import('./onepiece');
  const { validateDeck, describeIssue } = await import('../domain/rules');
  const { parseList } = await import('../domain/listParse');
  const { detectGame } = await import('./index');
  const zoroLeader = { card_name: 'Roronoa Zoro (001)', card_set_id: 'OP01-001', card_type: 'Leader', market_price: 2.2, card_image: 'z' };
  const nami = { card_name: 'Nami', card_set_id: 'OP01-016', card_type: 'Character', card_cost: '1', market_price: 3 };
  const namiAlt = { ...nami, card_name: 'Nami (Parallel)', market_price: 400 };
  const luffy = { card_name: 'Monkey.D.Luffy', card_set_id: 'ST01-012', card_type: 'Character', card_cost: '5' };
  const { fn, calls } = fakeFetch([
    ['https://optcgapi.com/api/sets/card/OP01-001/', () => [zoroLeader]],
    ['https://optcgapi.com/api/sets/card/OP01-016/', () => [namiAlt, nami]],
    ['https://optcgapi.com/api/decks/card/ST01-012/', () => [luffy]],
    ['https://optcgapi.com/api/sets/filtered/?card_name=Nami', () => [namiAlt, nami]],
  ]);
  const adapter = createOnePieceAdapter(fn);

  it('reads "4xOP01-016" lists, puts the Leader in its section, and skips parallel art', async () => {
    const text = '1xOP01-001\n4xOP01-016\n4x ST01-012\n2 Nami';
    expect(detectGame(text)).toBe('onepiece');
    const { lines } = parseList(adapter.preprocess!(text), adapter.listFormat);
    const r = await adapter.resolve(lines);
    expect(r.map((x) => [x.card?.id, x.card?.name, x.line.section])).toEqual([
      ['OP01-001', 'Roronoa Zoro', 'leader'],
      ['OP01-016', 'Nami', 'main'],
      ['ST01-012', 'Monkey.D.Luffy', 'main'],
      ['OP01-016', 'Nami', 'main'],
    ]);
    expect(r[1].card?.price).toBe(3); // base printing, not the parallel
    expect(calls.some((c) => c.includes('/decks/card/ST01-012/'))).toBe(true);
  });

  it('counts the copy limit by card number, not name', () => {
    const rules = adapter.deckRules();
    const lines = [
      { cardId: 'OP01-001', name: 'Roronoa Zoro', qty: 1, section: 'leader' },
      { cardId: 'OP01-016', name: 'Nami', qty: 4, section: 'main' },
      { cardId: 'OP02-036', name: 'Nami', qty: 4, section: 'main' }, // same name, different card: allowed
      { cardId: 'ST01-012', name: 'Monkey.D.Luffy', qty: 5, section: 'main' },
    ];
    expect(validateDeck(lines, rules).map(describeIssue)).toEqual([
      'Deck has 13 cards; it needs exactly 50',
      '5 copies of Monkey.D.Luffy; the limit is 4',
    ]);
  });
});

describe('pokemon subtypes', async () => {
  const { subtypeOf } = await import('./pokemon');
  it('maps stage, trainer type and energy kind', () => {
    expect(subtypeOf({ category: 'Pokemon', stage: 'Stage1' })).toBe('Stage 1');
    expect(subtypeOf({ category: 'Pokemon', stage: 'Basic' })).toBe('Basic');
    expect(subtypeOf({ category: 'Trainer', trainerType: 'Supporter' })).toBe('Supporter');
    expect(subtypeOf({ category: 'Energy', energyType: 'Normal' })).toBe('Basic Energy');
  });
});

describe('pokemon printing order', async () => {
  const { createPokemonAdapter } = await import('./pokemon');
  const T = 'https://api.tcgdex.net/v2/en';
  const ball = (id: string, set: string) => ({ id, localId: id.split('-')[1], name: 'Ultra Ball', category: 'Trainer', image: `img/${id}`, set: { id: set, name: set } });
  const { fn } = fakeFetch([
    [`${T}/cards?name=eq:Ultra%20Ball`, () => [{ id: 'old-1', localId: '1', name: 'Ultra Ball', image: 'x' }, { id: 'new-2', localId: '2', name: 'Ultra Ball', image: 'y' }]],
    [`${T}/cards/old-1`, () => ball('old-1', 'old')],
    [`${T}/cards/new-2`, () => ball('new-2', 'new')],
    [`${T}/sets/old`, () => ({ id: 'old', abbreviation: { official: 'OLD' }, cards: [] })],
    [`${T}/sets/new`, () => ({ id: 'new', abbreviation: { official: 'NEW' }, cards: [] })],
    [`${T}/sets`, () => [{ id: 'old' }, { id: 'new' }]], // release order, oldest first
  ]);
  it('matches a name-only line to the newest printing even when the API lists an old one first', async () => {
    const r = await createPokemonAdapter(fn).resolve([{ lineNo: 1, raw: '4 Ultra Ball', qty: 4, name: 'Ultra Ball', section: 'main' }]);
    expect(r[0].card).toMatchObject({ set: 'NEW', number: '2' });
  });
});

describe('color rules', async () => {
  const { tooManyInks } = await import('./lorcana');
  const { offColor } = await import('./onepiece');
  const c = (id: string, identity?: string[]) => [id, { game: 'x', id, name: id, identity }] as const;
  const l = (id: string, section = 'main') => ({ cardId: id, name: id, qty: 1, section });
  it('Lorcana: at most two inks', () => {
    const cards = new Map([c('a', ['Amber']), c('b', ['Ruby']), c('d', ['Amber', 'Sapphire'])]);
    expect(tooManyInks([l('a'), l('b')], cards)).toEqual([]);
    expect(tooManyInks([l('a'), l('b'), l('d')], cards)).toEqual(['Uses 3 inks (Amber, Ruby, Sapphire); a deck can have at most 2']);
  });
  it('One Piece: cards share a color with the Leader', () => {
    const cards = new Map([c('law', ['Green', 'Red']), c('nami', ['Red']), c('blue', ['Blue']), c('mix', ['Blue', 'Green'])]);
    expect(offColor([l('law', 'leader'), l('nami'), l('mix'), l('blue')], cards)).toEqual(["Not the Leader's color (Green/Red): blue"]);
  });
});

describe('fixed sections for added cards', async () => {
  const { yugiohAdapter } = await import('./yugioh');
  const { onePieceAdapter } = await import('./onepiece');
  it('sends Extra Deck monsters and Leaders to their sections', () => {
    expect(yugiohAdapter.sectionFor!({ game: 'yugioh', id: '1', name: 'Talker', category: 'Link' })).toBe('extra');
    expect(yugiohAdapter.sectionFor!({ game: 'yugioh', id: '2', name: 'Ash', category: 'Monster' })).toBeUndefined();
    expect(onePieceAdapter.sectionFor!({ game: 'onepiece', id: 'OP01-001', name: 'Zoro', category: 'Leader' })).toBe('leader');
  });
});

describe('second review fixes', async () => {
  const { parsePrice } = await import('../domain/wantlist');
  const { normalizeList } = await import('./onepiece');
  const { createPokemonAdapter } = await import('./pokemon');
  it('reads thousands separators in prices', () => {
    expect(parsePrice('$1,000')).toBe(1000);
    expect(parsePrice('1.250,00 €')).toBe(1250);
    expect(parsePrice('$1,250.50')).toBe(1250.5);
    expect(parsePrice('3,50 €')).toBe(3.5);
  });
  it('keeps the X in One Piece names', () => {
    expect(normalizeList('4xOP01-016\n4 X Drake\n2 Xebec')).toBe('4 OP01-016\n4 X Drake\n2 Xebec');
  });
  it('Pokémon: a failed request is not cached, and a failed set lookup falls back to the name', async () => {
    const T = 'https://api.tcgdex.net/v2/en';
    let down = true;
    const iono = { id: 'sv02-185', localId: '185', name: 'Iono', category: 'Trainer', image: 'i', set: { id: 'sv02', name: 'PE' } };
    const { fn } = fakeFetch([
      [`${T}/sets?abbreviation.official=PAL`, () => { if (down) throw new Error('Request failed (503): down'); return [{ id: 'sv02' }]; }],
      [`${T}/sets/sv02`, () => ({ id: 'sv02', abbreviation: { official: 'PAL' }, cards: [{ id: 'sv02-185', localId: '185', name: 'Iono' }] })],
      [`${T}/cards/sv02-185`, () => iono],
      [`${T}/cards?name=eq:Iono`, () => [{ id: 'sv02-185', localId: '185', name: 'Iono', image: 'i' }]],
    ]);
    const adapter = createPokemonAdapter(fn);
    const line = { lineNo: 1, raw: '4 Iono PAL 185', qty: 4, name: 'Iono', set: 'PAL', number: '185', section: 'main' };
    expect((await adapter.resolve([line]))[0].card?.name).toBe('Iono'); // set lookup failed, name lookup worked
    down = false;
    expect((await adapter.resolve([line]))[0].card).toMatchObject({ set: 'PAL', number: '185' }); // retried, not cached
  });
});

describe('one piece retries failed lookups', async () => {
  const { createOnePieceAdapter } = await import('./onepiece');
  it('looks a card up again after a failed request', async () => {
    let down = true;
    const { fn } = fakeFetch([
      ['https://optcgapi.com/api/sets/card/OP01-016/', () => { if (down) throw new Error('Request failed (503): down'); return [{ card_name: 'Nami', card_set_id: 'OP01-016', card_type: 'Character' }]; }],
      ['https://optcgapi.com/api/sets/filtered/', () => []],
    ]);
    const adapter = createOnePieceAdapter(fn);
    const line = { lineNo: 1, raw: '4 OP01-016', qty: 4, name: 'OP01-016', set: 'OP01-016', section: 'main' };
    expect((await adapter.resolve([line]))[0].card).toBeUndefined();
    down = false;
    expect((await adapter.resolve([line]))[0].card?.name).toBe('Nami');
  });
});

describe('pokemon needs a Basic', async () => {
  const { needsBasic } = await import('./pokemon');
  const card = (id: string, subtype?: string) => [id, { game: 'pokemon', id, name: id, subtype }] as const;
  const line = (id: string) => ({ cardId: id, name: id, qty: 4, section: 'main', category: 'Pokémon' });
  it('flags decks with Pokémon but no Basic, only when every stage is known', () => {
    expect(needsBasic([line('drakloak')], new Map([card('drakloak', 'Stage 1')]))).toEqual(['No Basic Pokémon: the deck cannot start a game']);
    expect(needsBasic([line('drakloak'), line('dreepy')], new Map([card('drakloak', 'Stage 1'), card('dreepy', 'Basic')]))).toEqual([]);
    expect(needsBasic([line('drakloak')], new Map([card('drakloak')]))).toEqual([]); // unknown stage: no guess
  });
});

describe('pokemon common printing, unlimited Energy and text search', async () => {
  const { createPokemonAdapter, rarityRank, isBasicEnergyId } = await import('./pokemon');
  const T = 'https://api.tcgdex.net/v2/en';
  const iono = (id: string, rarity: string, standard = true) => ({ id, localId: id.split('-')[1], name: 'Iono', category: 'Trainer', trainerType: 'Supporter', rarity, image: `img/${id}`, set: { id: 'pal', name: 'Paldea Evolved' }, legal: { standard } });
  const { fn, calls } = fakeFetch([
    [`${T}/cards?name=eq:Iono`, () => [{ id: 'pal-269', localId: '269', name: 'Iono', image: 'a' }, { id: 'pal-185', localId: '185', name: 'Iono', image: 'b' }, { id: 'pal-254', localId: '254', name: 'Iono', image: 'c' }]],
    [`${T}/cards/pal-269`, () => iono('pal-269', 'Special illustration rare')],
    [`${T}/cards/pal-185`, () => iono('pal-185', 'Uncommon')],
    [`${T}/cards/pal-254`, () => iono('pal-254', 'Ultra Rare')],
    [`${T}/cards?name=like:draw`, () => [{ id: 'pal-185', localId: '185', name: 'Iono', image: 'b' }]],
    [`${T}/cards?effect=like:draw`, () => [{ id: 'pal-185', localId: '185', name: 'Iono', image: 'b' }, { id: 'pal-269', localId: '269', name: 'Iono', image: 'a' }]],
    [`${T}/sets/pal`, () => ({ id: 'pal', abbreviation: { official: 'PAL' }, cards: [] })],
    [`${T}/sets`, () => [{ id: 'pal' }]],
  ]);
  const adapter = createPokemonAdapter(fn);

  it('ranks rarities from common to hyper rare', () => {
    expect(rarityRank('Common')).toBeLessThan(rarityRank('Uncommon'));
    expect(rarityRank('Double rare')).toBeLessThan(rarityRank('Special illustration rare'));
    expect(rarityRank('Something new')).toBeGreaterThan(rarityRank('Rare'));
  });

  it('picks the lowest-rarity printing with the same card id', async () => {
    const out = await adapter.commonPrinting!([{ game: 'pokemon', id: 'trainer:iono', name: 'Iono' }]);
    expect(out.get('trainer:iono')).toMatchObject({ set: 'PAL', number: '185' });
  });

  it('treats only basic Energy as unlimited', () => {
    expect(isBasicEnergyId('energy:fire energy')).toBe(true);
    expect(adapter.unlimited!.test('energy:jet energy')).toBe(false);
    expect(adapter.unlimited!.test('trainer:iono')).toBe(false);
  });

  it('searches names and rules text, without duplicates', async () => {
    const found = await adapter.search('draw');
    expect(calls.some((u) => u.startsWith(`${T}/cards?effect=like:draw`))).toBe(true);
    expect(found.map((c) => c.number)).toEqual(['185', '269']);
  });
});
