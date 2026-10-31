import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const dataset = JSON.parse(await readFile(new URL('../msp-data.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../msp-engine.js', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../msp-dashboard.js', import.meta.url), 'utf8');
const browserWindow = {};
runInNewContext(source, { window: browserWindow, URL });
const engine = browserWindow.AgriMspEngine;

class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.textContent = '';
    this.classList = { add: (name) => { this.className = `${this.className} ${name}`.trim(); } };
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}

function createDashboardHarness({ fetchResult, cachedValue = null } = {}) {
  const ids = ['msp-results', 'msp-status', 'msp-feedback', 'msp-search', 'msp-season', 'msp-year'];
  const elements = Object.fromEntries(ids.map((id) => [id, new TestElement()]));
  elements['msp-season'].value = 'all';
  elements['msp-year'].value = 'latest';
  const localStore = new Map(cachedValue ? [['agriSmartVerifiedMspSnapshotV1', JSON.stringify(cachedValue)]] : []);
  const contextWindow = {};
  runInNewContext(source, { window: contextWindow, URL });
  const context = {
    window: contextWindow,
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => new TestElement(tag),
      createTextNode: (text) => ({ textContent: text })
    },
    URL,
    Intl,
    localStorage: {
      getItem: (key) => localStore.get(key) || null,
      setItem: (key, value) => localStore.set(key, value)
    },
    fetch: fetchResult
  };
  runInNewContext(dashboardSource, context);
  return { elements, localStore };
}

function textOf(node) {
  return `${node.textContent || ''}${(node.children || []).map((child) => typeof child === 'string' ? child : textOf(child)).join('')}`;
}

async function settleDashboard() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('accepts the bundled official snapshot and verifies source metadata', () => {
  assert.equal(engine.validateMspDataset(dataset), null);
  assert.equal(dataset.verifiedOn, '2026-10-29');
  assert.equal(dataset.records.length, 46);
  assert.ok(dataset.records.every((record) => record.sourceUrl.startsWith('https://www.pib.gov.in/')));
});

test('rejects malformed, duplicate, non-positive, and non-official-source records', () => {
  assert.match(engine.validateMspDataset({ ...dataset, records: [] }), /invalid format/);
  const badPrice = structuredClone(dataset);
  badPrice.records[0].mspRupeesPerQuintal = 0;
  assert.match(engine.validateMspDataset(badPrice), /incomplete or invalid record/);
  const badSource = structuredClone(dataset);
  badSource.records[0].sourceUrl = 'https://example.com/fake-msp';
  assert.match(engine.validateMspDataset(badSource), /official source host/);
  const duplicate = structuredClone(dataset);
  duplicate.records.push({ ...duplicate.records[0] });
  assert.match(engine.validateMspDataset(duplicate), /duplicate crop records/);
});

test('latest default returns one newest record per crop and season with verified comparison', () => {
  const rows = engine.filterMspRecords(dataset.records, { year: 'latest' });
  assert.equal(rows.length, 23);
  const wheat = rows.find(({ record }) => record.cropId === 'wheat');
  assert.equal(wheat.record.marketingYear, '2027-28');
  assert.equal(wheat.record.mspRupeesPerQuintal, 2610);
  assert.equal(wheat.comparison.record.marketingYear, '2026-27');
  assert.equal(wheat.comparison.change, 25);
  const maize = rows.find(({ record }) => record.cropId === 'maize');
  assert.equal(maize.record.marketingYear, '2026-27');
  assert.equal(maize.record.mspRupeesPerQuintal, 2410);
  assert.equal(maize.comparison.change, 10);
});

test('crop search matches names and aliases and respects season and year filters', () => {
  const mustard = engine.filterMspRecords(dataset.records, { query: 'sarson', season: 'Rabi', year: 'latest' });
  assert.equal(mustard.length, 1);
  assert.equal(mustard[0].record.mspRupeesPerQuintal, 6613);
  const maize = engine.filterMspRecords(dataset.records, { query: 'corn', season: 'Kharif', year: '2025-26' });
  assert.equal(maize.length, 1);
  assert.equal(maize[0].record.mspRupeesPerQuintal, 2400);
  assert.equal(maize[0].comparison, null);
  assert.deepEqual(engine.filterMspRecords(dataset.records, { query: 'wheat', season: 'Kharif', year: 'latest' }), []);
});

test('includes only official table values for the 2027-28 Rabi and 2026-27 Kharif decisions', () => {
  const latest = engine.filterMspRecords(dataset.records, { year: 'latest' });
  const rabiPrices = Object.fromEntries(latest.filter(({ record }) => record.season === 'Rabi').map(({ record }) => [record.cropId, record.mspRupeesPerQuintal]));
  const kharifPrices = Object.fromEntries(latest.filter(({ record }) => record.season === 'Kharif').map(({ record }) => [record.cropId, record.mspRupeesPerQuintal]));
  assert.deepEqual(rabiPrices, { barley: 2286, gram: 5958, lentil: 7390, 'rapeseed-mustard': 6613, safflower: 7215, wheat: 2610 });
  assert.equal(kharifPrices['paddy-common'], 2441);
  assert.equal(kharifPrices.maize, 2410);
  assert.equal(kharifPrices.moong, 8780);
  assert.equal(kharifPrices['cotton-long'], 8667);
});

test('matches every latest and previous-year value printed in the two Cabinet MSP tables', () => {
  const expected = {
    'Kharif|2026-27': {
      'paddy-common': 2441, 'paddy-grade-a': 2461, 'jowar-hybrid': 4023, 'jowar-maldandi': 4073,
      bajra: 2900, ragi: 5205, maize: 2410, 'tur-arhar': 8450, moong: 8780, urad: 8200,
      groundnut: 7517, 'sunflower-seed': 8343, 'soybean-yellow': 5708, sesamum: 10346,
      nigerseed: 10052, 'cotton-medium': 8267, 'cotton-long': 8667
    },
    'Kharif|2025-26': {
      'paddy-common': 2369, 'paddy-grade-a': 2389, 'jowar-hybrid': 3699, 'jowar-maldandi': 3749,
      bajra: 2775, ragi: 4886, maize: 2400, 'tur-arhar': 8000, moong: 8768, urad: 7800,
      groundnut: 7263, 'sunflower-seed': 7721, 'soybean-yellow': 5328, sesamum: 9846,
      nigerseed: 9537, 'cotton-medium': 7710, 'cotton-long': 8110
    },
    'Rabi|2027-28': { wheat: 2610, barley: 2286, gram: 5958, lentil: 7390, 'rapeseed-mustard': 6613, safflower: 7215 },
    'Rabi|2026-27': { wheat: 2585, barley: 2150, gram: 5875, lentil: 7000, 'rapeseed-mustard': 6200, safflower: 6540 }
  };
  for (const [key, expectedPrices] of Object.entries(expected)) {
    const [selectedSeason, selectedYear] = key.split('|');
    const actual = Object.fromEntries(dataset.records
      .filter((record) => record.season === selectedSeason && record.marketingYear === selectedYear)
      .map((record) => [record.cropId, record.mspRupeesPerQuintal]));
    assert.deepEqual(actual, expectedPrices, key);
  }
});

test('returns an empty set for an unmatched search instead of inventing values', () => {
  assert.deepEqual(engine.filterMspRecords(dataset.records, { query: 'dragonfruit', season: 'all', year: 'latest' }), []);
});

test('dashboard loads the snapshot, renders current MSP rows, and applies live crop search', async () => {
  const harness = createDashboardHarness({ fetchResult: async () => ({ ok: true, json: async () => dataset }) });
  await settleDashboard();
  assert.equal(harness.elements['msp-status'].textContent, 'OFFICIAL MSP DATA');
  assert.equal(harness.elements['msp-results'].attributes['aria-busy'], 'false');
  const table = harness.elements['msp-results'].children[0].children[0];
  const body = table.children.find((child) => child.tagName === 'tbody');
  assert.equal(body.children.length, 23);
  assert.match(textOf(harness.elements['msp-feedback']), /Kharif 2026-27/);
  harness.elements['msp-search'].value = 'sarson';
  harness.elements['msp-search'].listeners.input();
  const filteredTable = harness.elements['msp-results'].children[0].children[0];
  const filteredBody = filteredTable.children.find((child) => child.tagName === 'tbody');
  assert.equal(filteredBody.children.length, 1);
  assert.equal(filteredBody.children[0].children[0].textContent, 'Rapeseed & Mustard');
  assert.equal(harness.localStore.has('agriSmartVerifiedMspSnapshotV1'), true);
});

test('failed snapshot load labels cached values as cached and preserves their provenance', async () => {
  const harness = createDashboardHarness({ fetchResult: async () => { throw new Error('offline'); }, cachedValue: dataset });
  await settleDashboard();
  assert.equal(harness.elements['msp-status'].textContent, 'CACHED SNAPSHOT');
  assert.match(textOf(harness.elements['msp-feedback']), /Could not load the bundled MSP snapshot/);
  assert.match(textOf(harness.elements['msp-feedback']), /29 Oct 2026/);
  assert.equal(harness.elements['msp-results'].children[0].children[0].tagName, 'table');
});

test('failed snapshot load without cache shows unavailable instead of prices', async () => {
  const harness = createDashboardHarness({ fetchResult: async () => ({ ok: false, status: 404 }) });
  await settleDashboard();
  assert.equal(harness.elements['msp-status'].textContent, 'DATA UNAVAILABLE');
  assert.match(textOf(harness.elements['msp-feedback']), /no verified cached copy/);
  assert.equal(harness.elements['msp-results'].children[0].className, 'msp-empty');
});
