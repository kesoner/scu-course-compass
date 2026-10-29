'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const onExplorer = document.body.dataset.page === 'course-explorer';
  const publicMode = onExplorer && params.get('mode') !== 'planner' && !params.has('plan_id');
  window.publicCourseCatalogMode = publicMode;
  if (!onExplorer) return;
  document.body.dataset.catalogMode = publicMode ? 'public' : 'planner';
  document.getElementById(publicMode ? 'public-catalog-link' : 'planner-catalog-link')?.setAttribute('aria-current', 'page');
  if (!publicMode) return;

  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = n => ['', '一', '二', '三', '四', '五', '六', '日'][Number(n)] || '待確認';
  const number = value => value === null || value === undefined ? '未提供' : escape(value);
  const allowedFilters = ['q', 'class_group', 'teacher', 'weekday', 'session', 'term_id'];
  let metadata = null;
  let filters = Object.fromEntries(allowedFilters.filter(k => params.has(k)).map(k => [k, params.get(k)]));
  let requestVersion = 0;
  let resultController = null;
  let detailController = null;
  let detailVersion = 0;
  let lastDetailButton = null;
  let planning = params.get('planning') === '1';
  let planningWorkspace = null, planningBusy = false, currentDetailItem = null;
  let visibleItems = new Map();
  const fitFilterNames = ['window_weekday','start_minute','end_minute','campus','fit'];
  let fitFilters = Object.fromEntries(fitFilterNames.filter(k=>params.has(k)).map(k=>[k,params.get(k)]));
  let comparisons = new Map();
  const planningStudent = ['S01','S02','S03'].includes(sessionStorage.getItem('be02-student')) ? sessionStorage.getItem('be02-student') : 'S01';

  async function privateApi(path, method='GET', body, revision, signal) {
    const headers = {Authorization: 'Bearer MOCK-TOKEN-'+planningStudent, Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (revision !== undefined) headers['If-Match'] = '"'+revision+'"';
    if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
    const response = await fetch('/api/v1'+path, {method, headers, signal, body:body === undefined ? undefined : JSON.stringify(body)});
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error?.message || '無法儲存課程，請稍後再試。'); error.status=response.status; error.code=payload.error?.code; throw error; }
    return payload.data;
  }

  function planningNotice(text, error=false) {
    byId('message').innerHTML = `<p class="notice ${error?'error':'success'}">${escape(text)}</p>`;
  }

  function planningAction(item) {
    if (!planningWorkspace) return '';
    const saved = planningWorkspace.public_course_selections.items.some(s => {
      const old=s.detail.item;
      return old.offering_id===item.offering_id || (item.selection_number && old.term_id===item.term_id && old.course_code===item.course_code && old.selection_number===item.selection_number);
    });
    return `<button class="button ghost mini" data-public-action="save-course" data-offering="${escape(item.offering_id)}" ${saved || planningBusy ? 'disabled' : ''}>${saved?'✓ 已存入待確認清單':'存入待確認清單'}</button>`;
  }

  function renderPlanning() {
    if (!planningWorkspace) {
      byId('public-planning').innerHTML = `<div class="public-planning-bar"><div><strong>把想修的課留到自己的課表</strong><p class="muted">公開課程可儲存到選課規劃；修課資格、時間與學分仍待確認。</p></div><button class="button ghost" data-public-action="connect-plan">連結我的課表</button></div>`;
      return;
    }
    const plan = planningWorkspace.plan;
    const count = planningWorkspace.public_course_selections.summary.count;
    byId('public-planning').innerHTML = `<div class="public-planning-bar"><div><strong>課程將存入這份課表</strong><label class="field">我的課表<select id="public-plan-select">${planningWorkspace.plans.map((p,i)=>option(p.plan_id,'課表 '+(i+1)+(p.plan_id===plan.plan_id?'（目前使用）':''),plan.plan_id)).join('')}</select></label><p class="muted">已保存 ${count} 個待確認課程。示範學籍尚未連接正式校務資料，公開課程暫不計入畢業學分。</p></div><a class="button" href="/scu-course-compass/four-stage/">返回安排課表 →</a></div>`;
    byId('public-plan-select').addEventListener('change', async event => {
      if (planningBusy) return;
      try { await connectPlan(event.target.value); await search(); } catch(error) { planningNotice(error.message,true); }
    });
    const windowOn = ['window_weekday','start_minute','end_minute'].every(k=>fitFilters[k]!==undefined);
    const clock = value => {const n=Number(value);return Number.isInteger(n)&&n>=0&&n<1440?String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'):'';};
    const summary = [windowOn ? '週'+day(fitFilters.window_weekday)+' '+clock(fitFilters.start_minute)+'–'+clock(fitFilters.end_minute) : '依已儲存的時間安排', {CITY:'城中',SHUANGXI:'雙溪'}[fitFilters.campus] || '不限校區'].join(' · ');
    byId('public-planning').insertAdjacentHTML('beforeend',`<details class="public-fit-controls" ${windowOn?'open':''}><summary>和我的時間安排比對</summary><p class="muted">會比對已儲存的時間標記、已排課程與已試排的公開課程。校區偏好會提醒；指定校區則用於篩選。資料不足的課程會保留待確認。</p><form id="public-fit-form"><label class="fit-window-toggle"><input type="checkbox" name="use_window" ${windowOn?'checked':''}>找一段空堂能放入的課</label><fieldset id="fit-window-fields" ${windowOn?'':'disabled'}><legend>想找的空堂</legend><label class="field">星期<select name="window_weekday">${[1,2,3,4,5,6,7].map(n=>option(n,'星期'+day(n),fitFilters.window_weekday || 1)).join('')}</select></label><label class="field">開始時間<input type="time" name="start" value="${escape(clock(fitFilters.start_minute ?? 540))}" required></label><label class="field">結束時間<input type="time" name="end" value="${escape(clock(fitFilters.end_minute ?? 720))}" required></label></fieldset><div class="form-row"><label class="field">指定上課校區<select name="campus">${option('','不限校區',fitFilters.campus)}${option('CITY','城中',fitFilters.campus)}${option('SHUANGXI','雙溪',fitFilters.campus)}</select></label><label class="field">時間比對結果<select name="fit">${[['all','顯示全部'],['no_conflict','排除已知不合適的課'],['pass','只看時間條件已符合'],['needs_review','只看待確認'],['fail','只看需調整']].map(([v,label])=>option(v,label,fitFilters.fit || 'all')).join('')}</select></label></div><p class="muted">通過時間比對不代表能正式修課或取得認列學分。交通緩衝使用目前示範規劃設定。</p><button class="button ghost" type="submit">套用時間條件</button></form></details>`);
    const form=byId('public-fit-form');
    byId('public-planning').querySelector('.public-fit-controls summary').insertAdjacentHTML('beforeend',`<span class="public-fit-summary">${escape(summary)}</span>`);
    form.elements.use_window.addEventListener('change',()=>{byId('fit-window-fields').disabled=!form.elements.use_window.checked;});
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const nextFilters={campus:form.elements.campus.value,fit:form.elements.fit.value};
      if(form.elements.use_window.checked) {
        const minutes=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
        const start=minutes(form.elements.start.value),end=minutes(form.elements.end.value);
        if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end){planningNotice('空堂結束時間需要晚於開始時間。',true);return;}
        Object.assign(nextFilters,{window_weekday:form.elements.window_weekday.value,start_minute:String(start),end_minute:String(end)});
      }
      fitFilters=nextFilters;
      setLocation();search();
    });
  }

  async function connectPlan(planId) {
    const target = planId || new URLSearchParams(location.search).get('target_plan') || sessionStorage.getItem('be02-plan-'+planningStudent);
    planningWorkspace = await privateApi('/me/workspace'+(target?'?plan_id='+encodeURIComponent(target):''));
    planning = true;
    sessionStorage.setItem('be02-student',planningStudent);
    sessionStorage.setItem('be02-plan-'+planningStudent,planningWorkspace.plan.plan_id);
    sessionStorage.setItem('be02-step','3');
    renderPlanning();
    setLocation();
  }

  async function savePublicCourse(offeringId) {
    if (!planningWorkspace || planningBusy) return;
    const item = (byId('detail').open && currentDetailItem?.offering_id===offeringId ? currentDetailItem : null) || visibleItems.get(offeringId);
    if (!item) { planningNotice('課程資料已更新，請重新查詢。',true); return; }
    planningBusy = true;
    document.querySelectorAll('[data-public-action="save-course"]').forEach(b=>b.disabled=true);
    if (byId('public-plan-select')) byId('public-plan-select').disabled=true;
    const plan = planningWorkspace.plan;
    try {
      const result = await privateApi('/plans/'+encodeURIComponent(plan.plan_id)+'/public-course-selections','PATCH',{
        action:'add',offering_id:item.offering_id,revision_id:item.revision_id,syllabus_revision_id:item.syllabus_revision_id,reference_version:item.reference_context?.version || null
      },plan.revision);
      planningWorkspace.public_course_selections=result;
      planningWorkspace.plan.revision=result.plan_revision;
      planningNotice('已存入課表的待確認清單，並保留這次課綱與來源。可返回「安排課表」查看。');
    } catch(error) {
      if(error.status===409) {
        try { await connectPlan(plan.plan_id); } catch {}
      }
      planningNotice(error.message,true);
    } finally {
      planningBusy=false;
      renderPlanning();
      await search();
      const detailPlanning = byId('public-detail-planning');
      if(currentDetailItem && byId('detail').open && detailPlanning) detailPlanning.innerHTML=planningAction(currentDetailItem);
    }
  }

  function external(url, label) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`;
    } catch { return ''; }
  }

  async function api(path, signal) {
    const response = await fetch('/api/v1/public-courses' + path, {signal, headers: {'Accept': 'application/json'}});
    let payload;
    try { payload = await response.json(); } catch { throw new Error('課程服務暫時無法回應，請稍後再試。'); }
    if (!response.ok) throw new Error(payload.error?.message || '目前無法讀取公開課程資料，請稍後再試。');
    return payload.data;
  }

  function option(value, text, selected) {
    return `<option value="${escape(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${escape(text)}</option>`;
  }

  function selectField(name, label, values, empty) {
    return `<label class="field">${label}<select name="${name}">${option('', empty, filters[name])}${values.map(v => option(v.value, v.label, filters[name])).join('')}</select></label>`;
  }

  function renderShell() {
    document.title = '東吳公開課程查詢｜職涯導航';
    const intro = document.querySelector('.intro');
    intro.innerHTML = '<div><h1>找課程，先看清楚內容。</h1><p>依課名、班級、教師或上課節次，查閱課綱與公開來源。</p></div>';
    document.querySelector('footer').textContent = '此頁提供東吳大學公開課程樣本查詢。課表項目可能尚未提供選課編號；實際開課、修課資格與選課結果請向學校確認。';
    byId('main').innerHTML = `<div id="public-planning"></div><div class="public-catalog-intro"><span class="public-sample-label">東吳公開課程樣本</span><p class="muted" id="public-scope">正在讀取樣本範圍…</p></div><div id="public-catalog-content"><div class="panel" role="status">正在載入公開課程…</div></div>`;
    renderPlanning();
  }

  function renderForm() {
    const termOptions = (metadata.terms || []).map(t => ({value: t.term_id, label: t.label}));
    const groups = (metadata.class_groups || []).map(g => ({value: g.class_group_id, label: g.name}));
    const sessions = (metadata.sessions || []).map(s => ({value: s.value, label: s.label}));
    const weekdays = metadata.weekdays?.length ? metadata.weekdays : [1,2,3,4,5,6,7].map(v => ({value:v,label:'星期'+day(v)}));
    const teacherDisplay = (metadata.teachers || []).find(t => t.instructor_id === filters.teacher)?.name || filters.teacher || '';
    const coverage = metadata.statistics ? `${metadata.statistics.items_with_syllabus} 個課表項目附有課綱。` : '';
    byId('public-scope').textContent = `最近擷取 ${metadata.observed_at || '未提供'}${metadata.observed_timezone ? '（'+metadata.observed_timezone+'）' : ''}。${coverage}${metadata.notice || '包含尚未提供選課編號的課表安排。'}`;
    byId('public-catalog-content').innerHTML = `<div class="public-catalog-layout"><form id="public-catalog-form" class="panel public-catalog-filters"><h2>查詢條件</h2><label class="field">課名或科目代碼<input name="q" type="search" maxlength="160" placeholder="例如：邏輯、BPH13101" value="${escape(filters.q || '')}"></label>${selectField('term_id','學年學期',termOptions,'目前樣本學期')}${selectField('class_group','開課班級',groups,'所有班級')}<label class="field">授課教師<input name="teacher" list="public-teachers" maxlength="80" placeholder="輸入姓名或選擇教師" value="${escape(teacherDisplay)}"><datalist id="public-teachers">${(metadata.teachers || []).map(t => `<option value="${escape(t.name)}"></option>`).join('')}</datalist></label>${selectField('weekday','上課星期',weekdays,'不限星期')}${selectField('session','上課節次',sessions,'不限節次')}<div class="actions"><button class="button" type="submit">查詢課程</button><button class="button ghost" type="button" data-public-action="reset">清除條件</button></div></form><section aria-label="公開課程查詢結果"><div class="public-results-heading"><h2 id="public-result-heading">公開課程</h2><span class="muted" id="public-result-count"></span></div><p id="public-query-status" class="public-catalog-status" role="status" aria-live="polite"></p><div id="public-results" class="public-course-list"></div></section></div>`;
    byId('public-catalog-form').addEventListener('submit', event => {
      event.preventDefault();
      filters = Object.fromEntries([...new FormData(event.currentTarget)].map(([k,v]) => [k, String(v).trim()]).filter(([,v]) => v));
      setLocation();
      search();
    });
  }

  function setLocation() {
    const query = new URLSearchParams();
    for (const name of allowedFilters) if (filters[name]) query.set(name, filters[name]);
    if (planning) { query.set('planning','1'); if(planningWorkspace) query.set('target_plan',planningWorkspace.plan.plan_id); }
    if(planning)for(const name of fitFilterNames)if(fitFilters[name]!==undefined && fitFilters[name]!=='')query.set(name,fitFilters[name]);
    history.pushState(null, '', '/scu-course-compass/course-explorer/' + (query.size ? '?' + query : ''));
  }

  function meetingText(meeting) {
    const weekday = meeting.weekday_raw || day(meeting.weekday);
    const sessions = meeting.session_raw || (meeting.session_codes || []).join('');
    const week = meeting.week_raw ? ` · ${escape(meeting.week_raw)}週` : '';
    const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const times=(meeting.sessions || []).filter(s=>s.resolution_state==='resolved' && s.start_minute!=null && s.end_minute!=null).map(s=>clock(s.start_minute)+'–'+clock(s.end_minute)).join('、');
    const place=meeting.campus_id ? ({CITY:'城中',SHUANGXI:'雙溪'}[meeting.campus_id]) : meeting.room_kind==='virtual'?'虛擬教室，實際地點待確認':'校區待確認';
    return `星期${escape(weekday)} ${escape(sessions || '節次待確認')}${week}${times?' · '+escape(times):''} · ${escape(place)} · ${escape(meeting.room || '教室未提供')}`;
  }

  function card(item) {
    return `<article class="public-course-card"><div class="public-course-heading"><div><span class="public-course-code">${escape(item.course_code || '科目代碼未提供')}</span><h3>${escape(item.title)}</h3></div><span class="public-course-credit">${number(item.credits)}${item.credits == null ? '' : ' 學分'}</span></div><p class="public-course-meta"><span>班級：${(item.classes || []).map(g => escape(g.name)).join('、') || '未提供'}</span><span>教師：${(item.teachers || []).map(t => escape(t.name)).join('、') || '未提供'}</span></p><div class="public-course-meetings">${item.meetings?.length ? item.meetings.map(m => `<div>${meetingText(m)}</div>`).join('') : '上課星期、節次與教室尚未提供'}</div><p class="public-course-note">選課編號：${escape(item.selection_number || '尚未提供')} · 人數上限：${number(item.capacity_limit)}${item.capacity_limit == null ? '' : ' 人'}</p><div class="actions"><button class="button mini" data-public-action="detail" data-offering="${escape(item.offering_id)}">${item.has_syllabus ? '查看課綱' : '查看課程'}</button><button class="button ghost mini" data-public-action="sources" data-offering="${escape(item.offering_id)}">資料來源</button><span class="muted">${escape(item.source?.title || '公開課程資料')}</span></div></article>`;
  }

  function comparisonMarkup(item) {
    const entry=comparisons.get(item.offering_id);
    if(!entry || entry.revision_id!==item.revision_id)return '';
    const c=entry.comparison,labels={pass:'時間條件符合',fail:'時間安排需調整',needs_review:'時間安排待確認'};
    const checks=[...c.schedule.checks,...c.target.checks];
    return `<section class="public-fit-result"><span class="badge ${escape(c.fit.status)}">${labels[c.fit.status]}</span><details><summary>查看比對原因</summary><ul>${checks.map(check=>`<li><span class="badge ${escape(check.status)}">${{pass:'符合',fail:'需調整',needs_review:'待確認'}[check.status]}</span> ${escape(check.message)}</li>`).join('')}</ul>${c.soft_mismatches.length?`<p class="muted">${c.soft_mismatches.map(m=>escape(m.message)).join(' ')}</p>`:''}</details></section>`;
  }

  async function search() {
    const version = ++requestVersion;
    resultController?.abort();
    resultController = new AbortController();
    byId('public-query-status').textContent = '正在查詢課程…';
    byId('public-results').setAttribute('aria-busy','true');
    byId('public-results').innerHTML = '';
    byId('public-result-count').textContent = '';
    const query = new URLSearchParams();
    for (const name of allowedFilters) if (filters[name]) query.set(name, filters[name]);
    try {
      let data;
      if(planningWorkspace) {
        query.set('plan_revision',planningWorkspace.plan.revision);
        for(const name of fitFilterNames)if(fitFilters[name]!==undefined && fitFilters[name]!=='')query.set(name,fitFilters[name]);
        data=await privateApi('/plans/'+encodeURIComponent(planningWorkspace.plan.plan_id)+'/public-course-options?'+query,'GET',undefined,undefined,resultController.signal);
        data.items=data.options.map(o=>o.item);
      } else data = await api(query.size ? '?' + query : '', resultController.signal);
      if (version !== requestVersion) return;
      comparisons=new Map((data.options || []).map(o=>[o.item.offering_id,{revision_id:o.item.revision_id,comparison:o.comparison}]));
      visibleItems = new Map((data.items || []).map(item=>[item.offering_id,item]));
      byId('public-result-heading').textContent = `找到 ${data.matched_items} 個課表項目`;
      byId('public-result-count').textContent = `樣本共 ${data.total_items} 項`;
      byId('public-query-status').textContent = data.counts ? `已比對這份課表的時間安排：${data.counts.pass} 項符合、${data.counts.needs_review} 項待確認、${data.counts.fail} 項需調整（時間結果篩選前）。鐘點與校區有依據時才換算，資料不足仍保留待確認。` : '已套用查詢條件。鐘點及校區依保存的校方公告對照，未能確認的資料保留待確認。';
      byId('public-results').innerHTML = data.items?.length ? data.items.map(card).join('') : data.counts?.needs_review && fitFilters.fit==='pass' ? '<div class="panel public-result-empty"><h3>目前還沒有時間資料完整的課程</h3><p>這次找到的課程仍有鐘點、校區或週次需要確認，可以先查看待確認項目。</p><button class="button ghost" data-public-action="show-review">查看待確認課程</button></div>' : '<div class="panel public-result-empty"><h3>目前沒有符合條件的項目</h3><p>可以放寬課名、班級、教師、空堂或校區條件，或查看全部已蒐集的樣本。</p><button class="button ghost" data-public-action="reset">清除條件，查看全部</button></div>';
      for(const [id,item] of visibleItems) {
        const button = [...byId('public-results').querySelectorAll('[data-public-action="detail"]')].find(b=>b.dataset.offering===id);
        button?.parentElement.insertAdjacentHTML('beforeend',planningAction(item));
        button?.closest('article').insertAdjacentHTML('beforeend',comparisonMarkup(item));
      }
    } catch (error) {
      if (error.name === 'AbortError' || version !== requestVersion) return;
      byId('public-result-heading').textContent = '課程暫時無法載入';
      byId('public-query-status').textContent = error.code==='STALE_INPUTS' ? '修課資料或課程規定已有更新，請先返回工作台更新這份課表。' : error.status===409 ? '這份課表已有更新，請按下方按鈕重新讀取課表後再比對。' : error.message || '無法讀取課程資料，請重試。';
      byId('public-results').innerHTML = error.code==='STALE_INPUTS' ? '<a class="button ghost" href="/scu-course-compass/four-stage/">返回工作台更新資料</a>' : `<button class="button ghost public-catalog-retry" data-public-action="${error.status===409?'refresh-plan':'retry'}">${error.status===409?'重新讀取課表並比對':'重新查詢'}</button>`;
    } finally {
      if (version === requestVersion) byId('public-results').removeAttribute('aria-busy');
    }
  }

  function sourceMarkup(source) {
    const queryLabels = {academic_year_roc:'學年度',semester:'學期',program:'部別',node:'系所或類別',class_name:'班級',keyword:'關鍵字',document_key:'課綱文件',source_course_code:'科目代碼',table_filter:'結果表篩選',period:'學期代碼',clsid1:'部別',clsid02:'系所或類別',clsid34:'查詢班級',syear:'學年度',smester:'學期'};
    const query = Object.entries(source.query_parameters || {}).map(([k,v]) => `${queryLabels[k] || k}：${typeof v === 'object' ? JSON.stringify(v) : v}`).join('；');
    return `<article class="public-source-entry"><h4>${escape(source.title || source.source_id)}</h4><dl><dt>來源用途</dt><dd>${escape(source.role || '公開資料')}</dd><dt>觀察日期</dt><dd>${escape(source.observed_at || '未提供')}</dd>${query ? `<dt>查詢條件</dt><dd>${escape(query)}</dd>` : ''}</dl>${external(source.url,'開啟校方來源')}</article>`;
  }

  function sourcesMarkup(data) {
    const captures = data.observations || [];
    const observations = captures.length ? `<section class="public-detail-section"><h3>擷取紀錄（${captures.length} 次）</h3><p class="muted">擷取紀錄與內容版本分開保存；相同內容可沿用版本，課表更新時另保留課綱關聯。快照指紋可核對保存的證據。</p><div class="table-wrap"><table class="public-detail-table"><thead><tr><th>擷取時間</th><th>來源</th><th>快照 SHA256</th></tr></thead><tbody>${captures.map(c => `<tr><td>${escape(c.observed_at)}<br>${escape(c.timezone || '')}</td><td>${escape(c.title)}<br>${external(c.url,'校方來源')}</td><td><code title="${escape(c.content_sha256 || '')}">${escape(c.content_sha256 ? c.content_sha256.slice(0,16)+'…' : '原始證據另存')}</code></td></tr>`).join('')}</tbody></table></div></section>` : '';
    return sourceVersionsMarkup(data) + observations;
  }

  function sourceVersionsMarkup(data) {
    return `<section class="public-detail-section"><h3>資料來源與觀察日期</h3><p class="muted">來源頁面可能持續更新。以下保留本次樣本的觀察日期與查詢條件，方便回到校方確認。</p>${(data.sources || []).map(sourceMarkup).join('') || '<p>來源資訊尚未提供。</p>'}</section>${data.source_history?.length ? `<section class="public-detail-section"><h3>課表來源版本</h3><div class="table-wrap"><table class="public-detail-table"><thead><tr><th>來源</th><th>課名</th><th>學分</th><th>採用狀態</th></tr></thead><tbody>${data.source_history.map(s => `<tr><td>${escape(s.source_id)}<br>${escape(s.observed_at || '')}</td><td>${escape(s.title)}</td><td>${number(s.credits)}</td><td>${s.is_current ? '目前採用' : '保留的來源版本'}</td></tr>`).join('')}</tbody></table></div><p class="muted">不同查詢入口的版本會分開保存，不能直接相加當成不同課程。</p></section>` : ''}${data.syllabus_versions?.length ? `<section class="public-detail-section"><h3>課綱來源版本</h3><ul class="plain-list">${data.syllabus_versions.map(s => `<li>${escape(s.source_id)} · ${s.is_current ? '目前採用' : '其他來源'} · ${s.completeness === 'basic_only' ? '僅基本資訊' : '完整課綱'}<br><span class="muted">前次異動：${escape(s.content_edited_at || '未提供')}（${s.precision === 'second' ? '秒鐘精度' : s.precision === 'minute' ? '分鐘精度' : '精度未提供'}）</span></li>`).join('')}</ul></section>` : ''}`;
  }

  function syllabusMarkup(syllabus, officialUrl) {
    if (!syllabus) return `<section class="public-detail-section"><h3>課綱尚未提供</h3><p>這個項目的完整課綱尚未匯入目前樣本。</p>${external(officialUrl,'查閱校方授課計畫') || '<p>你可以到「資料來源」開啟校方頁面確認。</p>'}</section>`;
    const sectionLabels = {objectives:'教學目標',description:'課程內容',other_requirements:'課程其他要求',other:'其他課程資料'};
    const sections = (syllabus.sections || []).filter(s => !(s.kind === 'other' && String(s.content || '').trim().startsWith('{')));
    return `<section class="public-detail-section"><h3>授課計畫</h3><p class="muted">前次異動：${escape(syllabus.edited_at || '未提供')} · ${syllabus.edited_precision === 'second' ? '保留秒鐘精度' : syllabus.edited_precision === 'minute' ? '保留分鐘精度' : '依來源顯示精度'}。${syllabus.source ? external(syllabus.source.url,'開啟校方課綱') : ''}</p>${sections.map(s => `<h4>${escape(sectionLabels[s.kind] || s.heading || '課程內容')}${s.language === 'en' ? '（英文）' : ''}</h4><p class="public-detail-paragraph">${escape(s.content || '未提供內容')}</p>`).join('')}</section><section class="public-detail-section"><h3>分週教學進度</h3>${syllabus.weeks?.length ? `<div class="table-wrap"><table class="public-detail-table"><thead><tr><th>週次</th><th>來源日期</th><th>教學內容</th><th>備註</th></tr></thead><tbody>${syllabus.weeks.map(w => `<tr><td>${number(w.week_number)}</td><td>${escape(w.date_raw || '未提供')}</td><td>${escape(w.content || '未提供')}</td><td>${escape(w.note || '—')}</td></tr>`).join('')}</tbody></table></div><p class="muted">月日依課綱原文保存，尚未補算年份或實際上課日曆。</p>` : '<p>分週進度尚未提供。</p>'}</section><section class="public-detail-section"><h3>評分方式</h3>${syllabus.assessments?.length ? `<ul class="plain-list">${syllabus.assessments.map(a => `<li><strong>${escape(a.name)}</strong>：${a.weight_percent == null ? '比例未提供' : number(a.weight_percent)+'%'}${a.times == null ? '' : ` · ${number(a.times)} 次`}${a.description ? `<p>${escape(a.description)}</p>` : ''}</li>`).join('')}</ul>` : '<p>評分方式尚未提供。</p>'}</section><section class="public-detail-section"><h3>教材與參考資源</h3>${syllabus.resources?.length ? `<ul class="plain-list">${syllabus.resources.map(r => `<li>${escape(r.citation || ({required_text:'指定教材',reference:'參考資源',learning_platform:'學習平台'}[r.kind] || '課程資源'))}${r.url ? '<br>'+external(r.url,'開啟資源') : ''}</li>`).join('')}</ul>` : '<p>教材與參考資源尚未提供。</p>'}</section><section class="public-detail-section"><h3>課程主題與能力對應</h3><div class="public-topic-tags">${(syllabus.tags || []).map(t => `<span>${escape(t.label_zh)}</span>`).join('')}</div>${syllabus.abilities?.length ? `<ul class="plain-list">${syllabus.abilities.map(a => `<li>${escape(a.code)} · ${escape(a.label_zh)} · ${a.alignment_state === 'marked' ? '課綱有對應標記' : '課綱未標記'}${a.evaluation_methods ? `<p class="muted">${escape(Array.isArray(a.evaluation_methods) ? a.evaluation_methods.join('、') : a.evaluation_methods)}</p>` : ''}</li>`).join('')}</ul>` : '<p>能力對應尚未提供。</p>'}<p class="muted">這些是課綱標示的關聯，不代表修課者已取得能力或資格。</p></section><section class="public-detail-section"><h3>建議先修</h3>${syllabus.prerequisites?.some(p => p.text) ? syllabus.prerequisites.map(p => `<p class="public-detail-paragraph">${escape(p.text || '未提供')}</p>`).join('') : '<p>課綱未填寫建議先修；正式擋修規則仍需向學校確認。</p>'}</section>${syllabus.contacts?.length ? `<section class="public-detail-section"><h3>課業輔導與公開聯絡方式</h3>${syllabus.contacts.map(c => `<h4>${escape(c.name || '授課教師')}</h4><p class="public-detail-paragraph">${escape(c.office_hours || '輔導時間未提供')}</p><p>研究室：${escape(c.office || '未提供')}</p><p class="public-detail-paragraph">${escape(c.public_contact || '聯絡資訊未提供')}</p>`).join('')}</section>` : ''}`;
  }

  async function detail(offeringId, showSources, trigger) {
    const version = ++detailVersion;
    detailController?.abort();
    detailController = new AbortController();
    if (!trigger?.closest('dialog')) lastDetailButton = trigger;
    byId('detail-title').textContent = '正在讀取課程…';
    byId('detail-body').innerHTML = '<p role="status">正在載入課程與來源資料…</p>';
    if (!byId('detail').open) byId('detail').showModal();
    try {
      const data = await api('/'+encodeURIComponent(offeringId), detailController.signal);
      if (version !== detailVersion || !byId('detail').open) return;
      const item = data.item;
      currentDetailItem = item;
      byId('detail-title').textContent = item.title;
      byId('detail-body').innerHTML = `<div class="public-detail-summary"><span>${escape(item.course_code || '科目代碼未提供')}</span><span>${number(item.credits)}${item.credits == null ? '' : ' 學分'}</span><span>${(item.classes || []).map(c => escape(c.name)).join('、')}</span></div><div class="public-detail-tabs" aria-label="課程明細內容"><button class="button ghost mini" data-public-action="detail-tab" data-panel="syllabus" aria-pressed="${!showSources}">課程與課綱</button><button class="button ghost mini" data-public-action="detail-tab" data-panel="sources" aria-pressed="${showSources}">資料來源</button></div><div id="public-syllabus-panel" ${showSources ? 'hidden' : ''}><section class="public-detail-section"><h3>上課資訊</h3><p>授課教師：${(item.teachers || []).map(t => escape(t.name)).join('、') || '未提供'}</p><div>${item.meetings?.map(m => `<p>${meetingText(m)}</p>`).join('') || '<p>星期、節次與教室尚未提供。</p>'}</div><p>選課編號：${escape(item.selection_number || '尚未提供')} · 人數上限：${number(item.capacity_limit)}${item.capacity_limit == null ? '' : ' 人'}</p><p class="muted">節次保留來源原文，鐘點及校區依保存的校方公告對照。虛擬教室不代表實體校區或線上授課，人數上限也不是剩餘名額；個人修課資格仍待核對。</p></section>${syllabusMarkup(data.syllabus, item.official_syllabus_url)}</div><div id="public-sources-panel" ${showSources ? '' : 'hidden'}>${sourcesMarkup(data)}</div>`;
      byId('detail-body').insertAdjacentHTML('afterbegin',`<div id="public-detail-planning">${planningAction(item)}</div>`);
      byId('detail-body').insertAdjacentHTML('afterbegin',comparisonMarkup(item));
      if(item.reference_context?.state==='document_mapped')byId('detail-body').insertAdjacentHTML('afterbegin',`<p class="notice">${escape(item.reference_context.note)} ${external(item.reference_context.source.url,'核對節次與教室公告')}</p>`);
    } catch (error) {
      if (error.name === 'AbortError' || version !== detailVersion) return;
      byId('detail-title').textContent = '課程資料暫時無法載入';
      byId('detail-body').innerHTML = `<div class="public-detail-error"><p>${escape(error.message)}</p><button class="button ghost" data-public-action="detail" data-offering="${escape(offeringId)}">重新載入</button></div>`;
    }
  }

  function reset() {
    filters = {};
    fitFilters = {};
    if(planningWorkspace)renderPlanning();
    setLocation();
    renderForm();
    search();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-public-action]');
    if (!button) return;
    const action = button.dataset.publicAction;
    if (action === 'connect-plan') connectPlan().then(()=>search()).catch(error=>planningNotice(error.message,true));
    if (action === 'save-course') savePublicCourse(button.dataset.offering);
    if (action === 'refresh-plan') connectPlan(planningWorkspace?.plan.plan_id).then(()=>search()).catch(error=>planningNotice(error.message,true));
    if (action === 'show-review') {fitFilters={...fitFilters,fit:'needs_review'};renderPlanning();setLocation();search();}
    if (action === 'reset') reset();
    if (action === 'retry') search();
    if (action === 'detail' || action === 'sources') detail(button.dataset.offering, action === 'sources', button);
    if (action === 'detail-tab') {
      const sources = button.dataset.panel === 'sources';
      byId('public-syllabus-panel').hidden = sources;
      byId('public-sources-panel').hidden = !sources;
      document.querySelectorAll('[data-public-action="detail-tab"]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    }
  });
  byId('close-detail').addEventListener('click', () => byId('detail').close());
  byId('detail').addEventListener('close', () => {
    ++detailVersion;
    detailController?.abort();
    lastDetailButton?.focus();
  });
  window.addEventListener('popstate', () => {
    const route = new URLSearchParams(location.search);
    if (route.get('mode') === 'planner' || route.has('plan_id')) { location.reload(); return; }
    if((route.get('planning')==='1')!==planning || planningWorkspace && route.get('target_plan')!==planningWorkspace.plan.plan_id){location.reload();return;}
    if (byId('detail').open) byId('detail').close();
    filters = Object.fromEntries(allowedFilters.filter(k => route.has(k)).map(k => [k, route.get(k)]));
    fitFilters=Object.fromEntries(fitFilterNames.filter(k=>route.has(k)).map(k=>[k,route.get(k)]));
    if(planningWorkspace)renderPlanning();
    if (metadata) { renderForm(); search(); }
  });

  renderShell();
  if(planning) connectPlan().then(()=>{if(metadata)search();}).catch(error=>planningNotice('無法連結這份課表：'+error.message,true));
  api('/meta').then(data => {
    metadata = data;
    renderForm();
    search();
  }).catch(error => {
    byId('public-scope').textContent = '目前無法讀取公開課程樣本。';
    byId('public-catalog-content').innerHTML = `<section class="panel"><h2>課程資料暫時無法載入</h2><p>${escape(error.message)}</p><button class="button ghost" data-public-action="reload-meta">重試載入</button></section>`;
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-public-action="reload-meta"]')) location.reload();
  });
})();
