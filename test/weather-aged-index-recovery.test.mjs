import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {archiveAged} from '../src/weather-archive.mjs';
import {
  AGED_INDEX_REF, DERIVED_KIND, ageDerived, ageDerivedRecord, evidenceStore, readAgedIndex,
} from '../src/weather-evidence-record.mjs';
import {jsonDigest,readTree,saveTree} from '../src/weather-state-tree.mjs';

test('an interrupted aging move is recovered and its verified alias remains eligible for archiving',async t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-aging-recovery-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const at='2026-10-23T16:00:00.000Z',now=Date.parse('2026-11-17T15:30:00.000Z');
  const store=evidenceStore(root),scienceAddress=await store.put({observations:[]});
  const record={kind:DERIVED_KIND,version:3,at,scienceState:{'/':scienceAddress}};
  const id=jsonDigest(record),aged=ageDerivedRecord(record,id);
  await store.setRef('evidence/'+id,await store.put(record));
  await saveTree(store,'weather/derived-index',{[id]:at});
  await saveTree(store,AGED_INDEX_REF,{});

  // Simulate interruption after replacing the strong ref but before saving either inventory.
  const alias=await store.put(aged);
  await store.setRef('alias/'+id,alias);
  await store.deleteRef('evidence/'+id);

  assert.deepEqual(await ageDerived({root,now,workingWindowDays:7}),{aged:1});
  assert.equal(await store.getRef('alias/'+id),alias);
  assert.deepEqual(await readAgedIndex(root),{[id]:at});
  assert.deepEqual((await readTree(store,'weather/derived-index')).value,{});
  assert.deepEqual(await ageDerived({root,now,workingWindowDays:7}),{aged:0});

  const report=await archiveAged({root,now,archiveWindowDays:14});
  assert.equal(report.archived,1);
  assert.deepEqual(report.failed,[]);
});
