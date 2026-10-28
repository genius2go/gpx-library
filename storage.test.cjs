const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {IDBFactory}=require('fake-indexeddb');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function setup(legacy=null){
  const entries=new Map(legacy===null?[]:[['gpx_library_v1',legacy]]);
  const context=vm.createContext({indexedDB:new IDBFactory(),STORAGE_KEY:'gpx_library_v1',localStorage:{getItem:k=>entries.get(k)??null,removeItem:k=>entries.delete(k),setItem(){throw Error('Quota exceeded');}},Error,Promise});
  vm.runInContext(html.slice(html.indexOf('let libraryDB;'),html.indexOf('async function persistSync')),context);
  return {run:code=>vm.runInContext(code,context),entries,context};
}
test('migration preserves exact bytes, verifies cache, and releases legacy storage',async()=>{
  const raw=JSON.stringify({tracks:[{notes:'existing edit'}],_sync:{pending:true}}),s=setup(raw);
  assert.equal(await s.run('migrateLibraryStorage()'),raw);
  assert.equal(s.entries.size,0);
  assert.equal(await s.run('readLibraryRaw()'),raw);
});
test('large library saves despite localStorage quota and survives a cache reopen',async()=>{
  const s=setup();s.context.large='x'.repeat(12*1024*1024);
  await s.run('writeLibraryRaw(large,null)');
  assert.equal(await s.run('readLibraryRaw()'),s.context.large);
  await s.run('libraryDB.close();libraryDB=null;');
  assert.equal(await s.run('readLibraryRaw()'),s.context.large);
});
test('stale tab cannot overwrite a newer save',async()=>{
  const s=setup();await s.run("writeLibraryRaw('first',null)");
  await assert.rejects(s.run("writeLibraryRaw('stale',null)"),/Another tab/);
  assert.equal(await s.run('readLibraryRaw()'),'first');
});
test('failed migration retains legacy data',async()=>{
  const s=setup('original');s.context.indexedDB={open(){throw Error('Database unavailable');}};
  await assert.rejects(s.run('migrateLibraryStorage()'),/unavailable/);
  assert.equal(s.entries.get('gpx_library_v1'),'original');
});
test('all library mutations and startup await durable storage',()=>{
  assert.equal((html.match(/if\(!await commitLibrary\(/g)||[]).length,5);
  assert.match(html,/await load\(\);renderList\(\);const shared=await handleShareUrl\(\)/);
  assert.doesNotMatch(html,/localStorage\.setItem\(STORAGE_KEY/);
});
