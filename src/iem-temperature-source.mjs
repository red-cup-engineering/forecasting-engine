import {acquireHttpResponse} from '@red-cup-engineering/http-engineering-services-section/acquire-response';
import {readResponseBody} from '@red-cup-engineering/http-engineering-services-section/body/web';

/** IEM applies a one-second per-IP throttle to this endpoint, including multi-station requests.
 * https://github.com/akrherz/iem/blob/main/pylib/iemweb/request/asos.py */
export async function readIemTemperatureCsv({stations,start,end,timeoutMs,maxBytes,fetchImpl}) {
  const url = new URL('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py');
  for (const station of stations) url.searchParams.append('station', station);
  for (const [suffix, time] of [['1', start], ['2', end]]) {
    const date = new Date(time);
    for (const [key, value] of [['year', date.getUTCFullYear()], ['month', date.getUTCMonth() + 1], ['day', date.getUTCDate()]]) {
      url.searchParams.set(key + suffix, String(value));
    }
  }
  for (const [key, value] of Object.entries({data:'tmpf',tz:'Etc/UTC',format:'onlycomma',latlon:'yes',elev:'yes',missing:'M',trace:'T',direct:'no',report_type:'3'})) {
    url.searchParams.set(key, value);
  }
  const acquired = await acquireHttpResponse(url, {fetchImpl, timeoutMs, minimumIntervalMs: 1000});
  const bytes = await readResponseBody(acquired.response, {maxBytes, signal: acquired.signal});
  return {url: String(url), text: new TextDecoder().decode(bytes), availableAt: new Date().toISOString()};
}
