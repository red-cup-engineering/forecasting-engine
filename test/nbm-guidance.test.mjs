import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { latestHourlyGuidance, parseNbhBulletin } from '../src/nbm-hourly-guidance.mjs';
import { parseNbsBulletin } from '../src/nbm-station-guidance.mjs';

const runtime = '2026-11-17T15:00:00.000Z';

// KORD excerpts from the NOAA Open Data 20261117 15Z station text files.
const hourly = ` KORD   NBM  NBH GUIDANCE    11/17/2026  1500 UTC
 UTC  16 17 18 19 20 21 22 23 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16
 TMP  47 50 53 54 55 55 53 50 48 46 45 45 44 44 44 43 42 42 41 41 40 40 43 47 51
 TSD   1  1  1  1  1  1  1  1  1  1  2  2  2  2  2  2  2  2  2  2  2  2  2  2  1
`;
const short = ` KORD    NBM  NBS GUIDANCE    11/17/2026  1500 UTC
 FHR  06 09 12 15 18 21 24 27 30 33 36 39 42 45 48 51 54 57 60 63 66 69 72
 TXN                 40          59          48          63          44
 XND                  2           1           3           2           3
 TMP  55 48 45 44 42 40 47 56 59 54 52 50 49 48 53 61 63 57 52 49 46 44 51
`;

test('NBH accepts both NOAA header formats with the original UTC and station checks', () => {
  const current = parseNbhBulletin(hourly, ['KORD']).get('KORD');
  assert.equal(current.runtime, runtime);
  assert.equal(current.rows.length, 25);
  assert.equal(current.rows[0].ftime, '2026-11-17T16:00:00.000Z');
  assert.equal(current.rows[0].tmp, 47);
  assert.deepEqual(parseNbhBulletin(hourly.replace('NBM  ', 'NBM V5.0 '), ['KORD']).get('KORD'), current);
  assert.equal(parseNbhBulletin(hourly.replace('1500 UTC', '1515 UTC')).size, 0);
  assert.equal(parseNbhBulletin(hourly.replace('UTC  16 17', 'UTC  16 18')).size, 0);
  assert.equal(parseNbhBulletin(hourly.replace('NBH GUIDANCE', 'NBS GUIDANCE')).size, 0);
  assert.equal(parseNbhBulletin(hourly, ['KJFK']).size, 0);
});

test('NBS accepts both NOAA header formats and binds rows to their forecast hours', () => {
  const current = parseNbsBulletin(short, ['KORD']).get('KORD');
  assert.equal(current.runtime, runtime);
  assert.equal(current.rows.length, 23);
  assert.equal(current.rows[0].ftime, '2026-11-17T21:00:00.000Z');
  assert.equal(current.rows[0].tmp, 55);
  assert.equal(current.rows[5].txn, 40);
  assert.deepEqual(parseNbsBulletin(short.replace('NBM  ', 'NBM V5.0 '), ['KORD']).get('KORD'), current);
  assert.equal(parseNbsBulletin(short.replace('NBS GUIDANCE', 'NBH GUIDANCE')).size, 0);
  assert.equal(parseNbsBulletin(short, ['KJFK']).size, 0);
});

test('NBH refetches pre-fix cached misses and caches misses under the current parser', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'nbh-guidance-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const source = 'https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20261117/15/text/blend_nbhtx.t15z';
  const cache = join(cacheDir, 'nbh-2026-11-17T15.json');
  const request = { now: runtime, cacheDir, stations: ['KORD', 'KJFK'] };
  await writeFile(cache, JSON.stringify({ runtime, source, stations: {}, missingStations: request.stations }));

  let fetches = 0;
  const fetchImpl = async url => {
    fetches++;
    assert.equal(url, source);
    return new Response(hourly);
  };
  const guidance = await latestHourlyGuidance(request, { fetchImpl });
  assert.equal(guidance.stations.KORD.rows[0].tmp, 47);
  assert.deepEqual(guidance.missingStations, ['KJFK']);
  assert.deepEqual(Object.keys(guidance).sort(), ['missingStations', 'runtime', 'source', 'stations']);
  assert.deepEqual(await latestHourlyGuidance(request, { fetchImpl }), guidance);
  assert.equal(fetches, 1);

  await writeFile(cache, JSON.stringify({ ...guidance, missingStations: ['KJFK'] }));
  const positives = await latestHourlyGuidance({ ...request, stations: ['KORD'] }, { fetchImpl });
  assert.deepEqual(positives.stations, guidance.stations);
  assert.deepEqual(positives.missingStations, []);
  assert.equal(fetches, 1);
});
