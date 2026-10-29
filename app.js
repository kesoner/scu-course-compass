'use strict';

const app = document.getElementById('app');
const toastNode = document.getElementById('toast');
const icons = {
  compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/>',
  chat:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  book:'<path d="M3 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3V4ZM21 4h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h5V4Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  bookmark:'<path d="M6 3h12v19l-6-4-6 4V3Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  spark:'<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/>',
  pen:'<path d="m4 17-1 4 4-1L20 7l-3-3L4 17ZM14 7l3 3"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  leaf:'<path d="M20 3C8 2 2 8 5 15c3 7 15 5 15-12ZM4 21l11-11"/>'
};
const icon = (name, size=19) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let bootstrap = null;
let state = null;
let token = sessionStorage.getItem('career-demo-token') || '';
let activeTab = sessionStorage.getItem('career-demo-tab') || 'activities';
let activityFilter = 'recommended';
let exploreSettingsOpen=false;
let selectedPlanId = null;
let currentVariant = 'baseline';
let digestResult = null;
let checkResult = null;
let currentClock = '';
let chatMessages = [];
let chatBusy = false;
let busy = false;
let toastTimer = null;
let selectedExampleId=null;
let guidanceMode='choose';
let aiDraft='';
const pageNames = {activities:'活動探索',academic:'學長怎麼選',chat:'學涯輔導站'};
const courseExamples=[
  {id:'foundation',title:'先修穩，再往資料分析走',tag:'先修與選修',icon:'book',intro:'想探索資料分析，也希望先把基礎打好。',choices:['先確認程式設計與統計基礎','再比較資料分析、資料庫等課程','必修先安排，選修保留調整空間'],tradeoff:'進階課不一定這學期全修，先把先修條件準備好。',preferNoFriday:false},
  {id:'free-day',title:'把週五留給實習與專案',tag:'時間與取捨',icon:'calendar',intro:'除了上課，也想留一段完整時間做自己的事。',choices:['先排固定必修與可修班別','優先比較沒有週五課的安排','檢查是否因此增加其他天的空堂'],tradeoff:'留下一天空間，可能要接受其他天較滿的課表。',preferNoFriday:true},
  {id:'flexible',title:'不先限縮時間，多看看可能',tag:'課表彈性',icon:'compass',intro:'還沒決定偏好的上課方式，想先比較幾種課表。',choices:['不先限制週五上課','比較上課天數與空堂','選一份願意接受的安排，再微調'],tradeoff:'更多安排彈性，也需要想清楚自己最在意的取捨。',preferNoFriday:false}
];
const guidanceRoles={
  professor:{title:'教授',icon:'book',subtitle:'聊課程、研究與升學方向',description:'想知道一門課怎麼銜接研究，或想請教專業領域的學習路徑。',salutation:'老師您好',questions:['這個方向建議先打好哪些基礎？','有哪些課程或研究題目可以先試試？','我可以帶著什麼作品或問題再來討論？']},
  alumni:{title:'校友',icon:'users',subtitle:'聽聽職場經驗與跨域選擇',description:'從實際工作經驗，了解職涯樣貌、實習準備與能力累積。',salutation:'校友您好',questions:['這類工作的日常與需要的能力是什麼？','學生時期的哪些課程或經驗最有幫助？','找實習或第一份工作前，可以先準備什麼？']},
  senior:{title:'學長姐志工',icon:'compass',subtitle:'聊修課經驗與校園生活',description:'想聽修課安排、跨系學習與時間取捨，也想知道別人怎麼走過。',salutation:'學長姐您好',questions:['你當時怎麼安排必修和想探索的選修？','有哪些時間、校區或修課條件容易忽略？','如果重新安排一次，你會先調整什麼？']}
};

function toast(message, error=false) {
  clearTimeout(toastTimer);
  toastNode.textContent = message;
  toastNode.className = `toast visible${error ? ' error' : ''}`;
  toastNode.setAttribute('role', error ? 'alert' : 'status');
  toastTimer = setTimeout(() => { toastNode.classList.remove('visible'); }, 5000);
}

async function api(path, method='GET', body) {
  const headers = {'Accept':'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {method,headers,body:body === undefined ? undefined : JSON.stringify(body)});
  let result;
  try { result = await response.json(); } catch { throw new Error('服務回應格式不正確，請重新整理後再試。'); }
  if (!response.ok || result.error) {
    if (response.status === 401 && path !== '/api/demo/login') {
      sessionStorage.removeItem('career-demo-token');
      token = '';
    }
    throw new Error(result.error?.message || result.message || `請求失敗（${response.status}）`);
  }
  return result;
}

function updateState(result) {
  state = result.state || result;
  if (state.variant) currentVariant = state.variant;
}
async function refreshState() { updateState(await api('/api/state')); }
async function withBusy(action, label='正在更新…') {
  if (busy) return;
  busy = true;
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `<span>${esc(label)}</span>`;
  app.appendChild(overlay);
  try { await action(); }
  catch (error) { toast(error.message || '操作未完成，請再試一次。',true); }
  finally { busy = false; overlay.remove(); }
}

function fmtDate(value) {
  if (!value) return '時間待確認';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-TW', {month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'});
}
function localClock(value) { return String(value || '').slice(0,16); }
function fullClock(value) { return value ? `${value.length === 16 ? value+':00' : value}+08:00` : undefined; }
function fmtFormat(value) { return ({online:'線上',campus:'校內',offline:'實體'}[value] || value || '地點待確認'); }
function asList(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function feedbackFor(id) {
  const raw = state?.feedback;
  if (Array.isArray(raw)) return raw.filter(item => item.activity_id === id);
  if (raw && typeof raw === 'object') {
    const data = raw[id];
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (data.action) return [data];
      return Object.entries(data).filter(([,v]) => v).map(([action,value]) => ({action,text:typeof value === 'string' ? value : value.text || ''}));
    }
  }
  return [];
}
const savedActivity = id => feedbackFor(id).some(item => item.action === 'saved');
function getPlans() { return Array.isArray(state?.plans) ? state.plans : state?.plans?.plans || []; }
function effectiveConfirmation() {
  const c = state?.confirmation;
  return c && (!c.input_snapshot_id || c.input_snapshot_id === state.input_snapshot_id) && c.valid !== false ? c : null;
}

