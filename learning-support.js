'use strict';
// Public-flow reference: https://resume-clinic.104.com.tw/help
// Original local prototype: no 104 roster, private endpoints, messaging or tracking.
window.LearningSupport={
  mentors:[
    {id:'faculty-software',name:'資料與軟體教授',role:'professor',field:'資訊與資料領域',tags:['軟體工程','資料分析','研究入門'],topics:['課程規劃','研究所準備'],open:true,bio:'適合討論基礎課如何銜接專題與研究，以及準備作品與問題的方法。'},
    {id:'faculty-law',name:'科技法律教授',role:'professor',field:'法律與跨域研究',tags:['科技法律','智慧財產','研究計畫'],topics:['跨域學習','研究所準備'],open:true,bio:'適合整理資訊與法律跨域學習的疑問，思考需要補充的基礎與研究方向。'},
    {id:'alumni-engineering',name:'軟體工程校友',role:'alumni',field:'軟體開發與職場探索',tags:['Software Engineer','軟體工程','作品集','實習'],topics:['職涯探索','實習準備'],open:true,bio:'從學習與工作之間的差異出發，整理作品集、實習與職涯探索的問題。'},
    {id:'alumni-crossfield',name:'跨領域職涯校友',role:'alumni',field:'人文與數位工作',tags:['人文','文字表達','數位專案'],topics:['職涯探索','跨域學習'],open:true,bio:'適合還沒有確定職稱、想理解人文能力如何連結數位工作的同學。'},
    {id:'senior-program',name:'輔系與雙主修學長姐',role:'senior',field:'跨系修課經驗',tags:['輔系','雙主修','學分規劃'],topics:['課程規劃','跨域學習'],open:true,bio:'整理申請前要核對的資格、學分與時間取捨；正式認列仍需向系辦確認。'},
    {id:'senior-campus',name:'校區與時間規劃學長姐',role:'senior',field:'修課與生活安排',tags:['城中','雙溪','實習','空堂'],topics:['課程規劃','實習準備'],open:false,bio:'以額滿情境示範選擇其他對象或先與 AI 整理問題的替代流程。'}
  ],
  topics:['課程規劃','職涯探索','研究所準備','實習準備','跨域學習'],
  profileId:null,view:'browse',selected:null,recordId:null,topic:'all',role:'all',query:'',savedOnly:false,onlyOpen:false,
  ensure(profile){if(this.profileId!==profile.id){this.profileId=profile.id;this.resetView();this.topic='all';this.role='all';this.query='';this.onlyOpen=false;}},
  resetView(){this.view='browse';this.selected=null;this.recordId=null;this.savedOnly=false;},
  storageKey(){return 'career-support-v1:'+this.profileId;},
  read(){
    try{const d=JSON.parse(sessionStorage.getItem(this.storageKey()) || '{}');return {saved:Array.isArray(d.saved)?d.saved:[],records:Array.isArray(d.records)?d.records:[],working:d.working || null};}
    catch{return {saved:[],records:[],working:null};}
  },
  write(data){sessionStorage.setItem(this.storageKey(),JSON.stringify(data));},
  mentor(id){return this.mentors.find(m=>m.id===id);},
  roleName(role){return {professor:'教授',alumni:'校友',senior:'學長姐志工'}[role] || '討論對象';},
  filtered(){
    const data=this.read(),q=this.query.trim().normalize('NFKC').toLowerCase();
    return this.mentors.filter(m=>(this.topic==='all' || m.topics.includes(this.topic)) && (this.role==='all' || m.role===this.role) && (!this.onlyOpen || m.open) && (!this.savedOnly || data.saved.includes(m.id)) && (!q || [m.name,m.field,m.bio,...m.tags,...m.topics].join(' ').normalize('NFKC').toLowerCase().includes(q)));
  },
  nav(){const data=this.read();return `<div class="support-nav"><button class="pill-button ${this.view==='browse' && !this.savedOnly?'active':''}" data-action="support-browse">找討論對象</button><button class="pill-button ${this.view==='browse' && this.savedOnly?'active':''}" data-action="support-saved">已收藏 ${data.saved.length}</button><button class="pill-button ${['records','room'].includes(this.view)?'active':''}" data-action="support-records">我的討論 ${data.records.length}</button></div>`;},
  render(profile){
    this.ensure(profile);
    const header=`<div class="header-space support-header"><div class="eyebrow">LEARNING SUPPORT</div><h1 class="page-title">學涯輔導站</h1><p class="page-subtitle">先整理想法，再找適合的人討論。</p></div>`;
    if(this.view==='browse')return header+this.browse();
    if(this.view==='records')return header+this.nav()+this.records();
    if(this.view==='room')return header+this.nav()+this.room();
    return header+`<div class="community-back"><button class="btn ghost small" data-action="support-browse">← 回到討論對象</button></div>`+(this.view==='profile'?this.profile():this.view==='preview'?this.preview():this.compose());
  },
  browse(){
    const data=this.read(),items=this.filtered();
    return `<section class="support-ai-first"><span class="community-icon">${icon('spark',24)}</span><div><h2>先和 AI 聊聊</h2><p>還沒想好怎麼問？先整理興趣、修課與下一步。</p></div><button class="btn primary" data-action="guidance-ai">開始 AI 討論${icon('arrow',15)}</button></section>${this.nav()}
    <div class="support-section-heading"><div><h2>找到適合請教的對象</h2><p>依主題與專長挑選，先看介紹，再整理問題。</p></div><details class="support-help"><summary>怎麼使用？</summary><ol><li>篩選對象、查看專長。</li><li>填寫問題、預覽內容。</li><li>存入「我的討論」，補充自己的筆記。</li></ol><p>流程參考<a href="https://resume-clinic.104.com.tw/help" target="_blank" rel="noopener noreferrer">104 公開使用說明</a>；本頁沒有串接 104 或真人訊息服務。</p></details></div>
    <form id="support-search" class="support-search"><label class="support-query">${icon('compass',17)}<input name="query" maxlength="100" aria-label="搜尋專長或關鍵字" placeholder="搜尋專長、領域或問題" value="${esc(this.query)}"></label><select name="role" class="input" aria-label="討論對象類型"><option value="all">全部對象</option>${['professor','alumni','senior'].map(r=>`<option value="${r}" ${this.role===r?'selected':''}>${this.roleName(r)}</option>`).join('')}</select><label class="support-open"><input name="only_open" type="checkbox" ${this.onlyOpen?'checked':''}>只看可選範例</label><button class="btn" type="submit">查找</button></form>
    <div class="support-topics" aria-label="討論主題">${['all',...this.topics].map(t=>`<button class="pill-button ${this.topic===t?'active':''}" data-action="support-topic" data-topic="${t}" aria-pressed="${this.topic===t}">${t==='all'?'全部主題':t}</button>`).join('')}</div><p class="support-demo">找到 ${items.length} 個範例 · 以下為功能示範，不是真人名單。</p>
    ${data.working && this.mentor(data.working.mentor_id)?'<div class="support-resume"><span>你還有一份未完成的提綱。</span><button class="btn small" data-action="support-resume">繼續整理</button></div>':''}
    <div class="support-directory">${items.map(m=>this.card(m,data.saved.includes(m.id))).join('') || '<div class="empty-state"><h3>換個條件，再找找看。</h3><p>試試其他關鍵字或主題，也可以先和 AI 整理問題。</p><button class="btn small" data-action="support-reset">清除篩選</button></div>'}</div>`;
  },
  card(m,saved){return `<article class="support-mentor"><div class="support-mentor-top"><span class="support-avatar" aria-hidden="true">${this.roleName(m.role).slice(0,1)}</span><div><span class="support-role">${this.roleName(m.role)} · 範例</span><h3>${esc(m.name)}</h3></div><button class="activity-bookmark ${saved?'is-saved':''}" data-action="support-bookmark" data-id="${m.id}" aria-label="${saved?'取消收藏':'收藏'}${esc(m.name)}" aria-pressed="${saved}">${icon(saved?'check':'bookmark',17)}</button></div><p class="support-field">${esc(m.field)}</p><div class="support-tags">${m.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div><p>${esc(m.bio)}</p><div class="support-card-bottom"><span class="support-capacity ${m.open?'':'is-full'}">${m.open?'範例可選':'範例額滿'}</span><button class="btn small" data-action="support-profile" data-id="${m.id}">查看專長${icon('arrow',14)}</button></div></article>`;},
  profile(){
    const m=this.mentor(this.selected);if(!m)return this.browse();
    return `<section class="panel support-profile"><span class="support-role">${this.roleName(m.role)} · 示範對象</span><h2>${esc(m.name)}</h2><p>${esc(m.bio)}</p><div class="support-tags">${m.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div><h3>適合討論</h3><ul>${guidanceRoles[m.role].questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><div class="support-profile-facts"><span>主題：${m.topics.map(esc).join('、')}</span><span>方式：文字提綱與討論筆記</span><span>狀態：${m.open?'範例可選':'範例額滿'}</span></div><p class="helper">這是功能範例，不會傳送問題或預約真人。</p><div class="community-actions"><button class="btn primary" data-action="support-compose" data-id="${m.id}" ${m.open?'':'disabled'}>${m.open?'整理想請教的問題':'此範例暫停受理'}</button><button class="btn" data-action="guidance-ai">先和 AI 聊聊</button></div></section>`;
  },
  compose(){
    const m=this.mentor(this.selected);if(!m)return this.browse();
    const working=this.read().working,d=working?.mentor_id===m.id?working:{};
    return `<div class="support-steps"><span>1 選擇對象</span><strong>2 整理問題</strong><span>3 預覽與保存</span></div><div class="guidance-prep"><section class="panel"><h2>想請教${esc(m.name)}什麼？</h2><form id="support-compose"><label class="field-label" for="support-topic">討論主題</label><select name="topic" id="support-topic" class="input">${m.topics.map(t=>`<option ${d.topic===t?'selected':''}>${esc(t)}</option>`).join('')}</select><label class="field-label" for="support-background">簡短背景（選填）</label><textarea class="input" id="support-background" name="background" maxlength="500" placeholder="例如：目前年級、感興趣的方向或已嘗試的事情。">${esc(d.background || '')}</textarea><label class="field-label" for="support-question">想請教的問題</label><textarea class="input" id="support-question" name="question" required maxlength="1200" placeholder="目前在考慮什麼？希望這次討論幫助你釐清哪個選擇？">${esc(d.question || '')}</textarea><button class="btn primary" type="submit">預覽討論內容${icon('arrow',15)}</button><p class="helper">只保存你主動填寫的內容，不附上私人修課表，也不會傳送給對方。</p></form></section><aside class="panel"><h2>讓問題更容易回答</h2><ul class="guidance-question-list">${guidanceRoles[m.role].questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><p class="helper">具體說明背景、已做的準備與希望得到的建議。</p></aside></div>`;
  },
  preview(){
    const d=this.read().working,m=this.mentor(d?.mentor_id);if(!d || !m)return this.browse();
    return `<div class="support-steps"><span>1 選擇對象</span><span>2 整理問題</span><strong>3 預覽與保存</strong></div><section class="panel support-preview"><h2>確認這次想討論的內容</h2><dl><dt>對象</dt><dd>${esc(m.name)}（範例）</dd><dt>主題</dt><dd>${esc(d.topic)}</dd>${d.background?`<dt>背景</dt><dd>${esc(d.background)}</dd>`:''}<dt>問題</dt><dd>${esc(d.question)}</dd></dl><p class="helper">儲存至目前瀏覽分頁的「我的討論」，不會通知對方。</p><div class="community-actions"><button class="btn" data-action="support-compose" data-id="${m.id}">返回修改</button><button class="btn primary" data-action="support-save">儲存到我的討論</button></div></section>`;
  },
  records(){const records=this.read().records;return `<section class="support-records"><h2>我的討論</h2><p class="helper">目前分頁的準備紀錄與本人筆記，沒有真人收件或訊息同步。</p>${records.length?records.slice().reverse().map(r=>`<article class="support-record"><div><span class="support-record-state">${this.statusLabel(r.status)}</span><h3>${esc(r.topic)} · ${esc(this.mentor(r.mentor_id)?.name || '示範對象')}</h3><p>${esc(fmtDate(r.created_at))}</p></div><button class="btn small" data-action="support-room" data-id="${esc(r.id)}">查看討論</button></article>`).join(''):'<div class="empty-state"><h3>先準備一個想問的問題。</h3><p>找到對象、整理問題並保存後，就能在這裡接著記錄。</p><button class="btn" data-action="support-browse">找討論對象</button></div>'}</section>`;},
  statusLabel(s){return {prepared:'提綱已備妥 · 未送出',discussed:'已討論 · 本人回填',closed:'已結束整理'}[s] || '待確認';},
  room(){
    const r=this.read().records.find(r=>r.id===this.recordId);if(!r)return this.records();
    return `<section class="panel support-room"><div class="section-heading"><div><span class="support-record-state">${this.statusLabel(r.status)}</span><h2>${esc(r.topic)}</h2><p>${esc(this.mentor(r.mentor_id)?.name || '示範對象')} · 非真人聊天室</p></div><button class="btn ghost small" data-action="support-records">返回紀錄</button></div><div class="support-note"><strong>我準備的問題</strong>${r.background?`<p>${esc(r.background)}</p>`:''}<p>${esc(r.question)}</p></div><h3>討論筆記</h3>${r.notes.length?r.notes.map(n=>`<div class="support-note"><small>${esc(fmtDate(n.created_at))} · 本人筆記</small><p>${esc(n.text)}</p></div>`).join(''):'<p class="helper">還沒有筆記。這裡不會自動收到真人回覆。</p>'}${r.status!=='closed'?`<form id="support-note"><label class="field-label" for="support-note-text">補充自己的筆記</label><textarea id="support-note-text" class="input" name="note" maxlength="2000" required placeholder="記下討論重點，或之後想追問的事情。"></textarea><button class="btn" type="submit">儲存筆記</button></form><div class="community-actions support-room-actions">${r.status==='prepared'?'<button class="btn small" data-action="support-discussed">記下已討論（本人回填）</button>':''}<button class="btn ghost small" data-action="support-close">結束整理</button></div>`:'<p class="helper">這份整理已結束，內容保留供查閱。</p>'}</section>`;
  },
  capture(form){
    if(form?.id!=='support-compose')return;
    const m=this.mentor(this.selected);if(!m)return;
    const data=this.read(),old=data.working?.mentor_id===m.id?data.working:{};
    data.working={id:old.id || crypto.randomUUID(),mentor_id:m.id,topic:form.elements.topic.value,background:form.elements.background.value.slice(0,500),question:form.elements.question.value.slice(0,1200)};this.write(data);
  },
  handle(action,button,{profile,render,toast}){
    if(!action.startsWith('support-'))return false;
    this.ensure(profile);
    try{
      const data=this.read(),m=this.mentor(button.dataset.id);
      if(action==='support-browse' || action==='support-saved'){this.view='browse';this.savedOnly=action==='support-saved';}
      if(action==='support-records')this.view='records';
      if(action==='support-reset'){this.query='';this.role='all';this.topic='all';this.onlyOpen=false;this.savedOnly=false;}
      if(action==='support-topic' && (button.dataset.topic==='all' || this.topics.includes(button.dataset.topic)))this.topic=button.dataset.topic;
      if(action==='support-profile' && m){this.selected=m.id;this.view='profile';}
      if(action==='support-compose' && m){if(!m.open)throw Error('這個範例已額滿，請選其他對象。');this.selected=m.id;this.view='compose';}
      if(action==='support-resume' && this.mentor(data.working?.mentor_id)){this.selected=data.working.mentor_id;this.view='compose';}
      if(action==='support-bookmark' && m){data.saved=data.saved.includes(m.id)?data.saved.filter(id=>id!==m.id):[...data.saved,m.id];this.write(data);}
      if(action==='support-save'){
        const d=data.working,target=this.mentor(d?.mentor_id);
        if(!d || !target?.open || !target.topics.includes(d.topic) || !d.question.trim() || d.question.length>1200)throw Error('請先完成可選對象的問題預覽。');
        if(!data.records.some(r=>r.id===d.id)){
          if(data.records.length>=20)throw Error('目前分頁最多保存 20 份討論紀錄。');
          data.records.push({...d,status:'prepared',created_at:new Date().toISOString(),notes:[]});
        }
        data.working=null;this.write(data);this.recordId=d.id;this.view='room';toast('已保存在我的討論，尚未傳送。');
      }
      if(action==='support-room' && data.records.some(r=>r.id===button.dataset.id)){this.recordId=button.dataset.id;this.view='room';}
      if(action==='support-discussed' || action==='support-close'){
        const record=data.records.find(r=>r.id===this.recordId);
        if(!record || record.status==='closed')throw Error('這份討論已結束或不存在。');
        record.status=action==='support-close'?'closed':'discussed';this.write(data);
      }
      render();
    }catch(error){toast(error.message || '目前無法保存，請稍後再試。',true);}
    return true;
  },
  submit(form,{profile,render,toast}){
    if(!['support-search','support-compose','support-note'].includes(form.id))return false;
    this.ensure(profile);
    try{
      if(form.id==='support-search'){this.query=form.elements.query.value.slice(0,100);this.role=['professor','alumni','senior'].includes(form.elements.role.value)?form.elements.role.value:'all';this.onlyOpen=form.elements.only_open.checked;}
      if(form.id==='support-compose'){if(!this.mentor(this.selected)?.open)throw Error('請選擇其他可選範例。');this.capture(form);const d=this.read().working;if(!d.question.trim() || !this.mentor(this.selected).topics.includes(d.topic))throw Error('請選擇主題並寫下問題。');this.view='preview';}
      if(form.id==='support-note'){
        const data=this.read(),record=data.records.find(r=>r.id===this.recordId),text=form.elements.note.value.trim();
        if(!record || record.status==='closed' || !text || text.length>2000 || record.notes.length>=30)throw Error('請填寫 2,000 字以內筆記；已結束的討論不能新增。');
        record.notes.push({text,created_at:new Date().toISOString()});this.write(data);toast('已保存本人筆記。');
      }
      render();
    }catch(error){toast(error.message || '目前無法保存，請稍後再試。',true);}
    return true;
  }
};
