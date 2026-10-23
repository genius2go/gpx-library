/* Shared by the browser and Node tests. No credentials or browser state here. */
(function (root) {
  'use strict';
  const canonical = value => value === undefined ? 'undefined' : JSON.stringify(value, (_key, v) =>
    v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
  const equal = (a,b) => canonical(a) === canonical(b);
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function fingerprints(list) {
    return Object.fromEntries(await Promise.all(list.map(async t => [t.id,Object.fromEntries(await Promise.all(Object.keys(t).map(async k=>[k,await digest(t[k])])))])));
  }
  function validate(doc, validateTracks) {
    if(!doc || doc.version!==2) throw Error('The shared library must be a version 2 backup.');
    validateTracks(doc.tracks);
    for(const k of ['deletedBuiltin','deletedTrackIds']) if(doc[k]!==undefined && (!Array.isArray(doc[k]) || !doc[k].every(x=>typeof x==='string'))) throw Error('Invalid shared deletion records.');
    return doc;
  }
  async function merge(base, local, remote) {
    const l=new Map(local.tracks.map(t=>[t.id,t])),r=new Map(remote.tracks.map(t=>[t.id,t]));
    const lh=await fingerprints(local.tracks),rh=await fingerprints(remote.tracks);
    const deleted=new Set([...(local.deletedTrackIds||[]),...(remote.deletedTrackIds||[]),...(local.deletedBuiltin||[]),...(remote.deletedBuiltin||[])]);
    const ids=new Set([...r.keys(),...l.keys(),...Object.keys(base||{})]);
    const result=new Map(),conflicts=[];
    const absentHash=await digest(undefined);
    const unchanged=(h,b)=>b && equal(h,b);
    async function preserve(t,id,reason) {
      const copyId='conflict_'+await digest({id,track:t});
      const copy={...t,id:copyId,name:t.name+' [conflict copy]',builtin:false,syncConflictOf:id,syncOriginalName:t.name,syncConflictReason:reason};
      result.set(copyId,copy);conflicts.push({id,copyId,reason});
    }
    for(const id of ids) {
      const a=l.get(id),b=r.get(id),old=base?.[id];
      // Once a baseline exists, a missing previously-known ID is a deletion too.
      const removed=deleted.has(id) || (old && (!a || !b));
      if(removed) {
        deleted.add(id);
        if(a && b) {
          if(!old || !unchanged(lh[id],old)) await preserve(a,id,'A deletion competes with a saved version.');
          if(!equal(a,b) && (!old || !unchanged(rh[id],old))) await preserve(b,id,'A deletion competes with a saved version.');
        } else {
          const live=a||b, hashes=a?lh[id]:rh[id];
          if(live && (!old || !unchanged(hashes,old))) await preserve(live,id,'A deletion competes with an edit.');
        }
        continue;
      }
      if(!a || !b) { if(a||b) result.set(id,a||b);continue; }
      if(equal(a,b)) {result.set(id,b);continue;}
      const combined={};let collision=false;
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {
        const av=a[key],bv=b[key];let selected;
        if(equal(av,bv))selected=bv;
        else if(old && (lh[id][key]||absentHash)===(old[key]||absentHash))selected=bv;
        else if(old && (rh[id][key]||absentHash)===(old[key]||absentHash))selected=av;
        else if((av===undefined || av===null) && (bv===undefined || bv===null))selected=av===null||bv===null?null:undefined;
        else {collision=true;break;}
        if(selected!==undefined)combined[key]=selected;
      }
      if(collision) {result.set(id,b);await preserve(a,id,'Competing changes; the shared version keeps the original ID.');}
      else result.set(id,combined);
    }
    // A deterministic conflict copy may already have been present on a previous retry.
    const tracks=[...result.values()].filter(t=>!deleted.has(t.id));
    return {doc:{version:2,tracks,deletedBuiltin:[...deleted].filter(id=>id.startsWith('builtin_')).sort(),deletedTrackIds:[...deleted].sort()},conflicts};
  }
  function utf8Base64(text) {
    const bytes=new TextEncoder().encode(text);let binary='';
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(binary);
  }
  class GitHub {
    constructor({repo,branch,path,token,fetchImpl=fetch}) {
      this.repo=repo;this.branch=branch;this.token=token;this.fetch=(url,options)=>fetchImpl(url,options);
      this.url='https://api.github.com/repos/'+repo.split('/').map(encodeURIComponent).join('/')+'/contents/'+path.split('/').map(encodeURIComponent).join('/');
    }
    async request(url,options={}) {
      const response=await this.fetch(url,{...options,cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(this.token?{Authorization:'Bearer '+this.token}:{}),...options.headers}});
      if(!response.ok) {
        // Preserve GitHub's explanation without exposing the credential or request headers.
        let detail='';
        try {const body=await response.json();if(typeof body.message==='string')detail=body.message;} catch(_) {}
        if(this.token)detail=detail.split(this.token).join('[redacted]');
        detail=detail.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,'[redacted]').slice(0,300);
        const stage=url==='https://api.github.com/user'?'account authentication':url.includes('/git/blobs/')?'shared file download':options.method==='PUT'?'shared file save':'repository access';
        const summary=response.status===401?'Authentication failed':response.status===403?'Access denied or request limit reached':response.status===404?'Requested resource unavailable':response.status===409||response.status===422?'Save conflict or validation failure':'GitHub request failed';
        const error=new Error(summary+' during '+stage+' (HTTP '+response.status+')'+(detail?': '+detail:'.'));
        error.stage=stage;
        error.status=response.status;throw error;
      }
      return response;
    }
    async checkConnection() {
      if(!this.token)throw Error('No GitHub token is saved in this browser.');
      // GET requests only: do not save, merge, or upload any track data.
      const account=await (await this.request('https://api.github.com/user')).json();
      if(typeof account.login!=='string')throw Error('GitHub did not return an authenticated account.');
      const repoUrl='https://api.github.com/repos/'+this.repo.split('/').map(encodeURIComponent).join('/');
      const repository=await (await this.request(repoUrl)).json();
      if(repository.permissions?.push!==true)throw Error('Authenticated as '+account.login+', but GitHub did not confirm write access to '+this.repo+'.');
      return {login:account.login,repo:this.repo};
    }
    async read() {
      const url=this.url+'?ref='+encodeURIComponent(this.branch);
      // Pin reads to the metadata blob SHA so downloaded data and write precondition agree.
      const metadata=await (await this.request(url,{headers:{Accept:'application/vnd.github.object+json'}})).json();
      if(!metadata.sha || metadata.type!=='file')throw Error('The shared path is not a file.');
      // Raw blob media also handles libraries above the 1 MB inline-content limit.
      const blobUrl=this.url.split('/contents/')[0]+'/git/blobs/'+encodeURIComponent(metadata.sha);
      const blob=await (await this.request(blobUrl,{headers:{Accept:'application/vnd.github.raw+json'}})).json();
      return {doc:blob,sha:metadata.sha};
    }
    async write(doc,sha) {
      if(!this.token)throw Error('Connect a GitHub token to save changes.');
      const response=await this.request(this.url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Sync GPX track library',branch:this.branch,sha,content:utf8Base64(JSON.stringify(doc,null,2)+'\n')})});
      return (await response.json()).content.sha;
    }
  }
  root.GPXSync={canonical,digest,fingerprints,validate,merge,GitHub};
})(globalThis);