function accountLabel(profile){
  const fullDepartment=String(profile.department || '');
  const department=fullDepartment.length>3?fullDepartment.replace(/學系$|系$/,''):fullDepartment.replace(/系$/,'');
  const year=profile.year==null?'':(['一','二','三','四','五','六'][Number(profile.year)-1] || String(profile.year));
  return [department,year,profile.name || '我的帳號'].filter(Boolean).join(' ');
}
function shell(body) {
  const profile=state?.profile || {};
  return `<div class="layout"><header class="global-header"><a class="brand" href="/scu-course-compass/" aria-label="職涯導航首頁"><span class="brand-mark"><img src="/scu-course-compass/brand-logo.png" alt="職涯導航標誌"></span><div><strong>職涯導航</strong><small>FIND YOUR NEXT STEP</small></div></a><label class="profile-switch account-control" for="profile-switch"><span class="account-copy"><span class="account-name-line"><strong>${esc(profile.name || '我的帳號')}</strong><svg class="account-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></span><small>${esc(profile.department || '')} · ${esc(profile.year || '—')} 年級</small></span><span class="avatar" aria-hidden="true">${esc((profile.name || '我').slice(-1))}</span><select id="profile-switch" class="profile-select" aria-label="切換帳號">${(bootstrap?.profiles || []).map(p=>`<option value="${esc(p.id)}" ${p.id===profile.id?'selected':''}>${esc(accountLabel(p))}</option>`).join('')}</select></label></header>
  <aside class="sidebar" aria-label="主要導覽"><div class="nav-caption">我的探索空間</div><nav class="nav">${Object.entries(pageNames).map(([id,name])=>`<button class="nav-button ${activeTab===id?'active':''}" data-action="tab" data-tab="${id}" ${activeTab===id?'aria-current="page"':''}>${icon(id==='activities'?'compass':id==='academic'?'calendar':'chat')}<span>${name}</span><span>↗</span></button>`).join('')}<a class="nav-button" href="/scu-course-compass/four-stage/" style="text-decoration:none">${icon('book')}<span>規劃我的課表</span><span>↗</span></a></nav><div class="sidebar-note"><div class="eyebrow">一步一步 找到方向</div><p>探索不需要一次決定。<br>從今天願意嘗試的事開始。</p></div><div class="sidebar-bottom">你的步調，由你決定。</div></aside>
  <div class="main-shell"><main id="main-content" class="content" tabindex="-1">${body}<footer class="page-footer"><span>職涯導航 · 每一次嘗試，都是線索。</span><div class="footer-links"><a href="/scu-course-compass/service-info/#terms">使用條款</a><a href="/scu-course-compass/service-info/#disclaimer">免責聲明</a><a href="/scu-course-compass/service-info/#privacy">資料使用</a><span>體驗版</span></div></footer></main></div></div>`;
}

function render() {
  if (!state || !bootstrap) return;
  app.innerHTML = shell(activeTab === 'academic' ? academicPage() : activeTab === 'chat' ? chatPage() : activityPage());
  if (activeTab === 'chat') scrollChat();
}

