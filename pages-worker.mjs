import {loadPyodide} from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';
let pyodide,persistent=false;
const sendStatus=message=>self.postMessage({type:'status',message});
const ready=(async()=>{
  sendStatus('正在載入瀏覽器規劃工具；首次下載可能需要稍候…');
  pyodide=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/',stdout:()=>{},stderr:()=>{}});
  await pyodide.loadPackage('jsonschema');
  const response=await fetch(new URL('./runtime.zip',import.meta.url));if(!response.ok)throw Error('展示資料下載失敗');
  pyodide.unpackArchive(new Uint8Array(await response.arrayBuffer()),'zip',{extractDir:'/app'});
  pyodide.FS.mkdirTree('/user_data');
  try{
    pyodide.FS.mount(pyodide.FS.filesystems.IDBFS,{},'/user_data');
    await new Promise((resolve,reject)=>pyodide.FS.syncfs(true,e=>e?reject(e):resolve()));persistent=true;
  }catch{sendStatus('瀏覽器未開放保存空間，本次安排只會暫存在記憶體。');}
  await pyodide.runPythonAsync("import sys\nsys.path.insert(0,'/app')\nfrom pages_runtime import pages_request");
  sendStatus(persistent?'公開展示 · 合成學籍 · 安排保存在此瀏覽器 · AI 為示範、PDF 未啟用':'公開展示 · 合成學籍 · 僅暫存記憶體 · AI 為示範、PDF 未啟用');
})();
let queue=Promise.resolve();
self.onmessage=event=>{
  queue=queue.then(async()=>{
    const {id,request}=event.data;
    try{
      await ready;
      pyodide.globals.set('pages_raw_request',JSON.stringify(request));
      const result=JSON.parse(pyodide.runPython('pages_request(pages_raw_request)'));
      if(persistent)try{await new Promise((resolve,reject)=>pyodide.FS.syncfs(false,e=>e?reject(e):resolve()));}catch{persistent=false;sendStatus('瀏覽器保存失敗，本次安排只會暫存在記憶體；重新整理可能遺失。');}
      self.postMessage({id,result});
    }catch{self.postMessage({id,error:'規劃工具載入或執行失敗，請檢查網路後重新整理。'});}
  });
};
