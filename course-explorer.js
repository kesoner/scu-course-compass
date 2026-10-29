'use strict';
// Presentation of public teaching information. All eligibility and fit checks come from the API.
const explorerMode = document.body.dataset.page === 'course-explorer';
const courseKinds = {department:'學系課程',general:'通識課程',language:'語言課程',physical:'體育課程',other:'其他課程'};
let explorerData=null, explorerBase=null, explorerContext='', explorerFilters={}, comparedCourses=new Set();
let teachingReturnCourse=null;

function explorerStorageKey() { return `course-explorer:${student}:${ws.plan.plan_id}`; }
function rememberExplorer() {
  sessionStorage.setItem(explorerStorageKey(),JSON.stringify({filters:explorerFilters,compare:[...comparedCourses]}));
}
function explorerQuery(filters={}) {
  const params=new URLSearchParams({plan_id:ws.plan.plan_id,plan_revision:String(ws.plan.revision)});
  for(const key of ['q','kind','unit','department','year_level','class_group','campus','eligibility','schedule','fit','direction_only']) {
    if(filters[key]!==undefined && filters[key]!=='')params.set(key,String(filters[key]));
  }
  if(filters.window_enabled)for(const key of ['weekday','start_minute','end_minute'])params.set(key,String(filters[key]));
  return '/scu-course-compass/course-explorer/?'+params;
}
async function prepareExplorer() {
  const context=`${student}:${ws.plan.plan_id}`;
  if(explorerContext!==context) {
    explorerContext=context;
    let saved={};try { saved=JSON.parse(sessionStorage.getItem(explorerStorageKey()) || '{}'); } catch {}
    explorerFilters=saved.filters && typeof saved.filters==='object'?saved.filters:{};
    comparedCourses=new Set(Array.isArray(saved.compare)?saved.compare.slice(0,3):[]);
    const route=new URLSearchParams(location.search);
    if(route.get('window')==='1')explorerFilters={...explorerFilters,window_enabled:true,weekday:route.get('weekday') || '1',start_minute:route.get('start_minute') || '540',end_minute:route.get('end_minute') || '720'};
  }
  if(explorerMode)history.replaceState(null,'','/scu-course-compass/course-explorer/?'+new URLSearchParams({plan_id:ws.plan.plan_id}));
  explorerBase=null;explorerData=null;
  if(ws.plan.validation_state==='stale')return;
  explorerBase=await api(explorerQuery());
  comparedCourses=new Set([...comparedCourses].filter(id=>explorerBase.items.some(i=>i.offering.offering_id===id)));
  explorerData=Object.keys(explorerFilters).length?await api(explorerQuery(explorerFilters)):explorerBase;
  rememberExplorer();
}
async function ensureExplorerBase() {
  if(!explorerBase || explorerBase.plan_id!==ws.plan.plan_id || explorerBase.plan_revision!==ws.plan.revision)explorerBase=await api(explorerQuery());
  return explorerBase;
}
async function explorerItem(id) {
  const base=await ensureExplorerBase();
  const item=base.items.find(i=>i.offering.offering_id===id);
  if(!item)throw new Error('這門課的資料已更新，請重新查詢。');
  return item;
}
function teacherNames(item) {
  return item.teacher_ids.map(id=>explorerBase?.teachers.find(t=>t.instructor_id===id)?.name).filter(Boolean);
}
function organizationName(item) {
  return explorerBase?.units.find(u=>u.unit_id===item.organization.unit_id)?.name || '開課單位待確認';
}
function yearName(year) { return year===0?'不分年級':year==null?'年級待確認':`${year} 年級`; }
function option(value,label,current) { return `<option value="${esc(value)}" ${String(current ?? '')===String(value)?'selected':''}>${esc(label)}</option>`; }
function selectField(name,label,options,empty='不限',attributes='') {
  return `<label class="field">${label}<select name="${name}" ${attributes}>${option('',empty,explorerFilters[name])}${options.map(([value,text])=>option(value,text,explorerFilters[name])).join('')}</select></label>`;
}
function explorerFilterOptions(filters=explorerFilters) {
  const base=explorerBase || explorerData;
  const units=(base?.units || []).filter(u=>!filters.kind || u.kind===filters.kind);
  const unitIds=new Set(units.map(u=>u.unit_id));
  const departments=(base?.departments || []).filter(d=>unitIds.has(d.unit_id) && (!filters.unit || d.unit_id===filters.unit));
  const deptIds=new Set(departments.map(d=>d.department_id));
  const groups=(base?.class_groups || []).filter(g=>unitIds.has(g.unit_id) && deptIds.has(g.department_id) && (!filters.unit || g.unit_id===filters.unit) && (!filters.department || g.department_id===filters.department));
  const years=[...new Set(groups.map(g=>g.year_level).filter(y=>y!=null))].sort((a,b)=>a-b);
  const classes=groups.filter(g=>filters.year_level==='' || filters.year_level===undefined || String(g.year_level)===String(filters.year_level));
  return {units,departments,years,classes};
}
function readExplorerForm() {
  const form=$('explorer-filters');
  const value=Object.fromEntries(new FormData(form));
  const minutes=text=>{const [h,m]=text.split(':').map(Number);return h*60+m;};
  value.window_enabled=form.elements.window_enabled.checked;
  if(value.window_enabled) {
    value.start_minute=minutes(value.start_time);value.end_minute=minutes(value.end_time);
  }
  delete value.start_time;delete value.end_time;
  return value;
}
function cascadeExplorer(changed) {
  explorerFilters=readExplorerForm();
  const dependents={kind:['unit','department','year_level','class_group'],unit:['department','year_level','class_group'],department:['year_level','class_group'],year_level:['class_group']};
  for(const key of dependents[changed] || [])explorerFilters[key]='';
  const options=explorerFilterOptions();
  for(const [name,values,empty] of [
    ['unit',options.units.map(u=>[u.unit_id,u.name]),'所有開課單位'],
    ['department',options.departments.map(d=>[d.department_id,d.name]),'所有科系／領域'],
    ['year_level',options.years.map(y=>[y,yearName(y)]),'所有年級'],
    ['class_group',[...new Set(options.classes.map(g=>g.class_group))].map(g=>[g,g]),'所有班級']
  ]) {
    const field=$('explorer-filters').elements[name];
    field.innerHTML=option('',empty,explorerFilters[name])+values.map(([id,name])=>option(id,name,explorerFilters[field.name])).join('');
  }
  $('window-fields').hidden=!explorerFilters.window_enabled;
  $('filter-status').textContent='條件已調整，按「查詢課程」套用。';
  rememberExplorer();
}
function fitBadge(status) {return badge(status,{pass:'可排入課表',fail:'目前無法排入',needs_review:'需要再確認'}[status]);}
function addCourseButton(item,mini=false) {
  const label=item.selected?'已在課表':item.fit.status==='fail'?'目前無法加入':item.fit.status==='needs_review'?'先加入待確認':'加入課表';
  return `<button class="button ${mini?'mini':''}" data-action="add" data-id="${esc(item.offering.offering_id)}" data-review="${item.fit.status==='needs_review'?'1':'0'}" ${item.selected || item.fit.status==='fail'?'disabled':''}>${label}</button>`;
}
function feedbackSummary(teacher) {
  const feedback=teacher.teaching_feedback,grades=teacher.grade_distribution;
  return `<div class="teacher-evidence"><div><strong>給分情形</strong>${grades?`<span>平均 ${grades.average==null?'未提供':esc(grades.average)+' 分'}</span><small>${esc(grades.scope)} · ${grades.sample_size} 筆 · ${esc(grades.as_of)} · ${esc(grades.source_label)}</small>`:'<span>尚無歷年成績統計</span>'}</div><div><strong>課程安排回饋</strong>${feedback?`<span>${feedback.arrangement_score==null?'未提供':esc(feedback.arrangement_score)+' / 5'}</span><small>${esc(feedback.scope)} · ${feedback.sample_size} 份 · ${esc(feedback.as_of)} · ${esc(feedback.source_label)}</small>`:'<span>尚無學生回饋資料</span>'}</div><div><strong>學生對評分方式的回饋</strong>${feedback?.grading_score!=null?`<span>${esc(feedback.grading_score)} / 5</span>`:'<span>尚未提供</span>'}</div></div>`;
}
function explorerCourseCard(item) {
  const o=item.offering,c=item.course,teachers=item.teacher_ids.map(id=>explorerBase?.teachers.find(t=>t.instructor_id===id)).filter(Boolean);
  const issues=item.fit.checks.filter(c=>c.status!=='pass');
  return `<article class="discovery-course ${item.selected?'selected':''}"><div class="course-card-top"><span class="muted">${esc(organizationName(item))} · ${esc(item.organization.class_group)}</span>${fitBadge(item.fit.status)}</div><h3>${esc(cleanName(c.name))} <small>${esc(o.section_name)} 班</small></h3><p class="teacher-line">${teachers.length?teachers.map(t=>`<button class="text-button" data-action="teacher-profile" data-id="${esc(t.instructor_id)}" data-offering="${esc(o.offering_id)}">${esc(t.name)}</button>`).join('、'):esc(instructorName(o.instructor))}</p><p class="schedule">${meetings(o)}<br>${showNumber(c.credits)} 學分 · ${yearName(item.organization.year_level)}</p><div class="qualification-row"><span>修課資格 ${badge(item.eligibility.status,{pass:'符合',fail:'尚未符合',needs_review:'待確認'}[item.eligibility.status])}</span><span>時間安排 ${badge(item.schedule.status)}</span></div>${issues.length?`<p class="course-issue">${esc(readable(issues[0].message))}${issues.length>1?`（另有 ${issues.length-1} 項需留意）`:''}</p>`:`<p class="muted">${item.soft_mismatches.length?item.soft_mismatches.map(m=>esc(readable(m.message))).join(' '):'目前沒有發現修課條件或時間衝突。'}</p>`}<div class="actions"><button class="button ghost mini" data-action="course-detail" data-id="${esc(o.offering_id)}">課綱與修課條件</button><button class="button ghost mini" data-action="compare-toggle" data-id="${esc(o.offering_id)}" aria-pressed="${comparedCourses.has(o.offering_id)}">${comparedCourses.has(o.offering_id)?'✓ 已加入比較':'加入比較'}</button>${addCourseButton(item,true)}</div></article>`;
}
function explorerCompareBar() {
  const items=[...comparedCourses].map(id=>explorerBase?.items.find(i=>i.offering.offering_id===id)).filter(Boolean);
  return items.length?`<div class="compare-bar"><div><strong>已選 ${items.length} 門課比較</strong><small>${items.map(i=>esc(cleanName(i.course.name)+' '+i.offering.section_name+'班')).join('、')}</small></div><div class="actions"><button class="button ghost mini" data-action="compare-clear">清空比較</button><button class="button" data-action="compare-open" ${items.length>=2?'':'disabled'}>比較課程${items.length<2?'（再選一門）':''}</button></div></div>`:'';
}
function renderCourseExplorer() {
  if(!explorerData)return `<section class="panel"><h2>課程探索</h2><p class="muted">${ws.plan.validation_state==='stale'?'請先按上方「更新課表資料」，再查詢適合目前修課紀錄的課程。':'正在整理課程與修課條件…'}</p></section>`;
  const f=explorerFilters,options=explorerFilterOptions();
  const filterCount=['q','kind','unit','department','year_level','class_group','campus','eligibility','schedule','fit','direction_only'].filter(key=>f[key]!==undefined && f[key]!=='' && f[key]!=='0').length+(f.window_enabled?1:0);
  return `<div class="explorer-heading"><div><h2 class="visually-hidden">課程探索與比較</h2><p class="muted">按開課單位與班級找課，也可以把幾門課放在一起比較。修課資格與時間會另外核對。</p></div><button class="button ghost" data-action="show-my-courses">我的課表（${ws.plan.selections.length}）</button></div>
    <div class="explorer-layout"><aside><details class="explorer-filter-drawer" ${matchMedia('(min-width:701px)').matches?'open':''}><summary>篩選課程${filterCount?` · 已設定 ${filterCount} 項條件`: ' · 選擇開課單位、年級與班級'}</summary><form id="explorer-filters" class="panel explorer-filters"><h3>我想找的課</h3><label class="field">課名、老師或研究主題<input name="q" type="search" value="${esc(f.q || '')}" maxlength="160" placeholder="例如：資料庫、個人資料、老師姓名"></label>
    ${selectField('kind','課程類型',Object.entries(courseKinds),'所有課程類型')}${selectField('unit','開課單位',options.units.map(u=>[u.unit_id,u.name]),'所有開課單位')}${selectField('department','科系／領域',options.departments.map(d=>[d.department_id,d.name]),'所有科系／領域')}${selectField('year_level','開課年級',options.years.map(y=>[y,yearName(y)]),'所有年級')}${selectField('class_group','開課班級',[...new Set(options.classes.map(g=>g.class_group))].map(g=>[g,g]),'所有班級')}
    <details class="subtle-details" ${f.campus || f.eligibility || f.schedule || f.fit || f.direction_only==='1'?'open':''}><summary>校區與修課條件</summary>${selectField('campus','上課校區',[['CITY','只看城中'],['SHUANGXI','只看雙溪']],'兩個校區都可以')}${selectField('eligibility','修課資格',[['pass','符合資格'],['fail','尚未符合'],['needs_review','資料待確認']],'包含所有資格狀態')}${selectField('schedule','時間安排',[['pass','時間可安排'],['fail','時間有衝突'],['needs_review','時間待確認']],'包含所有時間狀態')}${selectField('fit','整體安排',[['pass','可以直接排入課表'],['needs_review','需要再確認'],['fail','目前無法排入']],'包含所有課程')}<label class="check-field"><input name="direction_only" type="checkbox" value="1" ${f.direction_only==='1'?'checked':''}>只看我選擇的職涯方向</label></details>
    <details class="subtle-details" ${f.window_enabled?'open':''}><summary>也對照一段空堂</summary><label class="check-field"><input name="window_enabled" type="checkbox" ${f.window_enabled?'checked':''}>只看這段時間的課</label><div id="window-fields" ${f.window_enabled?'':'hidden'}><label class="field">星期<select name="weekday">${dayNames.slice(1).map((d,i)=>option(i+1,'週'+d,f.weekday || 1)).join('')}</select></label><div class="form-row"><label class="field">開始<input name="start_time" type="time" value="${time(Number(f.start_minute ?? 540))}"></label><label class="field">結束<input name="end_time" type="time" value="${time(Number(f.end_minute ?? 720))}"></label></div><p class="muted">若一門課每週上課多次，也會一起檢查其他時段。</p></div></details><div class="actions"><button class="button" type="submit">查詢課程</button><button class="text-button" type="button" data-action="explorer-reset">重設條件</button></div><p id="filter-status" class="muted" aria-live="polite">已套用目前的搜尋條件。</p></form></details></aside>
    <section class="explorer-results" aria-label="課程搜尋結果"><div class="results-heading"><h3>找到 ${explorerData.matched_offerings} 個班別</h3><span class="muted">優先顯示可排入目前課表的課程</span></div><p class="demo-disclosure">目前為示範課程與虛構教師資料。語言與體育類別尚無本學期班別；評價與成績統計尚未匯入。</p><div class="discovery-list">${explorerData.items.map(explorerCourseCard).join('') || '<div class="panel empty"><h3>目前沒有符合條件的課</h3><p>可以放寬單位、年級、校區或空堂條件。沒有列出班別，也可能是本學期的示範資料尚未提供。</p><button class="button ghost" data-action="explorer-reset">清除篩選，看看全部課程</button></div>'}</div></section></div>${explorerCompareBar()}`;
}
function listOrEmpty(items,empty) {return items?.length?`<ul class="plain-list">${items.map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`:`<p class="muted">${esc(empty)}</p>`;}
function assessmentMarkup(offering) {return offering.assessment?.length?`<ul class="plain-list">${offering.assessment.map(a=>`<li>${esc(a.label)}：${a.weight_percent==null?'待確認':esc(a.weight_percent)+'%'}</li>`).join('')}</ul>`:'<p class="muted">評分方式尚未提供，請再查閱正式課綱。</p>';}
async function showExplorerCourse(id) {
  const item=await explorerItem(id),o=item.offering,syllabus=item.syllabus;
  const teachers=item.teacher_ids.map(tid=>explorerBase.teachers.find(t=>t.instructor_id===tid)).filter(Boolean);
  const records=ws.context.records.filter(r=>r.course_id===item.course.course_id);
  teachingReturnCourse=id;
  openDetail(cleanName(item.course.name),`<div class="course-detail-top"><p class="muted">${esc(organizationName(item))} · ${esc(item.organization.class_group)} · ${showNumber(item.course.credits)} 學分</p>${fitBadge(item.fit.status)}</div><div class="detail-section"><h3>上課時間與地點</h3><p>${meetings(o)}</p>${(o.meetings || []).map(m=>`<p class="muted">週${dayNames[m.weekday]} · ${esc(m.room || '教室待公告')} · 上課週次：${m.teaching_weeks==null?'待確認':esc(m.teaching_weeks.join('、'))}</p>`).join('')}</div><div class="detail-section"><h3>課程介紹與課綱</h3>${syllabus?`<p>${esc(syllabus.description)}</p><h4>希望學到什麼</h4>${listOrEmpty(syllabus.learning_goals,'學習目標尚未提供')}<h4>這門課怎麼上</h4>${listOrEmpty(syllabus.teaching_methods,'授課方式尚未提供')}<h4>教材與購書資訊</h4>${listOrEmpty(syllabus.textbooks,'教材與是否需購書尚未公告')}<details class="subtle-details"><summary>預計教學進度</summary>${listOrEmpty(syllabus.outline,'進度尚未提供')}</details>`:'<p class="muted">課程介紹、教材與教學進度尚未提供，請向開課單位確認。</p>'}</div><div class="detail-section"><h3>怎麼計算成績？</h3>${assessmentMarkup(o)}</div><div class="detail-section"><h3>誰來上這門課？</h3>${teachers.map(t=>`<article class="teacher-preview"><button class="text-button" data-action="teacher-profile" data-id="${esc(t.instructor_id)}" data-offering="${esc(id)}"><strong>${esc(t.name)}</strong>　查看教師介紹 →</button><p class="muted">研究領域：${t.research_areas.map(esc).join('、') || '尚未提供'}</p>${feedbackSummary(t)}</article>`).join('') || `<p class="muted">${esc(instructorName(o.instructor))}；個人介紹與研究資料尚未提供。</p>`}</div><div class="detail-section"><h3>和我的修課條件交叉核對</h3><h4>修課資格 ${badge(item.eligibility.status)}</h4>${checkList(item.eligibility)}<h4>時間與交通 ${badge(item.schedule.status)}</h4>${checkList(item.schedule)}<h4>學分負擔 ${badge(item.credit_load.status)}</h4>${checkList(item.credit_load)}${item.soft_mismatches.length?`<p class="muted">${item.soft_mismatches.map(m=>esc(readable(m.message))).join(' ')}</p>`:''}</div><details class="subtle-details"><summary>我的歷史修課紀錄</summary><p class="muted">${records.map(r=>`${esc(termName(r.term_id))} · ${esc(recordStates[r.state] || '待確認')} · 成績 ${r.grade==null?'未提供':esc(r.grade)}`).join('<br>') || '你還沒有這門課的修課紀錄。'}</p></details><p class="muted">剩餘名額：${o.seat_count==null?'待學校公告':esc(o.seat_count)}。正式選課與學分認列仍須由學校確認。</p><p class="demo-disclosure">${esc(explorerBase.notice)}</p><div class="actions">${addCourseButton(item)}${explorerMode?`<button class="button ghost" data-action="compare-toggle" data-id="${esc(id)}">${comparedCourses.has(id)?'移出比較':'加入比較'}</button>`:''}</div>`);
}
function safeExternalLink(url,label) {
  if(!url || !/^https:\/\//i.test(url))return '';
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
}
async function showTeacher(id,offeringId) {
  await ensureExplorerBase();
  const t=explorerBase.teachers.find(t=>t.instructor_id===id);
  if(!t)throw new Error('這位教師的資料尚未提供。');
  teachingReturnCourse=offeringId || teachingReturnCourse;
  openDetail(t.name,`<p class="demo-disclosure">這是虛構教師介紹，僅供體驗資料呈現方式。</p><p class="muted">${esc(t.title)}</p><div class="detail-section"><h3>研究領域</h3>${listOrEmpty(t.research_areas,'尚未提供研究領域')}</div><div class="detail-section"><h3>教學與研究經歷</h3>${listOrEmpty(t.experience,'尚未提供經歷')}</div><div class="detail-section"><h3>期刊論文與研究成果</h3>${t.publications.length?`<ul class="plain-list">${t.publications.map(p=>`<li><strong>${esc(p.title)}</strong><br><span class="muted">${esc(p.venue)} · ${p.year}</span> ${safeExternalLink(p.url,'查看研究成果')}</li>`).join('')}</ul>`:'<p class="muted">尚未提供研究成果。</p>'}</div><div class="detail-section"><h3>給分與課程安排回饋</h3>${feedbackSummary(t)}${t.grade_distribution?.buckets.length?`<ul class="plain-list">${t.grade_distribution.buckets.map(b=>`<li>${esc(b.label)}：${b.count} 人</li>`).join('')}</ul>`:''}<p class="muted">有統計資料時會一起顯示來源、樣本數與時間，方便判斷是否適合參考。</p></div>${safeExternalLink(t.profile_url,'教師公開介紹')}<div class="actions">${teachingReturnCourse?`<button class="button ghost" data-action="course-detail" data-id="${esc(teachingReturnCourse)}">← 返回課程</button>`:''}</div>`);
}
function showCourseComparison() {
  const items=[...comparedCourses].map(id=>explorerBase.items.find(i=>i.offering.offering_id===id)).filter(Boolean);
  if(items.length<2)throw new Error('先選兩到三個班別，再一起比較。');
  const rows=[
    ['開課單位／班級',i=>`${esc(organizationName(i))}<br>${esc(i.organization.class_group)}`],
    ['授課教師',i=>teacherNames(i).map(esc).join('、') || '待公告'],
    ['時間與校區',i=>meetings(i.offering)],
    ['學分',i=>showNumber(i.course.credits)],
    ['修課資格',i=>badge(i.eligibility.status)+checkList(i.eligibility)],
    ['時間安排',i=>badge(i.schedule.status)+checkList(i.schedule)],
    ['學分負擔',i=>badge(i.credit_load.status)+checkList(i.credit_load)],
    ['授課方式',i=>(i.syllabus?.teaching_methods || []).map(esc).join('、') || '尚未提供'],
    ['教材與購書',i=>(i.syllabus?.textbooks || []).map(esc).join('<br>') || '尚未提供'],
    ['評分方式',i=>assessmentMarkup(i.offering)],
    ['教師研究領域',i=>i.teacher_ids.map(id=>explorerBase.teachers.find(t=>t.instructor_id===id)?.research_areas.map(esc).join('、')).filter(Boolean).join('<br>') || '尚未提供'],
    ['給分與課程回饋',i=>i.teacher_ids.map(id=>explorerBase.teachers.find(t=>t.instructor_id===id)).filter(Boolean).map(feedbackSummary).join('') || '尚未提供'],
    ['目前能否排入',i=>`${fitBadge(i.fit.status)}<div class="actions">${addCourseButton(i,true)}<button class="button ghost mini" data-action="course-detail" data-id="${esc(i.offering.offering_id)}">查看課綱</button></div>`]
  ];
  openDetail('一起比較這幾門課',`<div class="table-wrap"><table class="comparison-table"><thead><tr><th>比較項目</th>${items.map(i=>`<th>${esc(cleanName(i.course.name))}<br>${esc(i.offering.section_name)} 班</th>`).join('')}</tr></thead><tbody>${rows.map(([label,content])=>`<tr><th scope="row">${label}</th>${items.map(i=>`<td>${content(i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="demo-disclosure">${esc(explorerBase.notice)}</p>`);
}
async function handleExplorerAction(action,button) {
  if(action==='open-explorer') {
    if(prefDirty)await savePlan({preferences:prefs},'已儲存時間安排，接著挑選課程。');
    sessionStorage.setItem('be02-step','3');
    const params=new URLSearchParams({plan_id:ws.plan.plan_id});
    if(button.dataset.window==='1')for(const [key,value] of Object.entries({window:1,weekday:slot.weekday,start_minute:slot.start_minute,end_minute:slot.end_minute}))params.set(key,String(value));
    location.assign('/scu-course-compass/course-explorer/?'+params);return;
  }
  if(action==='back-to-planner'){sessionStorage.setItem('be02-step','3');location.assign('/scu-course-compass/four-stage/');return;}
  if(action==='show-my-courses'){openDetail('我的課表',selectedPanel());return;}
  if(action==='teacher-profile'){await showTeacher(button.dataset.id,button.dataset.offering);return;}
  if(action==='explorer-reset') {
    explorerFilters={};rememberExplorer();explorerData=explorerBase;render();return;
  }
  if(action==='compare-toggle') {
    if(comparedCourses.has(button.dataset.id))comparedCourses.delete(button.dataset.id);
    else {if(comparedCourses.size>=3)throw new Error('一次最多比較三個班別，請先移除一個。');comparedCourses.add(button.dataset.id);}
    rememberExplorer();
    const wasOpen=$('detail').open;
    if(wasOpen)await showExplorerCourse(button.dataset.id);
    render();return;
  }
  if(action==='compare-clear'){comparedCourses.clear();rememberExplorer();render();return;}
  if(action==='compare-open'){showCourseComparison();return;}
}
