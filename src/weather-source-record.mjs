import { sha256Hex, makeNiUri } from "@red-cup-engineering/semiotic-content-address-system";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from 'node:zlib';


/** One byte-exact read shared by the new bounded views, never a new store. */
export async function readWeatherSourceRecord({ root, file, label = file, emptyRecord = {}, sourceRevision } = {}) {
  const archive = /^evidence\/([a-f0-9]{64})\.json\.gz$/u.exec(file ?? '');
  if (!["latest.json", "state.json"].includes(file) && !archive) throw new TypeError("one existing weather record file is required");
  let bytes, present = true;
  try { bytes = await readFile(join(root, file)); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    present = false;
  }
  const decoded = present && archive ? gunzipSync(bytes) : bytes;
  if (present && archive && sha256Hex(decoded) !== archive[1]) throw new TypeError('weather archive source hash mismatch');
  const record = present ? JSON.parse(decoded.toString("utf8")) : emptyRecord;
  if (record === null || typeof record !== "object" || Array.isArray(record)) throw new TypeError("weather source must contain one JSON record");
  if (record.at !== undefined && record.at !== null && (typeof record.at !== "string" || record.at.length > 128)) throw new TypeError("weather source at must be a bounded string or absent");
  const source = { file: label, present, revision: present ? makeNiUri(bytes) : "absent", at: record.at ?? null };
  if (sourceRevision !== undefined && sourceRevision !== source.revision) throw new Error("weather source revision changed; restart paging from offset zero");
  return { record, source };
}
