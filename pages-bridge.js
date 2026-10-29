'use strict';
(() => {
  const BASE='/scu-course-compass/',nativeFetch=window.fetch.bind(window),pending=new Map();let worker,id=0,lastStatus='';
  const status=message=>{lastStatus=message;const node=document.getElementById('pages-notice');if(node)node.textContent=message;};
  document.addEventListener('DOMContentLoaded',()=>{if(lastStatus)status(lastStatus);});
  function runtime(){
    if(worker)return worker;
    worker=new Worker(BASE+'pages-worker.mjs',{type:'module'});
    worker.onmessage=event=>{
      if(event.data.type==='status'){status(event.data.message);return;}
      const entry=pending.get(event.data.id);if(!entry)return;pending.delete(event.data.id);
      if(event.data.error){entry.reject(Error(event.data.error));return;}entry.resolve(event.data.result);
    };
    worker.onerror=()=>{status('展示工具載入失敗，請檢查網路後重新整理。');for(const entry of pending.values())entry.reject(Error('展示工具載入失敗'));pending.clear();};
    return worker;
  }
  window.fetch=async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input,location.href);
    let path=url.pathname;if(path.startsWith(BASE+'api/'))path='/'+path.slice(BASE.length);
    if(url.origin!==location.origin || !path.startsWith('/api/'))return nativeFetch(input,options);
    const source=input instanceof Request?input:null;
    const headers=Object.fromEntries(new Headers(options.headers || source?.headers || {}).entries());
    const signal=options.signal || source?.signal;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const request={method:(options.method || source?.method || 'GET').toUpperCase(),target:path+url.search,headers,body:options.body || (source?await source.clone().text():null)};
    const current=++id,active=runtime();
    const result=await new Promise((resolve,reject)=>{
      const abort=()=>{pending.delete(current);reject(new DOMException('Aborted','AbortError'));};
      pending.set(current,{resolve:v=>{signal?.removeEventListener('abort',abort);resolve(v);},reject:e=>{signal?.removeEventListener('abort',abort);reject(e);}});
      signal?.addEventListener('abort',abort,{once:true});active.postMessage({id:current,request});
    });
    const responseHeaders=new Headers(result.headers || {'Content-Type':'application/json; charset=utf-8'});
    responseHeaders.set('Cache-Control','no-store');
    const body=result.binary?Uint8Array.from(atob(result.binary),c=>c.charCodeAt(0)):JSON.stringify(result.json);
    return new Response(body,{status:result.status,headers:responseHeaders});
  };
})();
