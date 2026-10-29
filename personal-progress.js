'use strict';
// Personal data has a separate cookie-protected API; never merge it into ws or
// the synthetic profile/catalog/AI request objects used by stages 2–4.
window.PersonalProgress = {
  active:false, available:false, data:null, historical:false,
  async request(path) {
    const response=await fetch('/api/personal/'+path,{credentials:'same-origin',headers:{'X-Personal-Request':'progress-ui'}});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error?.message || '目前無法讀取個人進度。');
    return result.data;
  },
  async load() {
    const status=await this.request('status');
    this.available=status.connected;
    if(this.available){this.data=await this.request('progress');this.active=true;this.historical=false;}
  },
  heading() {
    return `<div class="identity"><span>${esc(this.data.department)} · ${this.data.applicable_rule_entry_year} 學年度課規</span></div>`;
  },
  savebar() {
    return `<div class="savebar"><span>${this.historical?'正在查看歷史版本':'個人修課資料'} · 第 ${this.data.records_revision} 版</span><div class="personal-toolbar"><button class="text-button" data-action="personal-history">版本紀錄</button><button class="text-button" data-action="personal-latest">${this.historical?'返回最新版':'重新讀取'}</button><button class="text-button" data-action="personal-demo">查看示範規劃</button></div></div>`;
  },
  referenceUrl(kind){
    const refs=this.data.source_refs || [];
    const reference=refs.find(r=>kind==='common'?r.title.includes('共通'):kind==='major'?r.title.includes('必選修'):r.url.includes('web.sys.scu.edu.tw'));
    try{const url=new URL(reference?.url || 'https://web.sys.scu.edu.tw/default.asp');return url.protocol==='https:' && (url.hostname==='scu.edu.tw' || url.hostname.endsWith('.scu.edu.tw'))?url.href:'https://web.sys.scu.edu.tw/default.asp';}catch{return 'https://web.sys.scu.edu.tw/default.asp';}
  },
  referenceText(text){
    const mapping={'共同外文':'common','通識':'common','人工智慧跨域應用':'common','系必修':'major','外系學分':'major','外系':'major','全學年':'school'};
    return esc(text).replace(/人工智慧跨域應用|共同外文|系必修|外系學分|全學年|通識|外系/g,word=>`<a class="reference-keyword" href="${esc(this.referenceUrl(mapping[word]))}" target="_blank" rel="noopener noreferrer">${word}</a>`);
  },
  references(){
    const g=this.data;
    return `<section class="progress-references" aria-label="參考來源"><p class="reference-label">參考來源</p><div class="reference-links"><a href="https://web.sys.scu.edu.tw/default.asp" target="_blank" rel="noopener noreferrer">校方進度</a><a href="${esc(this.referenceUrl('major'))}" target="_blank" rel="noopener noreferrer">${g.applicable_rule_entry_year} 年度課規</a><a href="${esc(this.referenceUrl('common'))}" target="_blank" rel="noopener noreferrer">共通課程</a><button class="text-button" data-action="personal-recognition">認列說明</button><button class="text-button" data-action="personal-data-time">更新時間</button></div></section>`;
  },
  render() {
    const g=this.data,s=g.summary;
    const num=showNumber;
    const state={earned:'已取得',missing:'未取得',needs_review:'待核對',shared:'主修已滿足'};
    const courseTable=rows=>`<div class="table-wrap"><table class="degree-course-table"><thead><tr><th>年級／學期</th><th>科目</th><th>課程學分</th><th>取得學分</th><th>狀態</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.year_level==null?'未提供':esc(r.year_level)+' 年級'}<small>${r.semester_scope==='全'?'全學年':r.semester_scope==='單'?'單學期':'學期待核對'}</small></td><th scope="row">${esc(r.name)}</th><td>${num(r.listed_credits)}</td><td>${num(r.earned_credits)}</td><td>${badge(r.status,state[r.state] || '待核對')}</td></tr>`).join('')}</tbody></table></div>`;
    const requirement=r=>{
      const label=r.status==='pass'?'已完成':r.status==='fail'?'尚待完成':'需核對';
      return `<article class="degree-requirement"><div class="degree-requirement-head"><h4>${esc(r.title)}</h4>${badge(r.status,label)}</div>${r.kind==='non_credit'?`<p>校方已列 ${num(r.completed_units)}／${num(r.required_units)} 科次</p><ul>${g.physical_courses.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:r.kind==='school_certification'?`<p>校方紀錄：${esc(r.school_state)}</p>`:`<p class="degree-credit-line">${r.earned_credits==null?'可採計學分待核對':`已取得／已確認 <strong>${num(r.earned_credits)}</strong> 學分`}${r.required_credits!=null?` · 要求 ${num(r.required_credits)} 學分`:''}</p>`}<p class="muted">${this.referenceText(r.message)}</p>${r.courses.length?courseTable(r.courses):''}</article>`;
    };
    return `<div class="reading-column progress-workspace personal-workspace">${this.historical?'<div class="notice">這是歷史快照，不會覆寫目前資料。可按上方「返回最新版」。</div>':''}<section class="panel degree-overview"><div class="degree-heading"><div><p class="eyebrow">我的修課紀錄</p><h2>我的畢業進度</h2><p class="muted">${esc(g.department)} · 適用 ${g.applicable_rule_entry_year} 學年度課規</p></div><span class="badge pass">校方資料</span></div><div class="degree-total"><div><span>校方報表累計學分</span><p><strong>${num(s.earned_credits)}</strong><span>／最低 ${num(s.minimum_total_credits)} 學分</span></p></div><div class="degree-gap">還差 <strong>${num(s.remaining_credits)}</strong> 學分</div></div><progress class="degree-progress" max="100" value="${s.completion_percent}" aria-label="校方報表累計占最低總學分 ${s.completion_percent}%">${s.completion_percent}%</progress><div class="degree-estimates"><div><span>仍未取得的系必修</span><strong>${g.missing_required_courses.length} <small>門</small></strong></div><div><span>修習中／待成績</span><strong>${num(s.in_progress_credits)} <small>學分</small></strong></div><div><span>認列待核對</span><strong>${g.review_items.length} <small>項</small></strong></div></div><p class="muted degree-footnote">報表累計供規劃參考，<a class="reference-keyword" href="https://web.sys.scu.edu.tw/default.asp" target="_blank" rel="noopener noreferrer">學分採計</a>以校方核定為準；在修與重複學分不另加計。</p></section>
    <section class="panel degree-priorities"><h3>還缺哪些必修？</h3><p class="muted">依校方逐科標記列出，與規劃或同名課程分開。</p><ul class="degree-next-list">${g.missing_required_courses.map(r=>`<li><div><strong>${esc(r.name)}</strong><span>${num(r.listed_credits)} 學分 · 校方尚未認列為必修已取得</span></div>${badge(r.status,'未取得')}</li>`).join('') || '<li>目前校方列示的系必修均已取得。</li>'}</ul></section>
    <section class="panel personal-reviews"><div class="review-heading"><h3>還需注意</h3><span class="review-count" aria-label="${g.review_items.length} 項需注意"><strong>${g.review_items.length}</strong><small>項</small></span></div><p class="muted">保留校方列示與規則比對之間的差異，避免誤算畢業進度。</p><ul class="plain-list">${g.review_items.map(r=>`<li>${this.referenceText(r.message)}</li>`).join('')}</ul></section>
    <section class="panel degree-categories"><h3>逐項查看畢業要求</h3><p class="muted">以正式課規搭配校方紀錄核對。選修可含核准的外系學分，不將系內差額直接當成新增修課負擔。</p>${g.sections.map(c=>`<details class="degree-category" ${c.section_id==='major_required'?'open':''}><summary><span>${esc(c.title)}</span>${badge(c.status,c.missing_mapping?'資料待補':c.status==='pass'?'校方紀錄已完成':c.status==='fail'?'尚待完成':'需核對')}</summary>${c.requirements.map(requirement).join('')}${c.note?`<p class="muted">${esc(c.note)}</p>`:''}</details>`).join('')}</section>
    <section class="panel"><h3>修習中，等待成績</h3><p class="muted">校方目前選課查詢，包含零學分課程。尚未用同名課程自動替代未完成必修。</p><div class="table-wrap"><table><thead><tr><th>學期範圍</th><th>科目</th><th>課程學分</th><th>成績</th><th>取得學分</th></tr></thead><tbody>${g.in_progress_courses.map(r=>`<tr><td>${esc(r.term_id)}</td><td>${esc(r.name)}</td><td>${num(r.listed_credits)}</td><td>成績未到</td><td>0</td></tr>`).join('')}</tbody></table></div></section>
    <details class="panel"><summary>查看已匯入的分類修課紀錄（${g.records.length} 筆）</summary><p class="muted">這是畢業進度表的分類紀錄，並非完整歷年成績單；同名、轉學抵免與跨分類紀錄先分開保留。</p><div class="personal-records table-wrap"><table><thead><tr><th>分類</th><th>科目</th><th>列示學分</th><th>依逐科證據可確認學分</th></tr></thead><tbody>${g.records.map(r=>`<tr><td>${esc({major:'系必修',common:'共同必修',general:'通識',elective:'系選修',other:'其他學分'}[r.section])}</td><td>${esc(r.name)}</td><td>${num(r.listed_credits)}</td><td>${num(r.earned_credits ?? r.supported_credits ?? (r.state==='missing'?0:null))}</td></tr>`).join('')}</tbody></table></div></details>
    ${this.references()}
    <div class="actions step-actions"><button class="button ghost" data-action="personal-history">查看匯入版本</button><button class="button" data-step="2">接著探索方向（示範） →</button></div></div>`;
  },
  async handle(action,button,{render,openDetail}) {
    if(!action.startsWith('personal-'))return false;
    if(action==='personal-demo'){this.active=false;render();}
    if(action==='personal-show'){this.active=true;render();}
    if(action==='personal-latest'){this.data=await this.request('progress');this.active=true;this.historical=false;render();}
    if(action==='personal-recognition')openDetail('學分認列說明',`<ul class="plain-list">${this.data.recognition_notes.map(n=>`<li>${this.referenceText(n)}</li>`).join('')}</ul><p class="muted">更多說明：<a href="/scu-course-compass/service-info/#disclaimer">免責聲明</a> · <a href="/scu-course-compass/service-info/#privacy">資料使用方式</a></p>`);
    if(action==='personal-data-time')openDetail('資料更新時間',`<dl class="progress-dates"><dt>本機擷取</dt><dd>${esc(dateName(this.data.records_updated_at))}</dd><dt>本機匯入</dt><dd>第 ${this.data.records_revision} 版 · ${esc(dateName(this.data.imported_at))}</dd><dt>畢業標準資料</dt><dd>${esc(this.data.milestones_as_of || '未提供')}</dd><dt>整張報表產生時間</dt><dd>校方未提供</dd></dl><p class="muted">擷取與匯入時間不代表校方紀錄已即時更新。</p>`);
    if(action==='personal-version'){
      this.data=await this.request('progress?revision='+encodeURIComponent(button.dataset.rev));this.active=true;this.historical=true;
      $('detail').close();render();$('main').focus();
    }
    if(action==='personal-history'){
      const result=await this.request('versions');
      openDetail('個人修課資料的匯入紀錄',`<p class="muted">每次匯入保存校方來源與課規雜湊；檢視舊版不會覆寫最新版。同一份資料重匯不會重複新增版本。</p><div class="version-list">${result.items.map(r=>`<div class="version-row"><div><strong>第 ${r.revision} 版</strong><p class="muted">${esc(dateName(r.created_at))}</p><details class="version-fingerprint"><summary>版本識別</summary><small class="source-hash">快照：${esc(r.sha256)}<br>校方資料：${esc(r.source_sha256)}<br>課規：${esc(r.rules_sha256)}</small></details></div><button class="button ghost mini" data-action="personal-version" data-rev="${r.revision}">查看此版</button></div>`).join('')}</div>`);
    }
    return true;
  }
};