function activityCard(activity) {
  const saved=savedActivity(activity.id),records=feedbackFor(activity.id);
  const dismissed=records.some(item=>item.action==='dismissed');
  const reflection=[...records].reverse().find(item=>item.action==='reflection')?.text || '';
  const labels=asList(activity.tags || activity.interests),title=activity.title || activity.name || '活動資訊待補充';
  const cost=activity.cost==null || String(activity.cost).trim()===''?NaN:Number(activity.cost);
  const price=Number.isFinite(cost) && cost>=0?cost===0?'免費':`NT$ ${cost.toLocaleString('zh-TW')}`:'費用待確認';
  const reasons=asList(activity.eligible===false?activity.exclusion_reasons:activity.match_reasons).filter(Boolean);
  const shortReason=reasons[0] || (activity.eligible===false?'活動條件待確認，請先查看詳情。':activity.description || '找一個有興趣的主題，先試試看。');
  return `<article class="activity-card activity-compact" data-activity="${esc(activity.id)}">
    <div class="activity-body"><div class="activity-card-top"><span class="activity-kicker">${esc(activity.activity_type || activity.type || labels[0] || '入門探索')}</span><button class="activity-bookmark ${saved?'is-saved':''}" data-action="feedback" data-id="${esc(activity.id)}" data-feedback="saved" aria-label="${saved?'取消收藏':'收藏'}${esc(title)}" aria-pressed="${saved}">${icon(saved?'check':'bookmark',18)}</button></div>
    <h3 class="activity-title">${esc(title)}</h3><div class="activity-meta"><div class="meta-line">${icon('clock',14)}<span>${esc(fmtDate(activity.starts_at || activity.start))}</span></div><div class="meta-line">${icon('pin',14)}<span>${esc(activity.format?fmtFormat(activity.format):'形式待確認')}</span></div></div>
    <p class="activity-fit ${activity.eligible===false?'needs-attention':''}">${esc(shortReason)}</p>${dismissed?'<span class="activity-skipped">已略過</span>':''}</div>
    <details class="activity-details"><summary aria-label="查看${esc(title)}的活動詳情，${esc(price)}"><span class="activity-price ${cost===0?'is-free':''}">${esc(price)}</span><span class="activity-detail-link">活動詳情${icon('arrow',15)}</span></summary><div class="activity-expanded">
    ${activity.description?`<p class="activity-description">${esc(activity.description)}</p>`:''}<dl class="activity-facts"><div><dt>地點</dt><dd>${esc(activity.location || fmtFormat(activity.format))}</dd></div><div><dt>參與資格</dt><dd>${esc(activity.eligibility || '資格待確認')}</dd></div>${activity.registration_deadline?`<div><dt>報名截止</dt><dd>${esc(fmtDate(activity.registration_deadline))}</dd></div>`:''}${activity.ends_at?`<div><dt>活動結束</dt><dd>${esc(fmtDate(activity.ends_at))}</dd></div>`:''}${activity.organizer?`<div><dt>主辦單位</dt><dd>${esc(activity.organizer)}</dd></div>`:''}</dl>
    ${reasons.length?`<div class="activity-reasons"><h4>${activity.eligible===false?'目前需留意':'推薦依據'}</h4><ul>${reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul></div>`:''}<button class="btn ghost small" data-action="feedback" data-id="${esc(activity.id)}" data-feedback="dismissed">${dismissed?'恢復推薦':'這次先略過'}</button>
    <details class="feedback-details"><summary>參與與回顧${reflection?' · 已有紀錄':''}</summary><div class="feedback-form"><div class="feedback-actions"><button class="btn small" data-action="feedback" data-id="${esc(activity.id)}" data-feedback="registered_self_report">記下已報名</button><button class="btn small" data-action="feedback" data-id="${esc(activity.id)}" data-feedback="participated_self_report">記下已參與</button></div><label for="reflection-${esc(activity.id)}">這次體驗，留下什麼想法？</label><textarea id="reflection-${esc(activity.id)}" maxlength="1500" placeholder="一句話也可以。">${esc(reflection)}</textarea><button class="btn small secondary" style="margin-top:9px" data-action="reflection" data-id="${esc(activity.id)}">儲存回顧</button><p class="helper">報名與參與為本人回填。</p></div></details><p class="activity-source">${esc(activity.source_label || activity.source?.label || '示範活動資料')} · 僅供體驗</p>
    </div></details></article>`;
}

function preferencePanel() {
  const prefs=state.preferences || {},notification=prefs.notification || {};
  const interests=asList(prefs.interests),formats=asList(prefs.formats);
  return `<section class="panel explore-preference-panel"><h2>選你感興趣的</h2><form id="preferences-form"><div class="chip-group">${['文字表達','社會議題','工作日常','校友對談'].map(value=>`<label class="check-chip"><input type="checkbox" name="interests" value="${value}" ${interests.includes(value)?'checked':''}>${value}</label>`).join('')}</div>
    <div class="explore-preference-fields"><div><label class="field-label" for="activity-budget">預算</label><select class="input" id="activity-budget" name="budget"><option value="0" ${Number(prefs.budget || 0)===0?'selected':''}>免費</option><option value="300" ${Number(prefs.budget)===300?'selected':''}>300 元以內</option><option value="1000" ${Number(prefs.budget)>=1000?'selected':''}>1,000 元以內</option></select></div><div><span class="field-label">參與方式</span><div class="chip-group">${['線上','校內'].map(value=>`<label class="check-chip"><input type="checkbox" name="formats" value="${value}" ${formats.includes(value)?'checked':''}>${value}</label>`).join('')}</div></div></div>
    <details class="explore-advanced"><summary>摘要偏好</summary><label class="switch-row" for="notification-enabled"><span>開啟摘要預覽<small>最多每週 3 則</small></span><input type="checkbox" class="switch" name="enabled" id="notification-enabled" ${notification.enabled?'checked':''} role="switch"></label><label class="field-label">安靜時段</label><div class="form-row"><input type="time" class="input" name="quiet_start" aria-label="安靜時段開始" value="${esc(notification.quiet_start || '22:00')}"><span>—</span><input type="time" class="input" name="quiet_end" aria-label="安靜時段結束" value="${esc(notification.quiet_end || '08:00')}"></div></details><button class="btn primary" type="submit">套用偏好</button></form></section>`;
}

function digestMarkup() {
  if (!digestResult) return '';
  const status = digestResult.status;
  const titles = {ready:'這一次的探索摘要',disabled:'摘要尚未啟用',deferred:'現在是安靜時段',duplicate:'這週已預覽過摘要',empty:'暫時沒有合適活動'};
  const descriptions = {disabled:'你仍可自由瀏覽和收藏。想預覽推薦時，再開啟探索摘要。',deferred:'摘要會等你設定的安靜時段結束後，再符合顯示條件。',duplicate:'相同期間的摘要不重複產生，你可以回到活動列表繼續探索。',empty:'不為湊滿則數推薦。可以調整興趣、形式或預算後再試。'};
  return `<div class="digest-output" role="status"><h3>${esc(titles[status] || '摘要預覽結果')}</h3>${digestResult.items?.length?`<ul>${digestResult.items.map(item=>`<li>${esc(item.title || item.name || item.id)}</li>`).join('')}</ul>`:`<p>${esc(digestResult.next_action || descriptions[status] || digestResult.message || '請調整偏好後再試。')}</p>`}<p class="digest-meta">僅預覽，不會發送通知</p></div>`;
}

function activityPage() {
  const all=asList(state.activities),eligible=all.filter(a=>a.eligible!==false),excluded=all.filter(a=>a.eligible===false);
  const activities=activityFilter==='saved'?all.filter(a=>savedActivity(a.id)):eligible;
  const interests=asList(state.preferences?.interests);
  return `<div class="explore-page"><header class="explore-header"><div><p class="eyebrow">活動探索</p><h1>先試一點，你喜歡的事。</h1><p>從一場活動開始，慢慢找到方向。</p></div><span class="explore-demo-label">示範活動</span></header>
    <div class="explore-toolbar"><div class="tabs" aria-label="活動篩選"><button class="pill-button ${activityFilter==='recommended'?'active':''}" data-action="filter" data-filter="recommended" aria-pressed="${activityFilter==='recommended'}">推薦給你<span class="count">${eligible.length}</span></button><button class="pill-button ${activityFilter==='saved'?'active':''}" data-action="filter" data-filter="saved" aria-pressed="${activityFilter==='saved'}">已收藏<span class="count">${all.filter(a=>savedActivity(a.id)).length}</span></button></div><span class="explore-results">${activities.length} 場活動</span></div>
    <details class="explore-settings" ${exploreSettingsOpen?'open':''}><summary><span>${icon('pen',15)}興趣與預算</span><span class="explore-settings-hint">${esc(interests.slice(0,2).join('、') || '自由探索')} · ${Number(state.preferences?.budget || 0)===0?'免費優先':'預算 '+Number(state.preferences?.budget).toLocaleString('zh-TW')+' 元'}</span><span aria-hidden="true">＋</span></summary><div class="explore-settings-grid">${preferencePanel()}<section class="panel explore-digest-panel"><h2>這週，想試試什麼？</h2><p class="panel-description">整理成一份簡短的活動摘要。</p><details class="explore-advanced"><summary>調整預覽時間</summary><label class="field-label" for="demo-clock">台北時間</label><input type="datetime-local" class="input" id="demo-clock" value="${esc(localClock(currentClock || bootstrap.demo_clock))}"></details><button class="btn" data-action="digest">預覽本週摘要${icon('arrow',15)}</button><div id="digest-result">${digestMarkup()}</div></section></div></details>
    <div class="activity-grid">${activities.length?activities.map(activityCard).join(''):`<div class="empty-state"><span class="empty-symbol">${icon(activityFilter==='saved'?'bookmark':'compass',28)}</span><h2>${activityFilter==='saved'?'先留住一個好奇':'換個條件，找找看。'}</h2><p>${activityFilter==='saved'?'喜歡的活動，點一下書籤就能收藏。':'展開「興趣與預算」，試試其他主題或參與方式。'}</p></div>`}</div>
    ${excluded.length?`<details class="explore-excluded"><summary>其他活動 · ${excluded.length} 場未符合目前條件</summary><div class="excluded-list">${excluded.map(a=>`<div><strong>${esc(a.title)}</strong><br>${esc(asList(a.exclusion_reasons).join('；') || '活動資訊待核對')}</div>`).join('')}</div></details>`:''}</div>`;
}

function stateMessage(result) {
  if (!result) return '';
  const status = result.status || result.scheduling_status;
  const labels = {feasible:'已找到通過目前限制的方案',infeasible:'目前條件無法排出課表',insufficient_data:'有必要資料尚待確認',search_incomplete:'搜尋尚未完成',blocked:'這組班別有待修正的限制'};
  if (status === 'feasible') return '';
  return `<div class="status-message ${status==='blocked' || status==='infeasible'?'error':''}"><strong>${esc(labels[status] || status || '待確認')}</strong><p>${esc(result.message || result.next_action || (status==='insufficient_data'?'請補齊修課紀錄，再重新計算。':status==='search_incomplete'?'可以重試；搜尋未完成不等於已證明無解。':'請調整指定條件後再檢查。'))}</p>${result.missing_inputs?.length?`<p>待補：${esc(result.missing_inputs.join('、'))}</p>`:''}</div>`;
}

function planCard(plan) {
  const courses = state.fixture?.courses || [];
  const offerings = state.fixture?.offerings || [];
  const names = asList(plan.offering_ids).map(id => {const off=offerings.find(o=>o.id===id); return courses.find(c=>c.id===off?.course_id)?.name || id;});
  const selected = selectedPlanId === plan.id;
  return `<button class="plan-card ${selected?'selected':''}" data-action="select-plan" data-id="${esc(plan.id)}" aria-pressed="${selected}"><div class="plan-title"><span>方案 <span class="plan-label">${esc(plan.id)}</span></span><span class="plan-pill">限制已檢查</span></div><div class="plan-metrics"><div><strong>${esc(plan.teaching_days ?? '—')}</strong><span>上課天數</span></div><div><strong>${plan.has_friday?'有':'無'}</strong><span>週五課程</span></div><div><strong>${esc(plan.idle_minutes ?? '—')}</strong><span>空堂分鐘</span></div></div><div class="plan-courses">${names.map(esc).join(' · ')}</div><div class="plan-selected-mark">${selected?'✓ 已選擇此方案':'點選比較與確認'}</div></button>`;
}

function selectedSchedule(plan) {
  const fixture = state.fixture || {};
  const dayNames = {Mon:'週一',Tue:'週二',Wed:'週三',Thu:'週四',Fri:'週五',Sat:'週六',Sun:'週日'};
  const rows = asList(plan.offering_ids).map(id => {
    const offering = (fixture.offerings || []).find(item=>item.id===id);
    const course = (fixture.courses || []).find(item=>item.id===offering?.course_id);
    const meetings = offering?.meetings || (offering ? [offering] : []);
    const times = meetings.map(meeting=>`${dayNames[meeting.day] || meeting.day || '星期待確認'} ${meeting.start || '—'}–${meeting.end || '—'}`);
    return `<tr><td>${esc(course?.name || offering?.course_id || '課程資料待確認')}${offering?.fixed?'<span class="fixed-course-note">固定課</span>':''}</td><td class="offering-id">${esc(id)}</td><td>${times.length?times.map(esc).join('<br>'):'時間待確認'}</td><td class="schedule-credits">${esc(course?.credits ?? '—')}</td></tr>`;
  }).join('');
  return `<section class="selected-schedule" aria-labelledby="schedule-heading"><div class="selected-schedule-heading"><h3 id="schedule-heading">所選方案的上課時段</h3><span>方案 ${esc(plan.id)}</span></div><p>對照班別與時間，確認這是你要帶走的安排。</p><div class="schedule-scroll" tabindex="0" role="region" aria-label="所選方案課程明細，可左右捲動"><table class="schedule-table"><thead><tr><th scope="col">課程</th><th scope="col">班別</th><th scope="col">上課時段</th><th scope="col">學分</th></tr></thead><tbody>${rows}</tbody></table></div><span class="schedule-scroll-hint">可左右滑動查看完整明細</span></section>`;
}

function manualCheckPanel() {
  const fixture = state.fixture || {};
  const courses = fixture.courses || [];
  const selected = getPlans().find(p=>p.id===selectedPlanId)?.offering_ids || [];
  const fixed = fixture.planning_constraints?.fixed_offering_ids || [];
  const dayNames = {Mon:'週一',Tue:'週二',Wed:'週三',Thu:'週四',Fri:'週五',Sat:'週六',Sun:'週日'};
  return `<section class="panel"><h2>自己試排看看</h2><p class="panel-description">選幾個班別，確認是哪個時段或先修條件需要調整。</p><div class="manual-offerings">${(fixture.offerings || []).map(o=>`<label class="offering"><input type="checkbox" name="offering" value="${esc(o.id)}" ${selected.includes(o.id)||fixed.includes(o.id)?'checked':''}><span>${esc(courses.find(c=>c.id===o.course_id)?.name || o.course_id)} <small>${esc(o.id)}${fixed.includes(o.id)?' · 固定課':''}<br>${esc(dayNames[o.day] || o.day)} ${esc(o.start)}–${esc(o.end)}</small></span></label>`).join('')}</div><button class="btn full" style="margin-top:13px" data-action="check-plan">檢查這組班別</button><div id="manual-check-result">${checkResultMarkup()}</div><p class="helper">這份安排若有衝突，可以換個班別再試試。</p></section>`;
}

function checkResultMarkup() {
  if (!checkResult) return '';
  const okay = (checkResult.status || checkResult.scheduling_status) === 'feasible';
  const issues = asList(checkResult.issues);
  return `<div class="check-result" role="status"><strong>${okay?'✓ 這組班別通過目前檢查':'有條件需要調整'}</strong>${issues.length?`<ul>${issues.map(issue=>`<li>${esc(issue.message || issue)}</li>`).join('')}</ul>`:`<p>本學期 ${esc(checkResult.semester_credits ?? '—')} 學分；仍須以目前資料範圍確認。</p>`}</div>`;
}

function exportRow(file) {
  const historical = file.input_snapshot_id !== state.input_snapshot_id;
  return `<div class="export-row ${historical?'historical-export':''}"><div class="export-description">${historical?'<strong class="export-version-note">上一版匯出 · 與目前資料不同</strong>':'<strong class="export-version-note current">目前課表的清單</strong>'}<span class="export-name">${esc(file.file_name || file.filename || file.export_id || file.id)}</span></div><button class="btn small" data-action="download" data-id="${esc(file.export_id || file.id)}" data-name="${esc(file.file_name || file.filename || '選課清單.csv')}">${historical?'下載上一版清單':'再次下載'}</button></div>`;
}

function academicPage() {
  const example=courseExamples.find(c=>c.id===selectedExampleId);
  if(example && state.academic_available)return `<div class="community-back"><button class="btn ghost small" data-action="examples-back">← 所有選課範例</button><span class="text-note">${esc(example.title)} · 獨立示範身分</span></div>${academicDemoPage()}`;
  return `<div class="header-space"><div class="eyebrow">COURSE EXAMPLES</div><h1 class="page-title">學長怎麼選，看看不同的走法。</h1><p class="page-subtitle">從選課範例看懂課程安排與取捨，再想想自己的下一步。</p></div>
    <div class="examples-intro"><span class="example-label">選課範例</span><p>以下是合成示範情境，並非真人課表或個人推薦。挑一個接近你的情境，看看如何比較安排。</p></div>
    <div class="course-examples">${courseExamples.map(example=>`<article class="example-card"><div class="community-card-top"><span class="community-icon">${icon(example.icon,23)}</span><span class="example-label">${esc(example.tag)}</span></div><h2>${esc(example.title)}</h2><p>${esc(example.intro)}</p><h3>這個範例怎麼選</h3><ul>${example.choices.map(choice=>`<li>${esc(choice)}</li>`).join('')}</ul><div class="example-tradeoff"><strong>願意接受的取捨</strong><p>${esc(example.tradeoff)}</p></div><button class="btn primary" data-action="view-example" data-id="${esc(example.id)}" aria-label="試試${esc(example.title)}的課表比較">試試課表比較${icon('arrow',15)}</button></article>`).join('')}</div>
    <p class="helper examples-note">課表比較會載入小明的獨立示範情境，可試選班別、檢查限制與匯出；不會使用你的真實修課紀錄。</p>
    <section class="discussion-invite"><div><h2>看完範例，還想找人聊聊？</h2><p>可以請教授、校友或學長姐志工分享經驗，也能先和 AI 整理想法。</p></div><div class="community-actions"><button class="btn" data-action="guidance-home">找人討論${icon('users',15)}</button><button class="btn primary" data-action="guidance-ai">先和 AI 聊聊${icon('spark',15)}</button></div></section>`;
}

function academicDemoPage() {
  if (!state.academic_available) return academicPage();
  const credits = state.credits || {};
  const total = credits.total || {};
  const plans = getPlans();
  const confirmation = effectiveConfirmation();
  const unknown = credits.requirement_status === 'unknown' || total.requirement_status === 'unknown';
  const selected = plans.find(p=>p.id===selectedPlanId);
  return `<div class="header-space"><div class="eyebrow">COURSE EXAMPLE</div><h1 class="page-title">試著比較，找到自己在意的取捨。</h1><p class="page-subtitle">${esc(state.fixture?.qualification?.name || '示範修課規劃')} · 這是選課範例，可自行調整與比較。</p></div>
    <details class="details-box"><summary>切換體驗情境</summary><div class="scenario-controls"><label for="scenario-variant">體驗情境</label><select id="scenario-variant" class="input"><option value="baseline" ${currentVariant==='baseline'?'selected':''}>目前修課資料</option><option value="missing_record" ${currentVariant==='missing_record'?'selected':''}>修課紀錄待確認</option><option value="no_solution" ${currentVariant==='no_solution'?'selected':''}>課程安排有衝突</option><option value="search_timeout" ${currentVariant==='search_timeout'?'selected':''}>搜尋尚未完成</option></select><button class="btn small" data-action="recalculate">重新計算</button><span class="text-note">資料改變後需重新確認方案</span></div></details>
    <div class="metrics"><div class="metric"><span>資格要求</span><strong>${esc(total.needed ?? '—')}<small>學分</small></strong></div><div class="metric"><span>已確認取得</span><strong>${esc(total.confirmed ?? '—')}<small>學分</small></strong></div><div class="metric accent"><span>${unknown?'缺口待確認':'目前尚缺'}</span><strong>${unknown?'待補':esc(total.gap ?? '—')}<small>${unknown?'資料':'學分'}</small></strong></div></div>
    <div class="credit-breakdown"><span>必修：已得 ${esc(credits.required?.confirmed ?? '—')} ／ 要求 ${esc(credits.required?.needed ?? '—')}</span><span>選修：已得 ${esc(credits.elective?.confirmed ?? '—')} ／ 要求 ${esc(credits.elective?.needed ?? '—')}</span><span>規劃學分尚未取得</span></div>
    <div class="academic-grid"><section>${stateMessage(state.plans)}<div class="section-heading"><div><h2>比較範例課表</h2><p>先看天數與空堂，再選擇願意接受的取捨。</p></div><span class="text-note">${plans.length} 份課表建議</span></div><div class="plan-list">${plans.length?plans.map(planCard).join(''):`<div class="empty-state"><h3>目前沒有可展示的方案</h3><p>請依上方提示補齊資料，或切回目前修課情境再試。</p></div>`}</div>
      <p class="academic-note">這些是依目前資料整理的課表建議，你也可以自行試排。</p>
      ${selected?selectedSchedule(selected):''}
      <div class="plan-actions"><button class="btn primary" data-action="confirm-plan" ${!selected?'disabled':''}>${icon('check',15)}確認${selected?`方案 ${esc(selected.id)}`:'所選方案'}</button><button class="btn" data-action="export" ${!confirmation?'disabled':''}>${icon('download',15)}匯出選課清單</button>${confirmation?'<span class="inline-status">✓ 已確認這份課表</span>':'<span class="text-note">選案並確認後，即可匯出。</span>'}</div>
      <div class="panel"><h2>帶走可以核對的規劃</h2><p class="panel-description" style="margin-bottom:6px">下載班別、上課時間與學分清單，方便到學校系統正式選課時對照。</p>${asList(state.exports).some(file=>file.input_snapshot_id!==state.input_snapshot_id)?'<p class="export-history-notice">上一版清單保留供查閱，與目前資料不同。請重新選擇並確認目前方案，才能產生新版清單。</p>':''}<div class="export-list">${asList(state.exports).slice().reverse().map(exportRow).join('')}</div></div>
      <p class="academic-note">規劃的課程需選上並修畢通過，才可能取得學分。正式認列請向學校確認。</p>
    </section><aside class="sidebar-panels">${manualCheckPanel()}<section class="panel"><h2>你在意的取捨</h2><p class="panel-description">先確認修課條件與時間，再考量你的偏好。</p><label class="switch-row" for="prefer-no-friday"><span>優先保留週五<small>這是可調整的偏好</small></span><input type="checkbox" id="prefer-no-friday" class="switch" role="switch" ${state.prefer_no_friday!==false?'checked':''}></label><button class="btn full" style="margin-top:14px" data-action="recalculate">更新偏好並重算</button><p class="helper">固定課、先修與衝堂條件仍必須通過。</p></section></aside></div>`;
}

function guidanceDraftKey(role){return 'career-guidance-draft:'+state.profile.id+':'+role;}
function readGuidanceDraft(role){
  try{return JSON.parse(sessionStorage.getItem(guidanceDraftKey(role)) || '{}');}catch{return {};}
}
function chatPage() {
  if(guidanceMode==='ai')return `<div class="community-back"><button class="btn ghost small" data-action="guidance-home">← 選擇其他討論方式</button><button class="btn ghost small" data-action="support-records">我的討論</button><span class="text-note">AI 討論</span></div>${aiChatPage()}`;
  const role=guidanceRoles[guidanceMode];
  if(role)return guidancePrepPage(role,guidanceMode);
  if(window.LearningSupport)return LearningSupport.render(state.profile);
  return `<div class="header-space"><h1 class="page-title">學涯輔導站</h1><p class="page-subtitle">選一種適合自己的討論方式。</p></div><div class="guidance-options"><article class="guidance-card guidance-ai"><span class="community-icon">${icon('spark',25)}</span><h2>AI 探索助理</h2><p>先整理想法，再帶著問題去聊。</p><button class="btn primary" data-action="guidance-ai">先和 AI 聊聊</button></article>${Object.entries(guidanceRoles).map(([id,r])=>`<article class="guidance-card"><h2>${esc(r.title)}</h2><p>${esc(r.subtitle)}</p><button class="btn" data-action="guidance-role" data-role="${id}">準備請教內容</button></article>`).join('')}</div>`;
}
function guidancePrepPage(role,roleId){
  const draft=readGuidanceDraft(roleId);
  return `<div class="community-back"><button class="btn ghost small" data-action="guidance-home">← 選擇討論對象</button></div><div class="header-space"><div class="eyebrow">LET’S TALK</div><h1 class="page-title">準備和${esc(role.title)}聊聊。</h1><p class="page-subtitle">先把想問的事整理好，讓一段對話更有方向。</p></div><div class="guidance-prep"><section class="panel"><h2>你想討論什麼？</h2><form id="guidance-prep-form"><label class="field-label" for="guidance-topic">想探索的方向</label><input class="input" id="guidance-topic" name="topic" maxlength="120" required value="${esc(draft.topic || '')}" placeholder="例如：軟體工程、科技法律或研究所準備"><label class="field-label" for="guidance-question">目前的疑問</label><textarea class="input" id="guidance-question" name="question" maxlength="1200" required placeholder="目前在考慮哪些選擇？希望從這次對話得到什麼？">${esc(draft.question || '')}</textarea><button class="btn primary" type="submit">整理討論提綱${icon('pen',15)}</button><p class="helper">草稿保留在這個瀏覽分頁，尚未傳送。真人媒合與預約尚未開放。</p></form></section><aside class="panel"><h2>可以從這些問題開始</h2><ul class="guidance-question-list">${role.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><button class="btn small" data-action="guidance-ai">也可以先和 AI 聊聊${icon('spark',15)}</button></aside></div>${draft.outline?`<section class="panel guidance-outline"><div class="section-heading"><div><h2>帶著這份提綱去討論</h2><p>這是請教草稿，尚未寄送。</p></div><button class="btn small" data-action="guidance-copy">複製提綱</button></div><textarea class="input" id="guidance-outline" readonly aria-label="討論提綱">${esc(draft.outline)}</textarea></section>`:''}`;
}
function buildGuidanceOutline(role,topic,question){
  return `${role.salutation}：\n\n我目前想探索「${topic}」，想請教您以下問題：\n${question}\n\n也想聽聽您的經驗：\n${role.questions.map((q,i)=>`${i+1}. ${q}`).join('\n')}\n\n希望討論後，能更清楚接下來的修課或學習方向。謝謝您願意分享！`;
}
function aiChatPage() {
  const model = bootstrap.model || {};
  const phi = !state.academic_available;
  const questions = phi ? ['我還不確定職業方向，可以先做什麼？','為什麼推薦這些活動給我？','怎麼關閉活動摘要？'] : ['我目前還缺多少學分？','幫我說明課表方案的取捨','同學期修先修課，能解除擋修嗎？'];
  return `<div class="header-space"><div class="eyebrow">CAREER COMPANION</div><h1 class="page-title">一起整理你的下一步。</h1><p class="page-subtitle">可以談興趣，也可以問目前資料中的活動與修課安排。</p></div><div class="chat-layout"><section class="chat-panel"><div class="chat-panel-header"><div><h2>職涯探索助手</h2><small>依目前示範身分與資料回答</small></div><span class="status-pill ${model.configured?'online':''}"><span class="status-dot"></span>${model.configured?'AI 探索助理':'示範回答'}</span></div><div id="chat-messages" class="chat-messages" aria-live="polite" aria-label="對話內容">${chatMessages.length?chatMessages.map(chatLine).join(''):`<div class="chat-welcome"><div class="welcome-icon">${icon('spark',29)}</div><h3>先從你現在的疑問開始。</h3><p>${phi?'不需要想好職業，也能先找到一場願意嘗試的活動。':'我可以協助說明學分缺口、限制原因與方案取捨。'}<br>${model.configured?'告訴我你的想法，一起找到可以嘗試的下一步。':'目前提供示範回答，協助你熟悉活動與選課功能。'}</p></div>`}${chatBusy?`<div class="chat-line"><div class="chat-avatar">${icon('spark',15)}</div><div class="chat-bubble inline-loader">正在整理回答…</div></div>`:''}</div><form id="chat-form" class="chat-composer"><div class="chat-input-row"><textarea id="chat-input" aria-label="輸入你的問題" maxlength="4000" rows="2" placeholder="例如：我喜歡社會議題，可以先參加什麼？" ${chatBusy?'disabled':''}>${esc(aiDraft)}</textarea><button class="btn primary" type="submit" ${chatBusy?'disabled':''} aria-label="送出問題">${icon('arrow',18)}</button></div><p class="chat-footnote">回答供探索與資料說明；學分和限制由規則計算，正式採計仍須確認。</p></form></section><aside><section class="panel"><h2>從這裡開始聊</h2><p class="panel-description">不用想一個完美的問題。</p><div class="question-list">${questions.map(question=>`<button class="question-button" data-action="ask" data-question="${esc(question)}" ${chatBusy?'disabled':''}>${esc(question)}${icon('arrow',14)}</button>`).join('')}</div></section><section class="panel"><h2>關於這位助理</h2><p class="panel-description">依你目前的興趣與修課資料，協助整理活動、課程與職涯方向。修課條件與學分仍會另外核對。</p><p class="helper">AI 的建議可以作為探索起點，正式選課與學分認列請以學校公告為準。</p></section></aside></div>`;
}

function chatLine(message) {
  const user = message.role === 'user';
  const meta = message.result;
  let label = '';
  if (meta) {
    if (meta.mode === 'local_demo') label = '示範回答';
    else if (meta.mode === 'unavailable') label = '服務未能完成回答';
    else label = 'AI 探索建議';
  }
  return `<div class="chat-line ${user?'user':''}"><div class="chat-avatar">${user?esc((state.profile?.name || '我').slice(-1)):icon('spark',15)}</div><div><div class="chat-bubble">${esc(message.text)}</div>${label?`<div class="chat-meta">${esc(label)}</div>`:''}</div></div>`;
}

function scrollChat() { const box = document.getElementById('chat-messages'); if (box) box.scrollTop = box.scrollHeight; }

async function login(profileId) {
  const data = await api('/api/demo/login','POST',{profile_id:profileId});
  token = data.token;
  sessionStorage.setItem('career-demo-token', token);
  sessionStorage.setItem('career-demo-profile',profileId);
  selectedPlanId = null; checkResult = null; digestResult = null; chatMessages = []; currentVariant = 'baseline';
  selectedExampleId=null;guidanceMode='choose';aiDraft='';
  await refreshState();
  render();
}

async function recalculate() {
  const variant = document.getElementById('scenario-variant')?.value || currentVariant;
  const preferNoFriday = document.getElementById('prefer-no-friday')?.checked ?? true;
  await withBusy(async()=>{
    updateState(await api('/api/snapshots','POST',{variant,prefer_no_friday:preferNoFriday}));
    currentVariant = variant;
    selectedPlanId = null; checkResult = null;
    render(); toast('已重新計算，請重新選擇並確認方案。');
  },'正在確認資料與重算課表…');
}

async function downloadExport(id, name, url) {
  const path = url || `/api/exports/${encodeURIComponent(id)}`;
  if (!path.startsWith('/api/exports/')) throw new Error('下載位置不正確。');
  const response = await fetch(path,{headers:{Authorization:`Bearer ${token}`}});
  if (!response.ok) {
    const data = await response.json().catch(()=>({}));
    throw new Error(data.error?.message || '下載未完成，請再試一次。');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = objectUrl; a.download = name || 'DEMO-選課清單.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}

async function exportPlan(simulateFailure=false) {
  const confirmation = effectiveConfirmation();
  if (!confirmation) return toast('請先確認目前的課表方案。',true);
  await withBusy(async()=>{
    const data = await api('/api/exports','POST',{confirmation_id:confirmation.confirmation_id || confirmation.id,simulate_failure:simulateFailure});
    if (!simulateFailure) await downloadExport(data.export_id || data.id,data.file_name,data.download_url);
    await refreshState(); render();
    toast(simulateFailure?'已完成匯出失敗測試。':'清單已產生並觸發下載，請開檔核對。');
  },'正在產生選課清單…');
}

async function sendChat(message) {
  message = String(message || '').trim();
  if (!message || chatBusy) return;
  const history = chatMessages.filter(m=>m.role === 'user' || (m.role === 'model' && m.result?.mode !== 'unavailable')).slice(-8).map(m=>({role:m.role,text:m.text}));
  aiDraft='';chatMessages.push({role:'user',text:message});
  chatBusy = true; render();
  try {
    const result = await api('/api/chat','POST',{message,history});
    chatMessages.push({role:'model',text:result.reply || '這次沒有取得可顯示的回答，請再試一次。',result});
  } catch (error) {
    chatMessages.push({role:'model',text:error.message || '目前無法取得回答，請稍後再試。',result:{mode:'unavailable'}});
  } finally { chatBusy = false; render(); document.getElementById('chat-input')?.focus(); }
}

app.addEventListener('click',async event=>{
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action;
  if(window.LearningSupport && LearningSupport.handle(action,button,{profile:state.profile,render:()=>{activeTab='chat';guidanceMode='choose';render();},toast}))return;
  if(action==='examples-back'){selectedExampleId=null;render();document.getElementById('main-content').focus();return;}
  if(action==='view-example'){
    const example=courseExamples.find(c=>c.id===button.dataset.id);if(!example)return;
    return withBusy(async()=>{
      if(!state.academic_available)await login('pol-demo');
      updateState(await api('/api/snapshots','POST',{variant:'baseline',prefer_no_friday:example.preferNoFriday}));
      selectedExampleId=example.id;selectedPlanId=null;checkResult=null;currentVariant='baseline';
      render();document.getElementById('main-content').focus();
    },'正在載入選課範例…');
  }
  if(action==='guidance-home' || action==='guidance-ai' || action==='guidance-role'){
    if(action==='guidance-role' && !guidanceRoles[button.dataset.role])return;
    if(action==='guidance-home' && window.LearningSupport)LearningSupport.resetView();
    activeTab='chat';sessionStorage.setItem('career-demo-tab','chat');
    guidanceMode=action==='guidance-ai'?'ai':action==='guidance-role'?button.dataset.role:'choose';
    render();document.getElementById(guidanceMode==='ai'?'chat-input':'main-content')?.focus();return;
  }
  if(action==='guidance-copy'){
    const field=document.getElementById('guidance-outline');
    try{await navigator.clipboard.writeText(field.value);toast('已複製提綱，尚未傳送。');}
    catch{field.focus();field.select();toast('請複製已選取的提綱文字。');}
    return;
  }
  if (action === 'tab') { activeTab=button.dataset.tab; sessionStorage.setItem('career-demo-tab',activeTab); render(); return; }
  if (action === 'filter') { activityFilter=button.dataset.filter; render(); return; }
  if (action === 'academic-demo') return withBusy(()=>login(bootstrap.profiles.find(p=>p.id==='pol-demo')?.id || bootstrap.profiles.find(p=>String(p.department).includes('政治'))?.id),'正在載入獨立的學分情境…');
  if (action === 'feedback' || action === 'reflection') {
    const text = action === 'reflection' ? document.getElementById(`reflection-${button.dataset.id}`)?.value.trim() : undefined;
    if (action === 'reflection' && !text) return toast('可以先寫下一句體驗，或留待之後再回顧。');
    return withBusy(async()=>{
      const data = await api('/api/activity-feedback','POST',{activity_id:button.dataset.id,action:action==='reflection'?'reflection':button.dataset.feedback,...(text?{text}:{})});
      if (data.profile || data.state) updateState(data); else await refreshState();
      render();
      toast(action==='reflection'?'已儲存這次體驗與下一步。':button.dataset.feedback==='saved'?'已更新收藏狀態。':button.dataset.feedback==='dismissed'?(feedbackFor(button.dataset.id).some(item=>item.action==='dismissed')?'本次已略過，不列入探索摘要；不會排除整個興趣方向。':'已取消這次略過，可再次列入符合條件的摘要。'):'已更新本人回填的參與狀態。');
    });
  }
  if (action === 'digest') {
    const clock = document.getElementById('demo-clock')?.value;
    currentClock = clock;
    return withBusy(async()=>{ digestResult=await api('/api/digests/preview','POST',{now:fullClock(clock)}); render(); },'正在預覽摘要條件…');
  }
  if (action === 'recalculate') return recalculate();
  if (action === 'select-plan') { selectedPlanId=button.dataset.id; checkResult=null; render(); return; }
  if (action === 'check-plan') {
    const offeringIds = Array.from(document.querySelectorAll('input[name="offering"]:checked')).map(input=>input.value);
    return withBusy(async()=>{ checkResult=await api('/api/plans/check','POST',{offering_ids:offeringIds}); document.getElementById('manual-check-result').innerHTML=checkResultMarkup(); });
  }
  if (action === 'confirm-plan') return withBusy(async()=>{
    const result = await api(`/api/plans/${encodeURIComponent(selectedPlanId)}/confirm`,'POST',{input_snapshot_id:state.input_snapshot_id});
    await refreshState();
    if (!state.confirmation && result.confirmation) state.confirmation=result.confirmation;
    render(); toast('已確認此方案，可匯出清單。');
  },'正在檢查課表…');
  if (action === 'export' || action === 'export-failure') return exportPlan(action==='export-failure');
  if (action === 'download') return withBusy(async()=>{ await downloadExport(button.dataset.id,button.dataset.name); toast('已觸發既有清單下載。'); });
  if (action === 'ask') return sendChat(button.dataset.question);
});

app.addEventListener('toggle',event=>{if(event.target.classList?.contains('explore-settings'))exploreSettingsOpen=event.target.open;},true);

app.addEventListener('change',event=>{
  if (event.target.id === 'profile-switch') withBusy(()=>login(event.target.value),'正在切換體驗角色…');
});

app.addEventListener('submit',async event=>{
  event.preventDefault();
  if(window.LearningSupport && LearningSupport.submit(event.target,{profile:state.profile,render,toast}))return;
  if(event.target.id==='guidance-prep-form'){
    const role=guidanceRoles[guidanceMode];if(!role)return;
    const form=event.target,topic=form.elements.topic.value.trim(),question=form.elements.question.value.trim();
    if(!topic || !question){toast('先寫下探索方向與想問的事。');return;}
    const draft={topic:topic.slice(0,120),question:question.slice(0,1200)};
    draft.outline=buildGuidanceOutline(role,draft.topic,draft.question);
    try{sessionStorage.setItem(guidanceDraftKey(guidanceMode),JSON.stringify(draft));}
    catch{toast('瀏覽器無法保存草稿，請確認儲存設定後再試。',true);return;}
    render();document.getElementById('guidance-outline')?.focus();toast('已整理提綱，尚未傳送。');return;
  }
  if (event.target.id === 'chat-form') return sendChat(document.getElementById('chat-input').value);
  if (event.target.id === 'preferences-form') {
    const form = event.target;
    const notification = state.preferences?.notification || {};
    const values = {
      interests:Array.from(form.querySelectorAll('input[name="interests"]:checked')).map(input=>input.value),
      formats:Array.from(form.querySelectorAll('input[name="formats"]:checked')).map(input=>input.value),
      budget:Number(form.elements.budget.value),
      notification:{...notification,enabled:form.elements.enabled.checked,max_items:3,weekly_limit:1,quiet_start:form.elements.quiet_start.value,quiet_end:form.elements.quiet_end.value}
    };
    return withBusy(async()=>{ updateState(await api('/api/preferences','PUT',values)); digestResult=null; selectedPlanId=null; render(); toast('已儲存偏好，推薦也更新了。'); });
  }
});

app.addEventListener('keydown',event=>{
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendChat(event.target.value); }
});
app.addEventListener('input',event=>{
  if(event.target.id==='chat-input')aiDraft=event.target.value;
  if(window.LearningSupport){try{LearningSupport.capture(event.target.closest('form'));}catch{}}
  if(['guidance-topic','guidance-question'].includes(event.target.id) && guidanceRoles[guidanceMode]){
    const draft={topic:document.getElementById('guidance-topic').value.slice(0,120),question:document.getElementById('guidance-question').value.slice(0,1200)};
    try{sessionStorage.setItem(guidanceDraftKey(guidanceMode),JSON.stringify(draft));}catch{}
  }
});

async function init() {
  try {
    bootstrap = await api('/api/bootstrap');
    currentClock = localClock(bootstrap.demo_clock);
    if (token) {
      try { await refreshState(); render(); return; } catch { token=''; sessionStorage.removeItem('career-demo-token'); }
    }
    const preferred = sessionStorage.getItem('career-demo-profile');
    const profileId = bootstrap.profiles.find(profile=>profile.id===preferred)?.id || bootstrap.profiles.find(profile=>profile.id==='phi-demo')?.id || bootstrap.profiles[0]?.id;
    await login(profileId);
  } catch (error) {
    app.innerHTML=`<main class="boot-screen"><img class="boot-logo" src="/scu-course-compass/brand-logo.png" alt="職涯導航標誌"><h1>探索空間暫時無法載入</h1><p>${esc(error.message)}</p><button class="btn primary" id="retry-init">重新載入</button></main>`;
    document.getElementById('retry-init').addEventListener('click',()=>location.reload());
  }
}
init();
