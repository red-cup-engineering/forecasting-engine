import test from 'node:test';
import assert from 'node:assert/strict';
import {binarySettlement,eventDate} from '../src/market-outcome.mjs';
// Public Kalshi KXHIGHTDC-26OCT05-T76 response, observed 2026-10-07.
const market={ticker:'KXHIGHTDC-26OCT05-T76',status:'finalized',market_type:'binary',result:'no',settlement_ts:'2026-10-06T11:12:07.121103Z',settlement_value_dollars:'0.0000',notional_value_dollars:'1.0000',is_provisional:null};
test('definitive binary labels preserve the actual settlement clock',()=>{
 assert.equal(binarySettlement(market).outcome,0);
 assert.equal(binarySettlement(market).settledAt,'2026-10-06T11:12:07.121Z');
 assert.equal(binarySettlement({...market,result:'yes',settlement_value_dollars:'1.0000'}).outcome,1);
});
test('uncertain results and nonbinary payouts cannot become final calibration labels',()=>{
 for(const status of ['determined','disputed','active','closed'])assert.equal(binarySettlement({...market,status}),null);
 for(const patch of [{is_provisional:true},{market_type:'scalar'},{settlement_ts:null},{settlement_ts:'invalid'},{settlement_value_dollars:'0.5000'},{result:'void'}])assert.equal(binarySettlement({...market,...patch}),null);
});


test('shared venue event-day decoder supports gas and weather without interpreting a settlement clock',()=>{
 assert.equal(eventDate('KXAAAGASD-26OCT13'),'2026-10-13');
 assert.equal(eventDate('KXHIGHNY-26OCT13'),'2026-10-13');
 assert.equal(eventDate('KXEVENT-24FEB29'),'2024-02-29');
 assert.equal(eventDate('KXEVENT-26FEB29'),null);
 assert.equal(eventDate('KXEVENT-26FEB30'),null);
 assert.equal(eventDate('KXEVENT-26NOV31'),null);
 assert.equal(eventDate('KXEVENT-26FEB00'),null);
 assert.equal(eventDate('KXEVENT-26XYZ01'),null);
 assert.equal(eventDate('KXEVENT-OCT13'),null);
 assert.equal(eventDate('KXEVENT-26OCT13-EXTRA'),null);
});
