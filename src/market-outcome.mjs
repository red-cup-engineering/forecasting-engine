/**
 * Outcome facts a forecast is judged against, read from a prediction market's own records: the local calendar day of
 * an event ticker, the venue's distinct timing declarations, and the definitive binary label with its settlement clock.
 * Pure.
 */

/**
 * One Kalshi event ticker's declared LOCAL CALENDAR DAY. A ticker date is
 * neither a UTC settlement instant nor permission to use future source data.
 *
 * This venue-wide decoder is shared by weather, gasoline, diesel and other
 * series. It rejects impossible Gregorian dates instead of normalizing
 * e.g. 26FEB30 to March. No extra venue-specific data type.
 */
const TICKER_MONTHS=Object.freeze({JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,
  JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12});
export function eventDate(eventTicker){
 const m=/-([0-9]{2})([A-Z]{3})([0-9]{2})$/u.exec(eventTicker??'');
 if(!m||!TICKER_MONTHS[m[2]])return null;
 const year=2000+Number(m[1]),month=TICKER_MONTHS[m[2]],day=Number(m[3]);
 const utc=new Date(Date.UTC(year,month-1,day));
 if(utc.getUTCFullYear()!==year||utc.getUTCMonth()+1!==month||utc.getUTCDate()!==day)
  return null;
 return utc.toISOString().slice(0,10);
}

/** Preserve the venue's distinct timing declarations for prospective ranking.
 * Expiration is an estimate of event expiry; the timer starts at determination.
 * These declarations do not certify a future settlement or change outcome odds.
 * https://docs.kalshi.com/api-reference/market/get-market */
export function marketSettlementTiming(market) {
  const clock = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  const timer = market?.settlement_timer_seconds;
  return {
    expectedExpirationTime: clock(market?.expected_expiration_time),
    latestExpirationTime: clock(market?.latest_expiration_time),
    settlementTimerSeconds: Number.isSafeInteger(timer) && timer >= 0 ? timer : null,
  };
}

/** Definitive binary label, with the venue's actual settlement clock. Never use expiration as settlement. */
export function binarySettlement(market) {
  if (!market || !['finalized', 'settled'].includes(market.status)
      || market.market_type !== 'binary' || market.is_provisional === true
      || !['yes', 'no'].includes(market.result)) return null;
  const time = Date.parse(market.settlement_ts);
  if (!Number.isFinite(time)) return null;
  const outcome = market.result === 'yes' ? 1 : 0;
  // An explicit nonbinary payout is not a binary calibration label.
  if (market.settlement_value_dollars != null) {
    const notional = Number(market.notional_value_dollars);
    if (!Number.isFinite(notional) || notional <= 0
        || Number(market.settlement_value_dollars) !== outcome * notional) return null;
  }
  return { ticker: market.ticker, status: market.status, result: market.result,
    outcome, settledAt: new Date(time).toISOString(), marketType: market.market_type };
}
