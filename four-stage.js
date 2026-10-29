'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames = {pass:'符合',fail:'需調整',needs_review:'待確認',stale:'需要更新',not_evaluated:'尚未檢查',current:'已檢查',draft:'規劃中',confirmed:'已確認課表'};
const badge = (status,label) => `<span class="badge ${esc(status)}">${esc(label || statusNames[status] || '待確認')}</span>`;
const cleanName = value => String(value ?? '').replace(/[（(]合成[）)]/g,'');
const instructorName = value => !value || value.startsWith('合成') ? '授課教師待確認' : value;
const recordStates = {completed:'已修畢',enrolled:'修習中',transfer:'已抵免',waiver:'已免修',failed:'未通過',withdrawn:'已退選'};
const approvalNames = {approved:'已核准',pending:'待學校確認',not_required:'一般修課',rejected:'未核准'};
const requirementNames = {TOTAL18:'畢業總學分', 'COMMON-ENG':'校訂英文必修',MAJOR9:'主修必修',MINOR6:'輔系學分',ART2:'藝文活動門檻'};
const termName = value => String(value || '').replace(/^(?:MOCK-)?(\d+)-(\d+)$/, '$1 學年度第 $2 學期');
const dateName = value => new Date(value).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const time = n => `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;
const dayNames = ['','一','二','三','四','五','六','日'];
const campus = id => ({CITY:'城中',SHUANGXI:'雙溪'}[id] || '校區待查');
const clone = value => JSON.parse(JSON.stringify(value));
const showNumber = value => value === null || value === undefined ? '待核對' : value;
const split = text => String(text).split(/[，,、\n]/).map(s=>s.trim()).filter(Boolean);
let student = sessionStorage.getItem('be02-student') || 'S01';
if (!['S01','S02','S03'].includes(student)) student='S01';
let step = Math.min(4,Math.max(1,Number(sessionStorage.getItem('be02-step')) || 1));
let ws = null, prefs = null, prefDirty = false, busy = false, brush = 'slot', dragging = false;
let slot = {weekday:1,start_minute:540,end_minute:720};
let slotResult = null, importPreview = null, lastPaintKey = null, slotCampus = '', slotScope = 'all_eligible';
let clearUndo=null;
let publicRefreshPreview=null;

function renderWorkspaceAccount(profile) {
  const name=profile?.name || '我的帳號';
  const level=profile?.department ? `${profile.department} · ${profile.year || '—'} 年級` : '返回首頁';
  return `<a class="account-control" href="/scu-course-compass/" title="返回首頁切換帳號" aria-label="${esc(name)}，返回首頁切換帳號"><span class="account-copy"><span class="account-name-line"><strong>${esc(name)}</strong></span><small>${esc(level)}</small></span><span class="avatar" aria-hidden="true">${esc((profile?.name || '我').slice(-1))}</span></a>`;
}
async function loadWorkspaceAccount() {
  const target=$('workspace-account');if(!target)return;
  target.innerHTML=renderWorkspaceAccount(null);
  // This is the existing home-page account, separate from personal records and BE-02 scenarios.
  // Read only: do not log in, change a plan owner, or copy personal data into workflow/AI inputs.
  try {
    const homeToken=sessionStorage.getItem('career-demo-token');
    if(homeToken){
      const response=await fetch('/api/state',{headers:{Authorization:`Bearer ${homeToken}`}});
      if(response.ok){const value=await response.json(),profile=(value.state || value).profile;if(profile?.name){target.innerHTML=renderWorkspaceAccount(profile);return;}}
    }
    const response=await fetch('/api/bootstrap');if(!response.ok)return;
    const value=await response.json(),profiles=value.profiles || [],preferred=sessionStorage.getItem('career-demo-profile');
    const profile=profiles.find(p=>p.id===preferred) || profiles.find(p=>p.id==='phi-demo') || profiles[0];
    if(profile)target.innerHTML=renderWorkspaceAccount(profile);
  } catch { /* A missing home account must not prevent course planning. */ }
}

let messageTimer;
function message(text, error=false) {
  clearTimeout(messageTimer);
  $('message').innerHTML = text ? `<div class="notice ${error?'error':'success'}"><span>${esc(text)}</span><button type="button" data-action="dismiss-message" aria-label="關閉提示">×</button></div>` : '';
  if(text && !busy && !error) messageTimer=setTimeout(()=>message(''),6000);
}
function friendlyError(error) {
  if(error.code?.startsWith('PUBLIC_TRIAL_'))return readable(error.message);
  if(error.code?.startsWith('AI_') || error.code==='MODEL_OUTPUT_NOT_ALLOWED') return 'AI 目前無法完成建議，請稍後再試。你也可以先到「安排課表」挑選課程。';
  if(error.status===409) return '資料有更新，已為你重新載入。請確認內容後再試一次。';
  if(error.status===401 || error.status===403) return '無法讀取這份課表，請重新選擇體驗情境。';
  if(error instanceof TypeError) return '暫時連不上服務，請稍後再試。';
  if(error.status>=500) return '服務暫時無法完成操作，請稍後再試。';
  return readable(error.message || '操作未完成，請確認資料後再試一次。');
}
async function api(path, method='GET', body, revision) {
  const headers = {Authorization:`Bearer MOCK-TOKEN-${student}`,Accept:'application/json'};
  if (body !== undefined) headers['Content-Type']='application/json';
  if (revision !== undefined) headers['If-Match']=`"${revision}"`;
  if (method !== 'GET') headers['Idempotency-Key']=crypto.randomUUID();
  const response = await fetch('/api/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) { const e=new Error(value.error?.message || `服務錯誤 ${response.status}`); e.status=response.status; e.code=value.error?.code; throw e; }
  return value.data;
}
async function load(planId) {
  publicRefreshPreview=null;
  const selected = planId || (explorerMode?new URLSearchParams(location.search).get('plan_id'):null) || sessionStorage.getItem('be02-plan-'+student);
  try { ws = await api('/me/workspace'+(selected?'?plan_id='+encodeURIComponent(selected):'')); }
  catch(e) { if (e.status!==404 || !selected) throw e; sessionStorage.removeItem('be02-plan-'+student); ws=await api('/me/workspace'); }
  sessionStorage.setItem('be02-plan-'+student,ws.plan.plan_id);
  prefs=clone(ws.plan.preferences); prefDirty=false; slotResult=null;clearUndo=null;
  if(explorerMode) {explorerData=null;render();await prepareExplorer();}
  render();
}
async function run(action) {
  if(busy) return;
  busy=true; $('main').classList.add('loading');
  try { await action(); }
  catch(e) { if(e.status===409) { try { await load(); } catch {} } message(friendlyError(e),true); }
  finally { busy=false; $('main').classList.remove('loading'); if($('message').querySelector('.success')) messageTimer=setTimeout(()=>message(''),6000); }
}
const courseById = id => ws.catalog.courses.find(c=>c.course_id===id);
const offeringById = id => ws.catalog.offerings.find(o=>o.offering_id===id);
const courseName = id => cleanName(courseById(id)?.name || '課程名稱待確認');
function readable(value) {
  let text=String(value ?? '');
  const phrases={
    '已知無額外先修限制。':'目前資料中沒有其他先修要求。',
    '已核對全部已知時段、週次及跨校區緩衝。':'已檢查上課時間與跨校區交通，目前沒有發現衝突。',
    '僅提供已知合成課規的預估採計；不構成校方核定。':'學分為規劃預估，正式認列請向學校確認。',
    '需要正式核定的學程身分；探索意願不等於核准。':'這門課需要學校核准的修讀資格。',
    '尚缺總學分':'還需要補足學分',
    '缺少：':'還需要修：',
    '已滿足':'已完成'
  };
  for(const [source,label] of Object.entries(phrases))text=text.split(source).join(label);
  for(const o of ws?.catalog.offerings || []) text=text.split(o.offering_id).join(`${courseName(o.course_id)} ${o.section_name} 班`);
  const names={...requirementNames,...Object.fromEntries((ws?.catalog.courses || []).map(c=>[c.course_id,cleanName(c.name)])),...Object.fromEntries((ws?.context.available_programs || []).map(p=>[p.program_id,cleanName(p.name)]))};
  for(const id of Object.keys(names).sort((a,b)=>b.length-a.length)) text=text.split(id).join(names[id]);
  return cleanName(text).replaceAll('待核對佇列','待確認課程').replaceAll('合成課規','示範學分規定').replaceAll('人造規則','示範學分規定').replaceAll('學程群組學分不足','還需要補足這個學程的學分');
}
function latest(kind, current=false) { return ws.artifacts.filter(a=>a.kind===kind && (!current || a.is_current)).at(-1)?.value || null; }
function currentIntent() { return ws.artifacts.filter(a=>a.kind==='intent' && a.value.generation_mode!=='mock').at(-1)?.value || null; }
function directions() {
  const intent = currentIntent();
  const intentRevision=ws.artifacts.find(a=>a.kind==='intent' && a.value.intent_id===intent?.intent_id)?.revision;
  const candidates=ws.artifacts.filter(a=>a.kind==='direction' && intent && a.intent_id===intent.intent_id && (!a.ai_metadata?.intent_revision || a.ai_metadata.intent_revision===intentRevision));
  const group=candidates.at(-1)?.generation_id;
  return (group?candidates.filter(a=>a.generation_id===group):candidates.slice(-2)).map(a=>a.value);
}
function aiInfo(artifact) {
  const m=artifact?.ai_metadata;
  return `<p class="muted ai-caption">${m?.mode==='live'?'✦ AI 根據你的想法與修課紀錄整理，內容可再調整。':'這是示範建議，尚未由 AI 分析。'}</p>`;
}
function meetings(offering) {
  if(offering.meetings===null) return '排課時間待核對';
  return offering.meetings.map(m=>`週${dayNames[m.weekday]} ${time(m.start_minute)}–${time(m.end_minute)} · ${m.modality==='onsite'?campus(m.campus_id):'線上'}`).join('<br>') || '無固定上課時段';
}
function checkList(value) {
  return `<ul class="requirement-list">${(value?.checks || []).map(c=>`<li>${badge(c.status,c.dimension==='requirement'?({pass:'已完成',fail:'尚未完成',needs_review:'待確認'}[c.status]):null)} <span>${esc(readable(c.message))}</span></li>`).join('')}</ul>`;
}
function metrics(audit) {
  return `<div class="metrics"><div class="metric accent">已取得學分<strong>${showNumber(audit.earned_credits)}</strong></div><div class="metric">這次預計修<strong>${showNumber(audit.planned_credits)}</strong></div><div class="metric">畢業還差<strong>${showNumber(audit.remaining_earned_credits)}</strong></div></div><p class="muted">另有 ${showNumber(audit.in_progress_credits)} 學分修習中。修習中與規劃課程全數通過後，預估共 ${showNumber(audit.projected_total_credits)} 學分。</p>${ws.public_course_selections?.summary.trial_count?`<p class="muted">另有 ${ws.public_course_selections.summary.trial_count} 門公開課程試排、${showNumber(ws.public_course_selections.summary.trial_listed_credits)} 列示學分，尚未計入這份學分預估。</p>`:''}`;
}
function historyPanel() {
  const reasons={mock_imported:'最初的課表',student_updated:'調整課表',plan_created:'建立課表'};
  return `<p class="muted">每次儲存都會保留當時的課表，方便你回頭比較。</p><div class="version-list">${ws.plan_history.slice().reverse().map(r=>`<div class="version-row"><div><strong>${esc(reasons[r.reason] || '儲存課表')}${r.revision===ws.plan.revision?' · 目前使用':''}</strong><br><time>${esc(dateName(r.created_at))}</time></div><button class="button ghost mini" data-action="history" data-rev="${r.revision}">查看課表</button></div>`).join('')}</div>`;
}
function selectedPanel() {
  const trialEntries=publicTrials();
  return `<section class="panel"><h2>我的課表 <small>(${ws.plan.selections.length+trialEntries.length})</small></h2>${ws.plan.selections.map(s=>{const o=offeringById(s.offering_id);return `<div class="selected-row"><div><button class="text-button" data-action="course-detail" data-id="${esc(o.offering_id)}">${esc(courseName(o.course_id))}</button><small>${meetings(o)}${s.placement!=='scheduled'?' · 待確認':''}${s.locked?' · 已固定':''}</small></div><div class="actions"><button class="button ghost mini" data-action="lock" data-id="${esc(o.offering_id)}" aria-label="${s.locked?'取消固定':'固定'}${esc(courseName(o.course_id))}" title="固定後可避免誤刪，仍會檢查選課條件">${s.locked?'取消固定':'固定'}</button><button class="button danger mini" data-action="remove" data-id="${esc(o.offering_id)}" aria-label="移除${esc(courseName(o.course_id))}" ${s.locked?'disabled':''}>移除</button></div></div>`;}).join('') || (trialEntries.length?'':'<p class="empty">還沒加入課程，先從空堂找一門吧。</p>')}${publicTrialRows(trialEntries)}<p class="muted">這次需要安排：${ws.plan.required_course_ids.map(id=>esc(courseName(id))).join('、') || '尚未指定'}。</p></section>`;
}
function publicTrials(entries=ws?.public_course_selections?.items || []) {
  return entries.filter(e=>e.placement==='trial_scheduled');
}
function publicTrialRows(entries=publicTrials()) {
  return entries.map(entry=>{const item=entry.detail.item;return `<div class="selected-row public-trial-row"><div><button class="text-button" data-action="public-saved-detail" data-id="${esc(item.offering_id)}">${esc(item.title)}</button><small>公開課程試排 · 資格與學分待確認<br>${publicMeeting(item)}</small></div><button class="button ghost mini" data-action="public-unplace" data-id="${esc(item.offering_id)}">取消試排</button></div>`;}).join('');
}
function publicMeeting(item) {
  return (item.meetings || []).map(m=>{
    const clocks=(m.sessions || []).filter(s=>s.resolution_state==='resolved' && s.start_minute!=null && s.end_minute!=null).map(s=>time(s.start_minute)+'–'+time(s.end_minute)).join('、');
    const place=m.campus_id?campus(m.campus_id):m.room_kind==='virtual'?'虛擬教室，實際地點待確認':'校區待確認';
    return `週${dayNames[m.weekday] || '？'} ${m.session_codes?.length?'第 '+esc(m.session_codes.join('、'))+' 節':'節次 '+esc(m.session_raw || '待確認')}${clocks?' · '+esc(clocks):''} · ${esc(place)} · ${esc(m.room || '教室待確認')}`;
  }).join('<br>') || '上課時間待確認';
}
function publicFitMarkup(id) {
  const fit=ws.public_trial_fit?.[id] || ws.public_course_fit?.[id];
  if(!fit)return '';
  return `<details class="subtle-details"><summary>時間比對：${{pass:'已知安排符合',fail:'需調整',needs_review:'待確認'}[fit.fit.status]}</summary><p class="muted">依加入時保存的資料，與目前時間標記、示範課表及已試排的公開課程比對；不代表修課資格通過。</p><ul class="plain-list">${fit.schedule.checks.map(c=>`<li>${badge(c.status)} ${esc(c.message)}</li>`).join('')}</ul>${fit.soft_mismatches.length?`<p class="muted">${fit.soft_mismatches.map(m=>esc(m.message)).join(' ')}</p>`:''}</details>`;
}
function publicTrialAction(entry) {
  const item=entry.detail.item;
  if(entry.placement==='trial_scheduled')return `<button class="button ghost mini" data-action="public-unplace" data-id="${esc(item.offering_id)}">取消試排，留在想修清單</button>`;
  const complete=item.meetings?.length && item.meetings.every(m=>Number.isInteger(m.weekday) && m.sessions?.length && m.sessions.every(s=>s.resolution_state==='resolved' && Number.isInteger(s.start_minute) && Number.isInteger(s.end_minute)));
  const blocked=ws.public_trial_fit?.[item.offering_id]?.schedule.status==='fail';
  return `<button class="button mini" data-action="public-place" data-id="${esc(item.offering_id)}" ${!complete||blocked?'disabled':''}>${!complete?'鐘點待確認，暫不能試排':blocked?'時間衝突，請先調整':'試排到課表（待確認）'}</button>`;
}
function publicPendingPanel(entries=ws.public_course_selections?.items || [], historical=false) {
  if(!entries.length) return '';
  return `<section class="panel public-pending"><h2>想修的公開課程 <small>(${entries.length})</small></h2><p class="muted">其中 ${publicTrials(entries).length} 門已試排；列示學分尚未認列。</p><p class="muted">試排只是在時間格預留上課安排，資格、週次及學分仍待核對。公開課程不會增加已得或畢業學分。</p>${entries.map(entry=>{const item=entry.detail.item;return `<article class="public-pending-row"><div>${badge('needs_review',entry.placement==='trial_scheduled'?'已試排，待確認':'想修候選，待確認')}<h3>${esc(item.title)}</h3><p>${publicMeeting(item)}</p><p class="muted">${showNumber(item.credits)} 列示學分 · ${(item.teachers || []).map(t=>esc(t.name)).join('、') || '教師待確認'}<br>保存於 ${esc(dateName(entry.saved_at))}</p>${historical?'':publicFitMarkup(item.offering_id)}</div>${historical?'':`<div class="actions">${publicTrialAction(entry)}<button class="button ghost mini" data-action="public-saved-detail" data-id="${esc(item.offering_id)}">查看保存內容</button><button class="button ghost mini" data-action="public-refresh-preview" data-id="${esc(item.offering_id)}">查看最新資料</button><button class="button danger mini" data-action="public-remove" data-id="${esc(item.offering_id)}" aria-label="移除公開課程${esc(item.title)}">移除</button></div>`}</article>`;}).join('')}${historical?'':'<button class="button ghost" data-action="public-export">下載待確認清單（CSV）</button>'}</section>`;
}
function publicSavedDetail(id) {
  const entry=ws.public_course_selections.items.find(e=>e.detail.item.offering_id===id);
  if(!entry)throw new Error('找不到這門已保存的課程，請重新載入。');
  const item=entry.detail.item, syllabus=entry.detail.syllabus;
  openDetail(item.title,`<p class="notice">這是加入課表當時保存的公開資料。修課資格、排課時間與學分認列仍待確認。</p><p>${esc(item.course_code)} · ${showNumber(item.credits)} 列示學分</p><p>授課教師：${(item.teachers || []).map(t=>esc(t.name)).join('、') || '待確認'}</p><p>${publicMeeting(item)}</p>${(syllabus?.sections || []).filter(s=>!(s.kind==='other' && String(s.content || '').trim().startsWith('{'))).map(s=>`<h3>${esc(s.heading || '課程內容')}</h3><p class="saved-course-text">${esc(s.content)}</p>`).join('') || '<p>保存時尚未提供完整課綱。</p>'}${syllabus?.assessments?.length?`<h3>評分方式</h3><ul>${syllabus.assessments.map(a=>`<li>${esc(a.name)}：${a.weight_percent==null?'比例待確認':esc(a.weight_percent)+'%'} ${esc(a.description || '')}</li>`).join('')}</ul>`:''}${syllabus?.resources?.length?`<h3>教材與參考資源</h3><ul>${syllabus.resources.map(r=>`<li>${esc(r.citation || '參考資源')} ${safeExternalLink(r.url,'查閱資源')}</li>`).join('')}</ul>`:''}${syllabus?.weeks?.length?`<details class="subtle-details"><summary>每週教學進度</summary><ul>${syllabus.weeks.map(w=>`<li>第 ${esc(w.week_number)} 週 · ${esc(w.content)}</li>`).join('')}</ul></details>`:''}<details class="subtle-details"><summary>保存的來源與版本</summary><p class="saved-course-text">課程版本：${esc(item.revision_id)}<br>課綱版本：${esc(item.syllabus_revision_id || '尚未提供')}<br>內容指紋：${esc(entry.content_sha256)}</p><ul>${(entry.detail.sources || []).map(s=>`<li>${esc(s.title)} · ${esc(s.observed_at)} ${safeExternalLink(s.url,'校方來源')}</li>`).join('')}</ul></details><a class="button ghost" href="/scu-course-compass/course-explorer/?planning=1&target_plan=${encodeURIComponent(ws.plan.plan_id)}&q=${encodeURIComponent(item.course_code)}">查閱最新公開資料 →</a>`);
}
// Progressive decoration only: credit values and native details/progress semantics
// remain unchanged, including when animations are unavailable or cancelled.
const progressMotionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
const progressAnimations=new Set();
let lastProgressMotionKey=null;
function stopProgressMotion(){for(const animation of progressAnimations)animation.cancel();progressAnimations.clear();}
progressMotionPreference.addEventListener('change',event=>{if(event.matches)stopProgressMotion();});
function playProgressMotion(element,frames,options){
  if(progressMotionPreference.matches || typeof element.animate!=='function')return;
  const animation=element.animate(frames,options);
  progressAnimations.add(animation);
  animation.finished.then(()=>progressAnimations.delete(animation),()=>progressAnimations.delete(animation));
}
function enhanceProgressView(){
  stopProgressMotion();
  const root=document.querySelector('#main > .progress-workspace');
  if(!root)return;
  root.classList.add('progress-motion');
  const personal=window.PersonalProgress;
  const key=personal?.active?['personal',personal.data.records_revision,personal.data.rule_version].join(':'):[student,ws.plan.plan_id,ws.plan.revision,ws.records_history.at(-1)?.revision].join(':');
  const entering=key!==lastProgressMotionKey;
  lastProgressMotionKey=key;
  if(progressMotionPreference.matches)return;
  if(entering)Array.from(root.children).filter(el=>el.classList.contains('panel')).forEach((panel,index)=>playProgressMotion(panel,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,delay:Math.min(index*35,120),fill:'backwards',easing:'cubic-bezier(.2,.7,.3,1)'}));
  const progress=root.querySelector('progress.degree-progress');
  if(!progress || !Number.isFinite(progress.value) || !(progress.max>0))return;
  const track=document.createElement('div'),fill=document.createElement('span');
  track.className='degree-progress-track';fill.className='degree-progress-fill';
  fill.setAttribute('aria-hidden','true');
  fill.style.width=Math.max(0,Math.min(100,progress.value/progress.max*100))+'%';
  progress.before(track);track.append(progress,fill);
  progress.classList.add('visually-hidden');
  if(entering)playProgressMotion(fill,[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:540,delay:70,fill:'backwards',easing:'cubic-bezier(.2,.7,.3,1)'});
}
document.addEventListener('click',event=>{
  const summary=event.target.closest('summary');
  if(summary?.closest('.progress-motion'))summary.parentElement.dataset.motionRequested='1';
});
document.addEventListener('toggle',event=>{
  const details=event.target;
  if(!(details instanceof HTMLDetailsElement) || !details.closest('.progress-motion') || !details.dataset.motionRequested)return;
  delete details.dataset.motionRequested;
  if(details.open)Array.from(details.children).filter(el=>el.tagName!=='SUMMARY').forEach(el=>playProgressMotion(el,[{opacity:.55,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:170,easing:'ease-out'}));
},true);
function graduationDashboard() {
  const g=ws.graduation_progress;
  if(!g)return `<section class="panel"><h2>我的畢業進度</h2><p class="notice">暫時無法讀取分類進度，請重新載入。</p>${metrics(ws.context.audit)}</section>`;
  const s=g.summary;
  const progressLabel={pass:'已完成',fail:'尚待完成',needs_review:'待核對'};
  const courseStates={earned:'已取得',waived:'已免修',pending_recognition:'認列待確認',in_progress:'修習中',missing:'尚未取得',needs_review:'紀錄待核對'};
  const courseTable=rows=>`<div class="table-wrap"><table class="degree-course-table"><caption>必修科目與已取得學分</caption><thead><tr><th scope="col">年級／學期</th><th scope="col">科目</th><th scope="col">課程學分</th><th scope="col">取得學分</th><th scope="col">狀態</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.year_level==null?'待核對':`${esc(r.year_level)} 年級`}<small>${r.semester_scope==null?'學期待核對':esc(r.semester_scope)}</small></td><th scope="row">${esc(cleanName(r.name))}</th><td>${showNumber(r.listed_credits)}</td><td>${showNumber(r.earned_credits)}</td><td>${badge(r.status,courseStates[r.state])}</td></tr>`).join('')}</tbody></table></div>`;
  const requirementBody=r=>{
    const name=requirementNames[r.requirement_id] || '學分要求';
    if(r.kind==='non_credit')return `<article class="degree-requirement"><div class="degree-requirement-head"><h4>${esc(name)}</h4>${badge(r.status,progressLabel[r.status])}</div><p>已核定 ${showNumber(r.completed_units)}／${showNumber(r.required_units)} 次</p><p class="muted">依活動或能力認證的核定紀錄，與課程學分分開核對。</p></article>`;
    const waived=r.courses.some(c=>c.state==='waived');
    return `<article class="degree-requirement"><div class="degree-requirement-head"><h4>${esc(name)}</h4>${badge(r.status,progressLabel[r.status])}</div><p class="degree-credit-line">已取得 <strong>${showNumber(r.earned_credits)}</strong> 學分${r.required_credits!=null?` · 課程要求 ${showNumber(r.required_credits)} 學分`:''}${r.status==='pass'?'':` · 尚差 ${showNumber(r.remaining_credits)} 學分`}</p>${waived?'<p class="muted">已核准的免修可滿足這項科目要求，但不增加取得學分。</p>':''}${r.kind==='required_courses'?courseTable(r.courses):`<p class="muted">可採計科目：${r.courses.map(c=>esc(cleanName(c.name))).join('、') || '尚待核對'}。不需要將清單內每門課都修完。</p>`}${r.minimum_additional_credits!=null || r.maximum_shared_credits!=null?`<p class="muted">${r.minimum_additional_credits!=null?`另需修足至少 ${showNumber(r.minimum_additional_credits)} 學分` : ''}${r.minimum_additional_credits!=null && r.maximum_shared_credits!=null?'；':''}${r.maximum_shared_credits!=null?`可共用上限 ${showNumber(r.maximum_shared_credits)} 學分`:''}。核對結果已包含在上方狀態。</p>`:''}<p class="muted">${esc(readable(r.message))}</p></article>`;
  };
  const missing=g.missing_required_courses;
  const incomplete=g.sections.filter(x=>!x.missing_mapping && x.status!=='pass' && x.section_id!=='major_required');
  return `<section class="panel degree-overview" aria-labelledby="degree-heading"><div class="degree-heading"><div><p class="eyebrow">從這裡開始</p><h2 id="degree-heading">我的畢業進度</h2><p class="muted">${g.entry_year} 學年度入學 · 依適用年度查看畢業要求</p></div><span class="badge degree-demo">示範資料</span></div><div class="degree-total"><div><span>已取得學分</span><p><strong>${showNumber(s.earned_credits)}</strong><span>／${showNumber(s.minimum_total_credits)} 學分</span></p></div><div class="degree-gap">${s.remaining_credits==null?'尚需核對修課紀錄':s.remaining_credits===0?'總學分已達示範門檻':`還需取得 <strong>${showNumber(s.remaining_credits)}</strong> 學分`}</div></div>${s.completion_percent==null?'<p class="notice">修課資料還沒補齊，目前無法計算完整進度。</p>':`<progress class="degree-progress" max="100" value="${s.completion_percent}" aria-label="已取得學分占畢業總學分 ${s.completion_percent}%">${s.completion_percent}%</progress>`}<div class="degree-estimates"><div><span>修習中／待成績</span><strong>${showNumber(s.in_progress_credits)} <small>學分</small></strong></div><div><span>課表規劃</span><strong>${showNumber(s.planned_credits)} <small>學分</small></strong></div><div><span>已完成的已知門檻</span><strong>${s.requirements_completed} <small>／${s.requirements_count} 項</small></strong></div></div><p class="muted degree-footnote">修習中與規劃課程尚未計入已取得學分；公開課程試排也不會增加學分。以下依示範規定核對，並非校方畢業認證。</p></section>
  <section class="panel degree-priorities" aria-labelledby="degree-next-heading"><h3 id="degree-next-heading">下一步先留意</h3>${missing.length || incomplete.length?`<ul class="degree-next-list">${missing.map(r=>`<li><div><strong>${esc(cleanName(r.name))}</strong><span>主修或共同必修 · ${esc(courseStates[r.state])}</span></div>${badge(r.status,courseStates[r.state])}</li>`).join('')}${incomplete.map(section=>`<li><div><strong>${esc(section.title)}</strong><span>${section.requirements.map(r=>r.kind==='non_credit'?`已核定 ${showNumber(r.completed_units)}／${showNumber(r.required_units)} 次`:`尚差 ${showNumber(r.remaining_credits)} 學分`).join('；')}</span></div>${badge(section.status,progressLabel[section.status])}</li>`).join('')}</ul>`:'<p>目前已知門檻已完成；仍需核對尚未接入的校方要求。</p>'}<p class="muted">通識、體育、系選修與外系採計上限等正式年度要求尚待接入，請在下方分類確認。</p></section>
  <section class="panel degree-categories" aria-labelledby="degree-category-heading"><h3 id="degree-category-heading">逐項查看畢業要求</h3><p class="muted">先看必修，再確認各類學分與畢業門檻。各類可能共用學分，不能直接相加。</p>${g.sections.map(section=>`<details class="degree-category" ${section.section_id==='major_required'?'open':''}><summary><span>${esc(section.title)}</span>${badge(section.status,section.missing_mapping?'年度要求待接入':section.status==='pass'?'已知項目完成':progressLabel[section.status])}</summary>${section.missing_mapping?`<p class="muted">${esc(section.note)}</p>${section.section_id==='general'?'<p class="muted">通識須分開核對總學分與領域分布，不能只看學分加總。</p>':section.section_id==='physical'?'<p class="muted">體育可能以修課科次檢查；零學分課程仍可能是畢業要求。</p>':section.section_id==='other'?'<p class="muted">外系、校外或實習的列示學分與可採計學分須分開，需有核定及上限依據。</p>':''}`:section.requirements.map(requirementBody).join('')}${section.section_id==='milestones'?'<p class="muted">外文、資訊等能力認證尚未接入，不能將英文課免修視為外文能力認證通過。</p>':''}</details>`).join('')}</section>
  <section class="panel"><h3>修習中，等待成績</h3><p class="muted">這裡只列入修課紀錄中的在修課程，與自行規劃的課表分開。</p>${g.in_progress_courses.length?`<div class="table-wrap"><table><thead><tr><th>學期</th><th>科目</th><th>課程學分</th><th>成績</th><th>取得學分</th></tr></thead><tbody>${g.in_progress_courses.map(r=>`<tr><td>${esc(termName(r.term_id))}</td><td>${esc(cleanName(r.name))}</td><td>${showNumber(r.listed_credits)}</td><td>成績未到</td><td>0</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">目前沒有已登錄的在修課程。</p>'}${g.pending_records.length?`<details class="subtle-details"><summary>另有 ${g.pending_records.length} 筆紀錄需要確認認列</summary><ul>${g.pending_records.map(r=>`<li>${esc(cleanName(r.name))}：${esc(r.reason)}</li>`).join('')}</ul></details>`:''}<details class="subtle-details"><summary>學分認列與資料時間</summary><ul>${g.recognition_notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p class="muted">本機修課資料：第 ${g.records_revision} 版${g.records_updated_at?`，更新於 ${esc(dateName(g.records_updated_at))}`:''}。校方報表產生時間尚未接入。</p><p class="muted">入學年度 ${g.entry_year}；目前適用的示範規定年度 ${g.applicable_rule_entry_year}。年級、學期或全學年對照缺少時會標示待核對。</p><a href="https://web.sys.scu.edu.tw/default.asp" target="_blank" rel="noopener noreferrer">前往東吳校務系統核對 →</a></details></section>`;
}
function stage1() {
    if(window.PersonalProgress?.active)return PersonalProgress.render();
  const c=ws.context,p=c.profile;
  const terms=Array.from(new Set([p.target_graduation_term,...[116,117,118,119].flatMap(y=>[1,2].map(t=>`MOCK-${y}-${t}`))].filter(Boolean)));
    return `<div class="reading-column progress-workspace">${graduationDashboard()}<details class="panel"><summary>修讀身分與畢業規劃</summary>
    <div class="checks">${p.programs.map(program=>{const name=c.available_programs.find(a=>a.program_id===program.program_id)?.name;return `<span class="badge">${esc(cleanName(name || ({major:'主修',minor:'輔系',double_major:'雙主修'}[program.kind] || '修讀身分')))} · ${esc(approvalNames[program.state] || '待確認')}</span>`;}).join('')}</div>
      <form id="profile-form"><div class="form-row"><label class="field">預計畢業學期<select name="graduation">${terms.map(t=>`<option value="${esc(t)}" ${p.target_graduation_term===t?'selected':''}>${esc(termName(t))}</option>`).join('')}</select></label></div><p class="muted">我也想了解以下學程。這只會記下你的興趣，正式修讀資格仍依學校核准結果。</p><div class="checks">${c.available_programs.map(program=>`<label><input type="checkbox" name="program" value="${esc(program.program_id)}" ${ws.exploring_program_ids.includes(program.program_id)?'checked':''}>${esc(cleanName(program.name))}</label>`).join('')}</div><button class="button" type="submit">儲存規劃</button></form></details>
      <details class="panel" ${importPreview?'open':''}><summary>全部修課紀錄與補充資料</summary>${c.record_coverage!=='complete'?'<p class="notice">修課資料還沒補齊，部分學分與選課條件需要再確認。</p>':''}<div class="table-wrap"><table><thead><tr><th>課程</th><th>修課狀態</th><th>成績</th><th>取得學分</th><th>認列狀態</th></tr></thead><tbody>${c.records.map(r=>`<tr><td>${esc(courseName(r.course_id))}</td><td>${esc(recordStates[r.state] || '待確認')}</td><td>${r.grade==null?(r.state==='enrolled'?'成績未到':'未提供'):esc(r.grade)}</td><td>${showNumber(r.earned_credits)}</td><td>${esc(approvalNames[r.approval] || '待確認')}</td></tr>`).join('')}</tbody></table></div>
    <details class="subtle-details"><summary>抵免、免修與畢業活動紀錄</summary><ul class="plain-list">${c.recognition_decisions.map(d=>`<li>${esc(courseName(d.course_id))} · ${d.decision_kind==='waiver'?'免修':'抵免'} · ${esc(approvalNames[d.state] || '待確認')} · ${showNumber(d.approved_credits)} 學分</li>`).join('')}${c.non_credit_evidence.map(e=>`<li>${esc(requirementNames[e.requirement_id] || '畢業活動')} · 已完成 ${showNumber(e.completed_units)} 次 · ${esc(approvalNames[e.state] || '待確認')}</li>`).join('')}</ul></details>
      <details class="subtle-details" ${importPreview?'open':''}><summary>補充修課紀錄</summary><p class="muted">可以先記下尚未出現在清單上的課程；自行填寫的資料仍需學校確認。</p><form id="import-form"><div class="form-row"><label class="field">課程<select name="course">${ws.catalog.courses.map(course=>`<option value="${esc(course.course_id)}" ${course.course_id==='NET201'?'selected':''}>${esc(cleanName(course.name))}</option>`).join('')}</select></label><label class="field">修課狀態<select name="state"><option value="enrolled">修習中</option><option value="completed">已修畢</option><option value="failed">未通過</option><option value="withdrawn">已退選</option></select></label><label class="field">成績（選填）<input type="number" name="grade" min="0" max="100" step="0.01"></label></div><button class="button ghost" type="submit">預覽新增內容</button></form>${importPreview?`<div class="notice">可新增 ${importPreview.accepted_row_numbers.length} 筆，重複 ${importPreview.duplicate_row_numbers.length} 筆，需修正 ${importPreview.invalid_row_numbers.length} 筆。<div class="actions"><button class="button" data-action="commit-import" ${importPreview.accepted_row_numbers.length?'':'disabled'}>確認新增紀錄</button></div></div>`:''}</details></details>
    <div class="actions step-actions"><button class="button" data-step="2">接著探索方向 →</button></div></div>`;
}
function stage2() {
  const intent=currentIntent(),options=directions(),fields=intent?.fields || {};
  const intentArtifact=ws.artifacts.find(a=>a.kind==='intent' && a.value.intent_id===intent?.intent_id);
  const directionArtifact=ws.artifacts.find(a=>a.kind==='direction' && a.value.direction_id===options[0]?.direction_id);
  const inputField=(key,label)=>`<label class="field">${label}<input name="${key}" value="${esc((fields[key] || []).join('、'))}" placeholder="有多個想法時，可用逗號分隔"></label>`;
  return `<div class="reading-column"><section class="panel"><h2>你想往哪個方向走？</h2><p class="muted">說說想做的工作、喜歡的事，或目前的疑問。還沒想好也沒關係。</p>${!ws.ai?.configured?'<p class="notice">目前提供示範建議，你也可以直接到「安排課表」自行選課。</p>':''}<form id="intent-form"><label class="field">告訴我你的想法<textarea name="text" maxlength="2000" required placeholder="例如：我想成為軟體工程師，也對科技法律有興趣。">${esc(intent?.text || '')}</textarea></label><details class="subtle-details privacy"><summary>AI 會使用哪些資料？</summary><p class="muted">送出後，會將你填寫的想法、興趣、修課摘要與課程資訊交由 Google AI 分析，不附上姓名、學號或原始分數。AI 提供探索建議；能否修課與學分採計會另外核對。</p></details><button class="button" type="submit">${ws.ai?.configured?'幫我找方向':'看看示範建議'}</button></form></section>
    ${intent?`<section class="panel"><h2>這樣理解對嗎？ ${intent.confirmation==='confirmed'?badge('pass','已確認'):''}</h2>${aiInfo(intentArtifact)}<form id="intent-confirm-form"><div class="form-row">${inputField('goals','我想嘗試的工作或目標')}${inputField('interests','我感興趣的主題')}</div><details class="subtle-details"><summary>補充優勢與考量（選填）</summary><div class="form-row">${inputField('strengths','我擅長的事')}${inputField('declared_constraints','需要考量的事')}</div></details>${(intent.questions || []).map(q=>`<p class="muted">${esc(q)}</p>`).join('')}<div class="actions"><button class="button ghost" type="submit">${intent.confirmation==='confirmed'?'儲存修改':'確認我的想法'}</button><button class="button" type="button" data-action="directions" ${intent.confirmation==='confirmed'?'':'disabled'}>${options.length?'重新推薦方向':'看看適合的方向'}</button></div>${intent.confirmation!=='confirmed'?'<p class="muted">確認上面的內容後，就能看看適合你的方向。</p>':''}</form></section>`:''}
    ${options.length?`<section class="panel"><h2>選一個想先探索的方向</h2>${aiInfo(directionArtifact)}<p class="muted">先挑方向，下一步再選實際課程。部分課程可能需要先完成先修或申請資格。</p><div class="directions">${options.map(d=>`<article class="direction ${ws.plan.direction_id===d.direction_id?'selected':''}"><h3>${esc(d.title)}</h3><p class="path">${d.ability_path.map(esc).join(' → ')}</p><p class="muted">${esc(readable(d.rationale))}</p><details class="subtle-details"><summary>相關課程與修課條件</summary><ul>${d.course_eligibility.map(c=>`<li>${esc(courseName(c.course_id))} ${badge(c.evaluation.status,{pass:'可以修',fail:'尚未符合',needs_review:'待確認'}[c.evaluation.status])}</li>`).join('')}</ul></details><button class="button ${ws.plan.direction_id===d.direction_id?'ghost':''}" data-action="choose-direction" data-id="${esc(d.direction_id)}" aria-pressed="${ws.plan.direction_id===d.direction_id}">${ws.plan.direction_id===d.direction_id?'✓ 已選擇這個方向':'選擇這個方向'}</button></article>`).join('')}</div></section>`:''}
    <div class="actions step-actions"><button class="button ghost" data-step="1">← 修課進度</button><button class="button" data-step="3">接著安排課表 →</button></div></div>`;
}
// School's observed schedule; 9 uses the union of the two documented variants.
const calendarPeriods=[['1',490,540],['2',550,600],['3',610,660],['4',670,720],['E',730,780],['5',790,840],['6',850,900],['7',910,960],['8',970,1020],['9*',1030,1100],['A',1105,1155],['B',1160,1210],['C',1220,1270],['D',1275,1325]];
function cellEnd(start){return calendarPeriods.find(row=>row[1]===start)?.[2] ?? start+60;}
function cellData(day,start) {
  const end=cellEnd(start);
  return {time:prefs.time_blocks.find(b=>b.weekday===day && b.start_minute<end && b.end_minute>start),campus:prefs.campus_blocks.find(b=>b.weekday===day && b.start_minute<end && b.end_minute>start)};
}
function cellMarkup(day,start) {
  const b=cellData(day,start);
  const end=cellEnd(start);
  const selected=slot.weekday===day && slot.start_minute===start;
  const classes=ws.plan.selections.filter(s=>s.placement==='scheduled').flatMap(s=>(offeringById(s.offering_id).meetings || []).filter(m=>m.weekday===day && m.start_minute<end && m.end_minute>start).map(()=>courseName(offeringById(s.offering_id).course_id)));
  const trials=publicTrials().filter(e=>e.detail.item.meetings.some(m=>m.weekday===day && m.sessions?.some(s=>s.resolution_state==='resolved' && s.start_minute<end && s.end_minute>start)));
  return `<button class="cell ${b.time?.kind || ''} ${selected?'slot':''} ${trials.length?'has-public-trial':''}" data-day="${day}" data-start="${start}" title="${esc([...classes,...trials.map(e=>'試排 · '+e.detail.item.title)].join(' / ') || time(start)+'–'+time(end))}" aria-label="週${dayNames[day]} ${time(start)} ${b.time?.kind==='unavailable'?'不可排課':b.time?'希望留白':'可排課'} ${b.campus?campus(b.campus.campus_id):''} ${esc(classes.join('、'))} ${esc(trials.map(e=>'試排 '+e.detail.item.title+'，資格與學分待確認').join('、'))}">${b.time?.kind==='unavailable'?'不可排':b.time?'留白':''}${b.campus?`<span class="campus ${b.campus.campus_id==='CITY'?'city':''}">${campus(b.campus.campus_id)}</span>`:''}<span class="class-mark">${classes.map(esc).join(' / ')}${trials.map(e=>`<span class="public-trial-label ${ws.public_trial_fit?.[e.detail.item.offering_id]?.schedule.status==='fail'?'conflict':''}">試排 · ${esc(e.detail.item.title)}</span>`).join('')}</span></button>`;
}
function calendar() {
  return `<div class="calendar-wrap"><table class="calendar" aria-label="每週節次、時間與校區偏好"><colgroup><col class="calendar-time-column"><col span="7" class="calendar-day-column"></colgroup><thead><tr><th scope="col">節次／時間</th>${dayNames.slice(1).map(d=>`<th scope="col">週${d}</th>`).join('')}</tr></thead><tbody>${calendarPeriods.map(([code,start,end])=>`<tr><th class="time-label" scope="row"><strong>${code}</strong><small>${time(start)}<br>${time(end)}</small></th>${Array.from({length:7},(_,i)=>`<td>${cellMarkup(i+1,start)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function exclusionReason(item) {
  const labels={MEETINGS_UNKNOWN:'上課時間還沒確認',MEETING_OUTSIDE_WINDOW:'上課時間不在這段空堂內',STRICT_CAMPUS_MISMATCH:'不在你指定的校區',PREREQUISITE_NOT_MET:'尚未完成先修課程',PROGRAM_NOT_APPROVED:'尚未取得所需修讀資格',TIME_OVERLAP:'和已選課程衝堂',CROSS_CAMPUS_BACK_TO_BACK:'前後堂在不同校區，來不及移動',TRAVEL_GAP_TOO_SHORT:'跨校區的交通時間不夠',UNAVAILABLE_TIME:'安排在你不方便上課的時間',TERM_CREDIT_LIMIT:'超過設定的學分上限',REQUIRED_COURSE_MISSING:'還有需要安排的必修課'};
  return (item.reason_codes || []).map(code=>labels[code] || '修課條件或課表安排不符合這次查詢').join('；') || '上課時間、校區或修課條件不符合這次查詢。';
}
function courseCard(offering,candidate=null) {
  const c=courseById(offering.course_id), selected=ws.plan.selections.some(s=>s.offering_id===offering.offering_id);
  const eligibility=candidate?.eligibility || ws.eligibilities[offering.offering_id];
  const review=eligibility.status==='needs_review' || candidate?.schedule.status==='needs_review';
  return `<article class="course ${selected?'selected':''}"><div class="slot-heading">${badge(eligibility.status,{pass:'可以修',fail:'尚未符合',needs_review:'待確認'}[eligibility.status])}</div><h3>${esc(cleanName(c.name))} <small>${esc(offering.section_name)} 班</small></h3><div class="schedule">${meetings(offering)}<br>${showNumber(c.credits)} 學分 · ${esc(instructorName(offering.instructor))}</div>${candidate?.soft_mismatches.length?`<p class="muted">${candidate.soft_mismatches.map(m=>esc(readable(m.message))).join(' ')}</p>`:''}<div class="actions"><button class="button ghost mini" data-action="course-detail" data-id="${esc(offering.offering_id)}">查看課程</button><button class="button mini" data-action="add" data-id="${esc(offering.offering_id)}" data-review="${review?'1':'0'}" ${selected || eligibility.status==='fail'?'disabled':''}>${selected?'已加入':eligibility.status==='fail'?'尚未符合條件':review?'先加入，待確認':'加入課表'}</button></div></article>`;
}
function stage3() {
  const options=[['slot','選空堂找課'],['unavailable','不方便上課'],['prefer_free','希望留空'],['CITY','希望城中'],['SHUANGXI','希望雙溪']];
  return `<div class="explorer-launch panel"><div><h2>挑課程，也挑適合自己的上課方式</h2><p class="muted">先查東吳公開課程，查看課綱與老師，再存入想修清單；也可使用示範課程試排時間。</p></div><div class="actions"><button class="button" data-action="open-public-explorer">查找東吳公開課程 →</button><button class="button ghost" data-action="open-explorer" data-window="0">${prefDirty?'儲存安排並試排示範課程':'試排示範課程'} →</button></div></div><div class="columns"><div><section class="panel"><div class="panel-heading"><h2>排出適合自己的時間</h2><button class="button ghost mini pdf-export" data-action="timetable-pdf" disabled title="PDF 匯出請使用本機完整版">匯出課表 PDF <small>A4</small></button></div><p class="muted">選擇工具後，點選或拖曳課表標記。也可以先挑一段空堂，再帶著這個時間去找課。</p><div class="paint-tools" role="group" aria-label="課表標記工具">${options.map(([id,name])=>`<button class="${brush===id?'active':''}" data-brush="${id}" aria-pressed="${brush===id}">${name}</button>`).join('')}</div><div class="clear-tools" role="group" aria-label="清除已畫的標記"><button class="button ghost mini" data-action="clear-time" ${prefs.time_blocks.length?'':'disabled'}>清除時間標記</button><button class="button ghost mini" data-action="clear-campus" ${prefs.campus_blocks.length?'':'disabled'}>清除校區標記</button>${clearUndo?'<button class="text-button" data-action="undo-clear">復原上次清除</button>':''}<details class="cell-erasers" ${brush.startsWith('erase')?'open':''}><summary>只擦除部分標記</summary><div class="paint-tools"><button class="${brush==='erase-time'?'active':''}" data-brush="erase-time" aria-pressed="${brush==='erase-time'}">擦除時間（逐格）</button><button class="${brush==='erase-campus'?'active':''}" data-brush="erase-campus" aria-pressed="${brush==='erase-campus'}">擦除校區（逐格）</button></div></details><span class="muted">按一下清除全部對應標記，已選課程會保留。</span></div>${calendar()}<p class="muted">虛線為公開課程試排，資格與學分待確認。標記按節次套用，課程精確時間請看明細。</p><details class="subtle-details"><summary>節次說明與來源</summary><p class="muted">依<a href="https://web-ch.scu.edu.tw/regcurr/web_page/16474" target="_blank" rel="noopener noreferrer">校方節次公告</a>顯示至 D 節 22:05。9* 標記涵蓋 17:10–18:20；789 的第 9 節為 17:10–18:00，9AB 為 17:30–18:20。時間格內部分標記也會顯示，實際範圍會保留。未能換算的特殊節次不會自行推測。</p></details><p class="muted">「希望留空」與「希望校區」會優先考量；不方便上課的時段會排除。</p><div class="slot-explore"><div><strong>選取的空堂</strong><span>週${dayNames[slot.weekday]} ${time(slot.start_minute)}–${time(slot.end_minute)}</span></div><button class="button ghost" data-action="open-public-explorer" data-window="1">用這段空堂查公開課程 →</button><button class="button ghost" data-action="open-explorer" data-window="1">${prefDirty?'儲存安排並用這段時間找課':'用這段時間探索課程'} →</button></div><details class="subtle-details"><summary>設定這學期的學分範圍</summary><div class="form-row"><label class="field">至少修幾學分<input id="min-credits" type="number" min="0" max="30" step="0.01" value="${prefs.min_credits}"></label><label class="field">最多修幾學分<input id="max-credits" type="number" min="0" max="30" step="0.01" value="${prefs.max_credits}"></label></div></details><div class="actions"><button class="button" data-action="save-preferences" ${prefDirty?'':'disabled'}>儲存時間安排</button><span id="pref-state" class="muted">${prefDirty?'有調整尚未儲存':'時間安排已儲存'}</span></div></section><div class="actions step-actions"><button class="button ghost" data-step="2">← 探索方向</button><button class="button" data-step="4">接著確認課表 →</button></div></div><aside class="sticky">${selectedPanel()}</aside></div>`;
}
function stage4() {
  const validation=latest('validation',true),confirmation=latest('confirmation',true),exported=latest('export',true),report=latest('registration',true);
  const audit=validation?.audit || ws.context.audit;
  const savedStates=Object.fromEntries((report?.items || []).map(i=>[i.offering_id,i.state]));
  return `<div class="columns"><div><section class="panel"><h2>確認你的選課規劃</h2><p class="muted">最後檢查修課條件、上課時間與學分安排。確認後可以下載清單，方便正式選課時對照。</p>${metrics(audit)}<div class="actions"><button class="button" data-action="validate">${validation?'重新檢查課表':'檢查我的課表'}</button>${confirmation?badge('confirmed'):''}</div></section>
    ${validation?`<section class="panel"><h2>課表檢查結果</h2>${[['eligibility','修課條件'],['schedule','時間與學分負擔'],['recognition','學分認列提醒']].map(([key,label])=>`<h3 class="section-title">${label} ${badge(validation[key].status)}</h3>${checkList(validation[key])}`).join('')}<details class="subtle-details"><summary>看看這份課表如何幫助畢業</summary><h3>目前已完成的進度</h3>${checkList(audit.current_requirements)}<h3 class="section-title">修習中與規劃課程全數通過後</h3>${checkList(audit.projected_requirements)}<h3 class="section-title">各課程的學分用途</h3><ul class="plain-list">${audit.allocations.map(a=>`<li>${esc(courseName(a.course_id))} · 已取得 ${showNumber(a.earned_credits)} 學分 · 預估 ${showNumber(a.projected_credits)} 學分<br><span class="muted">${(a.requirement_ids || []).map(id=>esc(requirementNames[id] || '其他畢業要求')).join('、') || '尚待確認認列用途'}</span></li>`).join('')}</ul></details>${validation.recognition.status!=='pass'?'<label class="acknowledgement"><input id="acknowledge" type="checkbox">我了解仍有項目需要向學校確認。</label>':''}<div class="actions"><button class="button" data-action="confirm" ${validation.can_confirm_preselection && !confirmation?'':'disabled'}>${confirmation?'✓ 已確認這份課表':'確認這份課表'}</button></div>${!validation.can_confirm_preselection?'<p class="muted">請先處理需調整或待確認的項目，再重新檢查；想修清單內的公開課程也需要完成核對。</p>':''}<p class="muted">這是預選規劃，仍須到學校系統正式選課。</p></section>`:'<section class="panel"><p class="empty">按「檢查我的課表」，看看有沒有衝堂、先修或學分需要調整。</p></section>'}
    <section class="panel"><h2>帶著課表去選課</h2><p class="muted">下載 A4 規劃參考清單，正式選課後再到<a href="https://web.sys.scu.edu.tw/default.asp" target="_blank" rel="noopener noreferrer">校務系統</a>核對。</p><div class="actions"><button class="button" data-action="selection-pdf" disabled title="PDF 匯出請使用本機完整版">下載查對清單 PDF</button><button class="button ghost" data-action="${exported?'download':'export'}" ${exported?`data-id="${esc(exported.export_id)}"`:''} ${confirmation?'':'disabled'}>下載選課清單（CSV）</button></div>${confirmation?'':'<p class="muted">完成課表檢查與確認後，也能下載 CSV。</p>'}<details class="subtle-details"><summary>與校方查對表有什麼不同？</summary><p class="muted">尚未取得校方完整表單版型；這份 PDF 是規劃參考版，不能代替官方查對表或證明已選上。課程、時間與資料版本會完整列出，待核對項目不會改成已認列。</p></details></section>
    <details class="panel"><summary>已完成學校選課？記下實際結果</summary><p class="muted">記下選上或沒選上的課，方便之後調整。選上課程後，仍需修畢通過才會取得學分。</p><form id="report-form">${ws.plan.selections.map(s=>`<div class="form-row"><label class="field">${esc(courseName(offeringById(s.offering_id).course_id))}<select name="${esc(s.offering_id)}"><option value="" ${!savedStates[s.offering_id]?'selected':''}>請選擇實際結果</option>${[['enrolled','已選上'],['not_selected','沒有選上'],['full','額滿'],['cancelled','停開'],['withdrawn','已退選']].map(([value,label])=>`<option value="${value}" ${savedStates[s.offering_id]===value?'selected':''}>${label}</option>`).join('')}</select></label></div>`).join('')}<button class="button ghost" type="submit" ${ws.plan.selections.length?'':'disabled'}>儲存選課結果</button></form>${report?`<p class="notice success">已儲存選課結果。目前已取得 ${showNumber(report.earned_credits)} 學分，選上課程全數通過後預估增加 ${showNumber(report.projected_enrolled_credits)} 學分。<br>仍需安排：${report.unmet_required_course_ids.map(id=>esc(courseName(id))).join('、') || '沒有缺少的必排課程'}。</p>`:''}</details><div class="actions step-actions"><button class="button ghost" data-step="3">← 返回調整課表</button></div></div><aside>${selectedPanel()}</aside></div>`;
}
function render() {
  if(!ws) return;
  $('student').value=student;
  $('steps').hidden=explorerMode;
  $('identity').innerHTML=`<div class="identity"><span>${ws.context.profile.entry_year} 學年度入學 · ${ws.context.profile.year_level} 年級</span><details class="plan-manager"><summary>切換或新增課表</summary><div class="plan-manager-body"><label>我的課表 <select id="plan-select" aria-label="切換課表">${ws.plans.map((p,i)=>`<option value="${esc(p.plan_id)}" ${p.plan_id===ws.plan.plan_id?'selected':''}>課表 ${i+1}${p.plan_id===ws.plan.plan_id?'（目前使用）':''}</option>`).join('')}</select></label><button class="button ghost mini" data-action="new-plan">新增空白課表</button></div></details></div>`;
  $('steps').className='steps'; $('steps').innerHTML=['修課進度','探索方向','安排課表','確認課表'].map((name,i)=>`<button class="step ${step===i+1?'active':''}" data-step="${i+1}" ${step===i+1?'aria-current="step"':''}><b aria-hidden="true">${i+1}</b><span>${name}</span></button>`).join('');
  $('versions').innerHTML=`<div class="savebar"><span>${prefDirty?'有調整尚未儲存':'已載入儲存的課表'}</span><button class="text-button" data-action="saved-history">儲存紀錄</button></div>${ws.plan.validation_state==='stale'?'<div class="notice">修課資料或學分規定有更新，請先更新課表，再繼續規劃。<button class="button mini" data-action="sync">更新課表資料</button></div>':''}`;
    const personal=window.PersonalProgress;
    if(!explorerMode && personal?.active && step===1){$('identity').innerHTML=personal.heading();$('versions').innerHTML=personal.savebar();}
    if(!explorerMode && personal?.available && !personal.active && step===1)$('versions').insertAdjacentHTML('beforeend','<p><button class="button ghost mini" data-action="personal-show">返回我的真實修課進度</button></p>');
    if(!explorerMode && personal?.available && step!==1)$('versions').insertAdjacentHTML('beforeend','<div class="notice">以下仍使用示範學籍與課表，尚未接入個人選課判定；你的真實紀錄只在「修課進度」顯示，也不會傳送給 AI。</div>');
    $('student').closest('.experience-settings').hidden=!!(!explorerMode && personal?.active && step===1);
    document.getElementById('workspace-footer-note').textContent=personal?.active && step===1?'修課規劃供參考，正式認列以校方核定為準。':'目前為體驗版，其他選課規劃使用示範學籍；公開課程的資格與學分用途待學校確認。';
    $('main').innerHTML=explorerMode?renderCourseExplorer():[stage1,stage2,stage3,stage4][step-1]();
    enhanceProgressView();
  if(!explorerMode && [3,4].includes(step))document.querySelector('#main > .columns > div > section.panel')?.insertAdjacentHTML(step===3?'beforebegin':'afterend',publicPendingPanel());
}
async function savePlan(patch, text='課表已儲存，可以繼續規劃。') {
  await api('/plans/'+encodeURIComponent(ws.plan.plan_id),'PATCH',{...(prefDirty?{preferences:prefs}:{}),...patch},ws.plan.revision);
  await load(); message(text);
}
function openDetail(title,html) { $('detail-title').textContent=title; $('detail-body').innerHTML=html; $('detail').showModal(); $('detail').scrollTop=0; }
async function courseDetail(id) {
  await showExplorerCourse(id);
}
async function download(id) {
  const response=await fetch('/api/v1/exports/'+encodeURIComponent(id)+'/download',{headers:{Authorization:`Bearer MOCK-TOKEN-${student}`}});
  if(!response.ok) { const result=await response.json(); throw new Error(result.error?.message || '下載失敗'); }
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='我的選課清單.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadPlanPdf(kind) {
  if(prefDirty)await savePlan({preferences:prefs},'時間安排已儲存，正在準備 PDF。');
  const revision=ws.plan.revision;
  const response=await fetch(`/api/v1/plans/${encodeURIComponent(ws.plan.plan_id)}/pdf/${kind}?revision=${revision}`,{headers:{Authorization:`Bearer MOCK-TOKEN-${student}`}});
  if(!response.ok){const result=await response.json();throw new Error(result.error?.message || 'PDF 下載失敗，請重試。');}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;
  a.download=(kind==='timetable'?'我的每週課表':'選課查對清單_規劃參考')+`_第${revision}版.pdf`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  message(`已下載第 ${revision} 版 A4 PDF；這是規劃參考，仍須到學校正式選課。`);
}
function markCell(button) {
  const day=Number(button.dataset.day),start=Number(button.dataset.start);
  const end=cellEnd(start);
  const paintKey=day+'-'+start;
  if(dragging && lastPaintKey===paintKey) return;
  lastPaintKey=paintKey;
  if(brush==='slot') { slot={weekday:day,start_minute:start,end_minute:end}; render(); return; }
  const key=['CITY','SHUANGXI','erase-campus'].includes(brush)?'campus_blocks':'time_blocks';
  if(clearUndo?.key===key)clearUndo=null;
  // Split existing intervals to preserve unpainted portions, including off-grid minutes.
  prefs[key]=prefs[key].flatMap(b=>{
    if(b.weekday!==day || b.end_minute<=start || b.start_minute>=end) return [b];
    const parts=[];if(b.start_minute<start) parts.push({...b,end_minute:start});if(b.end_minute>end) parts.push({...b,start_minute:end});return parts;
  });
  if(!brush.startsWith('erase')) prefs[key].push({weekday:day,start_minute:start,end_minute:end,...(key==='campus_blocks'?{campus_id:brush}:{kind:brush})});
  prefDirty=true;
  const template=document.createElement('template');template.innerHTML=cellMarkup(day,start);const next=template.content.firstElementChild;
  button.className=next.className;button.innerHTML=next.innerHTML;button.setAttribute('aria-label',next.getAttribute('aria-label'));
  updatePreferenceState();
}
function updatePreferenceState() {
  if($('pref-state')) $('pref-state').textContent='有調整尚未儲存';
  const save=document.querySelector('[data-action="save-preferences"]');if(save) save.disabled=false;
  const label=document.querySelector('.savebar > span');if(label) label.textContent='有調整尚未儲存';
  const timeClear=document.querySelector('[data-action="clear-time"]');if(timeClear)timeClear.disabled=!prefs.time_blocks.length;
  const campusClear=document.querySelector('[data-action="clear-campus"]');if(campusClear)campusClear.disabled=!prefs.campus_blocks.length;
  const undo=document.querySelector('[data-action="undo-clear"]');if(undo && !clearUndo)undo.remove();
  const explore=document.querySelector('[data-action="open-explorer"][data-window="0"]');if(explore)explore.textContent='儲存安排並探索課程 →';
  const windowExplore=document.querySelector('[data-action="open-explorer"][data-window="1"]');if(windowExplore)windowExplore.textContent='儲存安排並用這段時間找課 →';
}
function clearMarkings(key) {
  if(!prefs[key].length){message(key==='time_blocks'?'目前沒有時間標記可清除。':'目前沒有校區標記可清除。');return;}
  clearUndo={key,blocks:clone(prefs[key])};
  prefs[key]=[];prefDirty=true;slotResult=null;render();
  message(key==='time_blocks'?'時間標記已清除，已選課程與校區標記會保留。儲存後套用。':'校區標記已清除，已選課程與時間標記會保留。儲存後套用。');
}
if (!window.publicCourseCatalogMode) {
document.addEventListener('pointerdown',e=>{const cell=e.target.closest('.cell');if(cell&&!busy){e.preventDefault();lastPaintKey=null;dragging=brush!=='slot';markCell(cell);}});
document.addEventListener('pointerover',e=>{const cell=e.target.closest('.cell');if(cell&&dragging&&e.buttons===1)markCell(cell);});
document.addEventListener('pointerup',()=>{dragging=false;});
document.addEventListener('pointercancel',()=>{dragging=false;});
document.addEventListener('click',event=>{
  if(event.target.closest('[data-action="dismiss-message"]')){message('');return;}
  const cell=event.target.closest('.cell');if(cell&&event.detail===0&&!busy){markCell(cell);return;}
  const b=event.target.closest('button');if(!b||b.disabled||busy)return;
  if(b.dataset.step){step=Number(b.dataset.step);sessionStorage.setItem('be02-step',String(step));render();$('main').focus();return;}
  if(b.dataset.brush){brush=b.dataset.brush;render();return;}
  const action=b.dataset.action;if(!action)return;
  run(async()=>{
    if(window.PersonalProgress && await PersonalProgress.handle(action,b,{render,openDetail}))return;
    if(['open-explorer','back-to-planner','show-my-courses','teacher-profile','explorer-reset','compare-toggle','compare-clear','compare-open'].includes(action)){await handleExplorerAction(action,b);return;}
    if(action==='clear-time'){clearMarkings('time_blocks');return;}
    if(action==='clear-campus'){clearMarkings('campus_blocks');return;}
    if(action==='timetable-pdf'){await downloadPlanPdf('timetable');return;}
    if(action==='selection-pdf'){await downloadPlanPdf('selection-check');return;}
    if(action==='undo-clear'){
      if(clearUndo){prefs[clearUndo.key]=clone(clearUndo.blocks);clearUndo=null;prefDirty=JSON.stringify(prefs)!==JSON.stringify(ws.plan.preferences);render();message('已復原剛才清除的標記。');}
      return;
    }
    if(action==='saved-history')openDetail('之前儲存的課表',historyPanel());
    if(action==='reload'){await load();message('已載入儲存的課表。');}
    if(action==='sync')await savePlan({required_course_ids:ws.plan.required_course_ids});
    if(action==='save-preferences'){await savePlan({preferences:prefs},'時間與校區安排已儲存。');}
    if(action==='new-plan'){
      const plan=await api('/plans','POST',{term_id:ws.plan.term_id,required_course_ids:ws.plan.required_course_ids,selections:[],preferences:prefs});
      await load(plan.plan_id);step=1;sessionStorage.setItem('be02-step','1');render();message('已建立空白課表。原本的課表可以在「切換或新增課表」找到。');
    }
    if(action==='directions'){
      const intent=currentIntent();message(ws.ai?.configured?'正在幫你整理適合的方向，請稍候…':'正在準備示範方向…');
      const result=await api('/direction-suggestions','POST',{plan_id:ws.plan.plan_id,intent_id:intent.intent_id});
      await load();message(`找到 ${result.options.length} 個${result.generation_mode==='model'?'適合探索的':'示範'}方向，選一個你想試試的吧。`);
    }
    if(action==='choose-direction')await savePlan({confirmed_intent_id:currentIntent().intent_id,direction_id:b.dataset.id},'方向已儲存，接著可以安排課表。');
    if(action==='add'){
      const item=await explorerItem(b.dataset.id);
      if(item.fit.status==='fail')throw new Error(readable(item.fit.checks.find(c=>c.status==='fail').message));
      if(ws.plan.selections.some(s=>s.offering_id===b.dataset.id))throw new Error('這個班別已經在你的課表裡。');
      const wasOpen=$('detail').open;
      const selections=[...ws.plan.selections,{offering_id:b.dataset.id,placement:item.fit.status==='needs_review'?'review_queue':'scheduled',locked:false}];
      await savePlan({selections,...(prefDirty?{preferences:prefs}:{})});
      if(wasOpen)await showExplorerCourse(b.dataset.id);
    }
    if(action==='remove'){await savePlan({selections:ws.plan.selections.filter(s=>s.offering_id!==b.dataset.id)});if($('detail').open)openDetail('我的課表',selectedPanel());}
    if(action==='lock'){await savePlan({selections:ws.plan.selections.map(s=>s.offering_id===b.dataset.id?{...s,locked:!s.locked}:s)});if($('detail').open)openDetail('我的課表',selectedPanel());}
    if(action==='course-detail')await courseDetail(b.dataset.id);
    if(action==='open-public-explorer'){
      if(prefDirty)await savePlan({preferences:prefs});
      sessionStorage.setItem('be02-step','3');
      const params=new URLSearchParams({planning:'1',target_plan:ws.plan.plan_id});
      if(b.dataset.window==='1')for(const [key,value] of Object.entries({window_weekday:slot.weekday,start_minute:slot.start_minute,end_minute:slot.end_minute}))params.set(key,String(value));
      location.href='/scu-course-compass/course-explorer/?'+params;
    }
    if(action==='public-saved-detail')publicSavedDetail(b.dataset.id);
    if(action==='public-place' || action==='public-unplace'){
      if(prefDirty)await savePlan({preferences:prefs});
      await api('/plans/'+encodeURIComponent(ws.plan.plan_id)+'/public-course-selections','PATCH',{action:action==='public-place'?'place':'unplace',offering_id:b.dataset.id},ws.plan.revision);
      await load();message(action==='public-place'?'已試排到時間格，資格、週次及學分仍待確認。':'已取消試排，課程仍保留在想修清單。');
    }
    if(action==='public-refresh-preview'){
      const response=await fetch('/api/v1/public-courses/'+encodeURIComponent(b.dataset.id));
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message || '目前無法讀取最新課程。');
      const detail=payload.data,old=ws.public_course_selections.items.find(e=>e.detail.item.offering_id===b.dataset.id);
      if(!old)throw new Error('找不到已保存的課程，請重新載入。');
      publicRefreshPreview={planId:ws.plan.plan_id,revision:ws.plan.revision,detail,wasTrial:old.placement==='trial_scheduled'};
      openDetail('看看最新的課程資料',`<h3>${esc(detail.item.title)}</h3><h4>之前保存的時間與地點</h4><p>${publicMeeting(old.detail.item)}</p><h4>最新資料的時間與地點</h4><p>${publicMeeting(detail.item)}</p><p class="notice">${esc(detail.item.reference_context?.note || '依目前保存的公開課程資料。')} 採用後會新增課表版本，之前的內容仍可查看；資格與學分仍待確認。</p><button class="button" data-action="public-refresh-commit">採用這份資料並儲存</button>`);
    }
    if(action==='public-refresh-commit'){
      const preview=publicRefreshPreview;
      if(!preview || preview.planId!==ws.plan.plan_id || preview.revision!==ws.plan.revision)throw new Error('課表已有變動，請重新查看最新資料。');
      const item=preview.detail.item;
      await api('/plans/'+encodeURIComponent(preview.planId)+'/public-course-selections','PATCH',{action:'refresh',offering_id:item.offering_id,revision_id:item.revision_id,syllabus_revision_id:item.syllabus_revision_id,reference_version:item.reference_context?.version || null},preview.revision);
      $('detail').close();await load();message(preview.wasTrial?'已更新並先移回想修清單，請依新版時間重新試排。舊版課表仍保留。':'已採用最新課程資料，舊版內容仍保留在儲存紀錄。');
    }
    if(action==='public-remove'){
      await api('/plans/'+encodeURIComponent(ws.plan.plan_id)+'/public-course-selections','PATCH',{action:'remove',offering_id:b.dataset.id},ws.plan.revision);
      await load();message('已移除公開課程，之前儲存的版本仍會保留。');
    }
    if(action==='public-export'){
      const response=await fetch('/api/v1/plans/'+encodeURIComponent(ws.plan.plan_id)+'/public-course-selections/export?revision='+ws.plan.revision,{headers:{Authorization:`Bearer MOCK-TOKEN-${student}`}});
      if(!response.ok)throw new Error('無法下載待確認清單，請稍後再試。');
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='待確認公開課程.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if(action==='history'){
      const plan=await api('/plans/'+encodeURIComponent(ws.plan.plan_id)+'?revision='+b.dataset.rev);
      const snapshot=await api('/snapshots/'+encodeURIComponent(plan.input_snapshot_id));
      openDetail('之前儲存的課表',`<p class="muted">這是當時儲存的內容，僅供查看。</p><div class="history-meta"><div><strong>${plan.selections.length}</strong>已選課程</div><div><strong>${snapshot.academic.records.length}</strong>當時的修課紀錄</div><div><strong>${snapshot.profile.year_level}</strong>當時的年級</div></div><ul class="plain-list">${plan.selections.map(s=>{const o=snapshot.catalog.offerings.find(item=>item.offering_id===s.offering_id),name=snapshot.catalog.courses.find(item=>item.course_id===o?.course_id)?.name;return `<li><strong>${esc(cleanName(name || '課程名稱待確認'))}</strong><p class="muted">${o?meetings(o):'上課時間待確認'} · ${s.placement==='scheduled'?'已排入':'待確認'}${s.locked?' · 已固定':''}</p></li>`;}).join('') || '<li>這份課表還沒有加入課程。</li>'}</ul><h3 class="section-title">時間與校區安排</h3><p class="muted">${plan.preferences.time_blocks.length} 段時間標記 · ${plan.preferences.campus_blocks.length} 段校區偏好 · 預計 ${plan.preferences.min_credits}–${plan.preferences.max_credits} 學分</p>`);
      $('detail-body').insertAdjacentHTML('beforeend',publicPendingPanel(snapshot.public_course_selections || [],true));
    }
    if(action==='commit-import'){
      await api('/me/record-imports/'+importPreview.import_id+'/confirm','POST',{accepted_row_numbers:importPreview.accepted_row_numbers},importPreview.records_revision);
      importPreview=null;await load();message('已新增修課紀錄，請按「更新課表資料」套用最新內容。');
    }
    if(action==='validate'){await api('/plans/'+ws.plan.plan_id+'/validations','POST',{plan_revision:ws.plan.revision},ws.plan.revision);await load();message('課表檢查完成，請看看結果。');}
    if(action==='confirm'){
      const v=latest('validation',true),pending=v.recognition.checks.filter(c=>c.status!=='pass').map(c=>c.check_id);
      if(pending.length&&!$('acknowledge')?.checked)throw new Error('請先勾選「我了解仍有項目需要向學校確認」。');
      await api('/plans/'+ws.plan.plan_id+'/confirmations','POST',{plan_revision:ws.plan.revision,validation_id:v.validation_id,acknowledged_check_ids:pending},ws.plan.revision);
      await load();message('課表已確認，可以下載選課清單了。');
    }
    if(action==='export'){
      const c=latest('confirmation',true);await api('/plans/'+ws.plan.plan_id+'/exports','POST',{confirmation_id:c.confirmation_id,plan_revision:ws.plan.revision,format:'csv',content:'courses'},ws.plan.revision);
      await load();await download(latest('export',true).export_id);message('已準備好選課清單，開始下載。');
    }
    if(action==='download')await download(b.dataset.id);
  });
});
document.addEventListener('change',event=>{
  const id=event.target.id;
  if(event.target.closest('#explorer-filters')){cascadeExplorer(event.target.name);return;}
  if(id==='student')run(async()=>{student=event.target.value;sessionStorage.setItem('be02-student',student);importPreview=null;message('');await load();});
  if(id==='plan-select')run(async()=>{importPreview=null;await load(event.target.value);message('已切換課表。');});
  if(id==='objective'){prefs.objective=event.target.value;prefDirty=true;}
  if(id==='min-credits'||id==='max-credits'){prefs[id==='min-credits'?'min_credits':'max_credits']=Number(event.target.value);prefDirty=true;}
  if(['objective','min-credits','max-credits'].includes(id))updatePreferenceState();
});
document.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target;
  run(async()=>{
    if(form.id==='explorer-filters'){
      explorerFilters=readExplorerForm();
      explorerData=await api(explorerQuery(explorerFilters));rememberExplorer();render();
      if(!matchMedia('(min-width:701px)').matches)document.querySelector('.explorer-results')?.scrollIntoView({block:'start'});
      message(`找到 ${explorerData.matched_offerings} 個符合條件的班別。`);return;
    }
    if(form.id==='profile-form'){
      await api('/me/profile','PATCH',{target_graduation_term:form.elements.graduation.value.trim() || null,exploring_program_ids:Array.from(form.querySelectorAll('input[name=program]:checked')).map(i=>i.value)},ws.context.profile.revision);
      await load();message('規劃已儲存，請按「更新課表資料」套用最新內容。');
    }
    if(form.id==='import-form'){
      importPreview=await api('/me/record-imports','POST',{rows:[{source_record_key:'self-'+crypto.randomUUID(),course_id:form.elements.course.value,term_id:ws.plan.term_id,state:form.elements.state.value,grade:form.elements.grade.value===''?null:Number(form.elements.grade.value)}]});
      render();message('先看看新增內容，確認後再儲存。');
    }
    if(form.id==='intent-form'){
      message(ws.ai?.configured?'正在整理你的想法與修課經驗，請稍候…':'正在準備示範建議…');
      const result=await api('/intent-analyses','POST',{plan_id:ws.plan.plan_id,text:form.elements.text.value});
      await load();message(result.generation_mode==='model'?'已整理你的想法，看看理解得對不對。':'示範建議已準備好，請確認內容。');
    }
    if(form.id==='intent-confirm-form'){
      const intent=currentIntent(),fields={...intent.fields};
      for(const key of ['goals','interests','strengths','declared_constraints'])fields[key]=split(form.elements[key].value);
      fields.unresolved_fields=[];
      await api('/intent-analyses/'+intent.intent_id+'/confirm','POST',{fields},ws.plan.revision);await load();message('想法已儲存，接著看看適合你的方向。');
    }
    if(form.id==='slot-form'){
      if(prefDirty)throw new Error('請先儲存時間與校區偏好，再依這些條件推薦。');
      const mins=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
      slot={weekday:Number(form.elements.day.value),start_minute:mins(form.elements.start.value),end_minute:mins(form.elements.end.value)};
      slotScope=form.elements.scope.value;slotCampus=form.elements.campus.value;
      slotResult=await api('/slot-recommendations','POST',{plan_id:ws.plan.plan_id,plan_revision:ws.plan.revision,window:slot,scope:slotScope,campus_filter:slotCampus || null,include_needs_review:true});render();
      const slotForm=$('slot-form');slotForm.elements.scope.value=slotScope;slotForm.elements.campus.value=slotCampus;
      message('已依空堂、校區及現有課表完成推薦。');
    }
    if(form.id==='report-form'){
      if(ws.plan.selections.some(s=>!form.elements[s.offering_id].value))throw new Error('請為每門課選擇實際選課結果。');
      const items=ws.plan.selections.map(s=>({offering_id:s.offering_id,state:form.elements[s.offering_id].value}));
      await api('/plans/'+ws.plan.plan_id+'/registration-reports','POST',{plan_revision:ws.plan.revision,items,source_kind:'student_report'},ws.plan.revision);await load();message('選課結果已儲存。');
    }
  });
});
$('close-detail').addEventListener('click',()=>$('detail').close());
$('student').value=student;
void loadWorkspaceAccount();
window.addEventListener('pageshow',event=>{if(event.persisted)void loadWorkspaceAccount();});
run(async()=>{if(!explorerMode && window.PersonalProgress)await PersonalProgress.load();await load();});
}
