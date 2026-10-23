const assert=require('node:assert/strict');
require('./github-sync.js');
const S=GPXSync;
const t=(id,name='Track')=>({id,name,coords:[[41,-70],[42,-71]],tags:[],notes:'',builtin:false});
const doc=(tracks,deletedTrackIds=[])=>({version:2,tracks,deletedBuiltin:[],deletedTrackIds});
(async()=>{
 const original=t('a');const base=await S.fingerprints([original]);
 let m=await S.merge(base,doc([{...original,notes:'Phone note'}]),doc([{...original,tags:['fuel stop']}]));
 assert.equal(m.conflicts.length,0);assert.equal(m.doc.tracks[0].notes,'Phone note');assert.deepEqual(m.doc.tracks[0].tags,['fuel stop']);
 m=await S.merge(base,doc([{...original,notes:'Phone note'}]),doc([{...original,notes:'Mac note'}]));
 assert.equal(m.conflicts.length,1);assert.equal(m.doc.tracks.length,2);assert(m.doc.tracks.some(x=>x.notes==='Phone note'));assert(m.doc.tracks.some(x=>x.notes==='Mac note'));
 const again=await S.merge(base,doc([{...original,notes:'Phone note'}]),m.doc);assert.equal(again.doc.tracks.length,2,'retry must not multiply conflict copies');
 m=await S.merge(base,doc([],['a']),doc([original]));assert.equal(m.doc.tracks.length,0);
 m=await S.merge(base,doc([],['a']),doc([{...original,notes:'Edited elsewhere'}]));assert.equal(m.doc.tracks.length,1);assert(m.doc.tracks[0].syncConflictOf==='a');assert(m.doc.deletedTrackIds.includes('a'));
 m=await S.merge(base,doc([original]),doc([],['a']));assert.equal(m.doc.tracks.length,0);
 m=await S.merge(null,doc([original]),doc([],['a']));assert.equal(m.doc.tracks.length,1,'unknown offline record must survive tombstone as conflict copy');
 m=await S.merge(null,doc([original]),doc([{...original,name:'Other'}]));assert.equal(m.doc.tracks.length,2);
 m=await S.merge(base,doc([{...original,notes:'New'}]),doc([original,t('b')]));assert.equal(m.doc.tracks.length,2);assert.equal(m.doc.tracks.find(t=>t.id==='a').notes,'New');
 // Different IDs with identical geometry stay distinct.
 m=await S.merge(null,doc([t('a')]),doc([t('b')]));assert.equal(m.doc.tracks.length,2);
 // Field deletion versus another field's edit.
 const withoutNotes={...original};delete withoutNotes.notes;
 m=await S.merge(base,doc([withoutNotes]),doc([{...original,tags:['new']}]));assert(!('notes' in m.doc.tracks[0]));assert.deepEqual(m.doc.tracks[0].tags,['new']);
 const calls=[];let content;
 const api=new S.GitHub({repo:'owner/repo',branch:'main',path:'track-library.json',token:'test-token',fetchImpl:async(url,opts)=>{
   calls.push({url,opts});if(opts.method==='PUT'){content=JSON.parse(opts.body);return new Response(JSON.stringify({content:{sha:'new'}}));}
   if(url.includes('/git/blobs/'))return new Response(JSON.stringify(doc([t('a','Édgar → 船')])));
   return new Response(JSON.stringify({sha:'old',type:'file',encoding:'none',content:''}));
 }});
 const read=await api.read();assert.equal(read.sha,'old');assert.equal(calls.length,2);assert(calls[1].url.endsWith('/git/blobs/old'));
 await api.write(read.doc,read.sha);assert.equal(content.sha,'old');assert.equal(JSON.parse(Buffer.from(content.content,'base64').toString()).tracks[0].name,'Édgar → 船');
 assert.equal(calls[0].opts.headers.Authorization,'Bearer test-token');
 for(const status of [401,403,404,409,422]){
  const bad=new S.GitHub({repo:'a/b',branch:'main',path:'x',token:'x',fetchImpl:async()=>new Response('{}',{status})});
  await assert.rejects(()=>bad.read(),e=>e.status===status);
 }
 console.log('PASS: independent edits, competing edits, retry idempotence, deletions, delete/edit conflicts, offline migration, imports, duplicates, removed fields, pinned reads, Unicode upload, authentication errors, stale-write errors.');
})().catch(e=>{console.error(e);process.exit(1)});
