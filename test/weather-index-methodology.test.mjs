import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { indexConfiguration, parseIndexMethodology } from '../src/weather-index.mjs';

const text = readFileSync(new URL('../data/records/2026-10-07-joint-weather-index/fixtures/NYCWINDEX.txt', import.meta.url), 'utf8');
const pdf = readFileSync(new URL('../data/records/2026-10-07-joint-weather-index/fixtures/NYCWINDEX.pdf', import.meta.url));

test('cached methodology text still requires the current claims, PDF and availability clock', () => {
  const city = 'nyc', at = Date.parse('2026-10-07T12:00:00Z');
  const terms = parseIndexMethodology(text, city);
  const methodology = {
    ...terms, url: 'https://assets.kalshi.com/contract_terms/NYCWINDEX.pdf',
    availableAt: '2026-10-07T11:00:00Z', decodedAt: '2026-10-07T11:00:01Z',
    bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'),
    rawPdfBase64: pdf.toString('base64'), rawText: text,
  };
  const stations = terms.stations.map(station => ({ station_id: station.stationId, weight: station.weight, offset_c: 0 }));
  const config = { config_version: 'fixture', city_reference_c: 0, stations, published_at_ms: at - 2, effective_at_ms: at - 1 };
  const packet = { calibrationSource: 'https://api.elections.kalshi.com/trade-api/v2/live_data/weather/nyc/calibrations',
    calibrations: { city, units: 'celsius', calibrations: [config] }, methodology };
  assert.equal(indexConfiguration(packet, city, at, at), config);
  assert.equal(indexConfiguration(packet, city, at, at), config);
  assert.equal(indexConfiguration(packet, city, at, Date.parse(methodology.availableAt)), null);

  for (const alteration of [
    { quorum: { ...methodology.quorum, members: methodology.quorum.members + 1 } },
    { rawText: 'invalid replacement text' },
    { rawPdfBase64: Buffer.from('%PDF-replacement').toString('base64') },
    { sha256: 'a'.repeat(64) },
    { bytes: pdf.length + 1 },
  ]) {
    const original = { ...methodology };
    Object.assign(methodology, alteration);
    assert.equal(indexConfiguration(packet, city, at, at), null);
    Object.assign(methodology, original);
    assert.equal(indexConfiguration(packet, city, at, at), config);
  }
});
