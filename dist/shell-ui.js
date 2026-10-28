'use strict';

// Product shell prototype. It demonstrates extension seats, not the upstream client runtime.
let pluginTab='installed',automationTab='autonomy',traceFilter='all',traceQuery='',traceSelection=0,traceDetail='summary';
const shellScroll=new Map();
function initShellState(){
 const h=state.harness;
 if(h.shellVersion!==4){
  h.docks={};h.collapsedWorkspaces={weekly:true};h.sidebarCollapsed=false;h.sessionViews={};
  h.workDetails='standard';h.builtinPlugins={teams:false,review:false,schedule:true,voice:false,terminal:true,loop:true,subagents:true};
  h.schedules=[{id:'weekly-demo',workspace:'weekly',title:'生成每周经营复盘',prompt:'汇总本周经营数据，列出异常与下周需要关注的问题。',frequency:'每周五 17:00 · Asia/Shanghai',enabled:true}];
  h.shellVersion=4;
 }
 h.docks=h.docks||{};h.sessionViews=h.sessionViews||{};h.collapsedWorkspaces=h.collapsedWorkspaces||{};
 h.mobileSidebar=false;
 for(const p of state.projects){if(p.paused===undefined)p.paused=p.id==='commerce'?state.paused:false;if(p.budget===undefined)p.budget=p.id==='commerce'?state.budget:60;}
}
function activateWorkspace(id){
 const p=state.projects.find(x=>x.id===id);if(!p)return false;
 state.activeProject=id;state.paused=!!p.paused;state.budget=p.budget||60;
 state.harness.collapsedWorkspaces[id]=false;ensureWorkspaceSession();return true;
}
function openSessionById(id){
 const s=state.harness.sessions.find(x=>x.id===id);if(!s||!activateWorkspace(s.workspace))return;
 state.harness.activeSession=s.id;state.harness.mobileSidebar=false;view='workbench';persist();closeOverlay();render();
}
function stopWorkItem(id){
 const s=workspaceSessions().find(x=>x.task===id);if(s){s.status='stopped';s.messages.push({role:'system',text:'本轮已停止，检查点保留，等待项目重新评估。'});}
 syncTaskSessionStates();persist();
}
function sessionView(){return state.harness.sessionViews[currentSession().id]||'chat';}
function dockState(){
 const id=currentSession().id,h=state.harness;
 if(!h.docks[id])h.docks[id]={open:false,tabs:[],active:null,second:null,split:false,fullscreen:false,floating:false,width:520,file:'src/import/header.ts'};
 return h.docks[id];
}
function openDockTab(kind,options={}){
 const d=dockState(),id=options.file?'file:'+options.file:kind;
 let tab=d.tabs.find(t=>t.id===id);
 const names={guide:'工具',files:'工作区文件',changes:'代码变更',terminal:'终端',browser:'浏览器',plan:'执行计划',extensions:'插件视图',quality:'导入监测'};
 if(!tab){tab={id,kind,title:options.file?options.file.split('/').at(-1):names[kind]||kind,file:options.file};d.tabs.push(tab);}
 if(options.file)d.file=options.file;
 if(options.second){if(d.active===tab.id){d.second=d.active;d.active=d.tabs.find(t=>t.id!==tab.id)?.id||d.active;}else d.second=tab.id;}else{if(d.split&&d.second===tab.id)d.second=d.active;d.active=tab.id;}d.open=true;state.harness.mobileSidebar=false;persist();render();
}
function renderHarnessShell(){
 const oldFeed=document.getElementById('conversation-feed');
 if(oldFeed)shellScroll.set(oldFeed.dataset.session+':'+(oldFeed.dataset.view||'chat'),oldFeed.scrollTop);
 const p=project(),h=state.harness,autonomous=nav.some(([id])=>id===view);
 const body=view==='workbench'?workbenchPage():`<section class="main-panel"><header class="panel-header"><button class="icon-btn" data-action="toggle-sidebar" aria-label="展开或收起侧栏">${icon('sliders')}</button><span>${autonomous?esc(p.name)+' / 自主推进':labels[view]||'设置'}</span><div class="grow"></div>${autonomous?button('返回会话','navigate','ghost','arrow','data-view="workbench"'):''}<button class="demo-tag" data-action="${isSelfRecordView()?'self-connect':'about'}">${isSelfRecordView()?'真实记录':'交互原型'}</button></header>${autonomous?`<nav class="project-tabs" aria-label="自主推进视图">${nav.map(([id,ic,label])=>`<button data-action="navigate" data-view="${id}" class="${view===id?'active':''}" ${view===id?'aria-current="page"':''}>${label==='项目概览'?'概览':label}</button>`).join('')}</nav>`:''}<main class="page"><div class="page-inner">${renderPage()}</div></main></section>`;
 document.getElementById('app').innerHTML=`<div class="harness-window"><div class="shell-caption"><div class="traffic"><button data-action="window-close" aria-label="演示关闭窗口"></button><button data-action="window-minimize" aria-label="演示最小化到后台"></button><button data-action="window-expand" aria-label="窗口大小说明"></button></div><span>航向 <span class="caption-sub">Vela · Harness Workspace</span></span><button data-action="${isSelfRecordView()?'self-connect':'about'}" class="caption-demo">${isSelfRecordView()?esc(selfModeLabel()):view==='automation'?'真实项目 / 交互示例':'交互示例 · 未接入运行时'}</button></div><div class="app-shell ${h.sidebarCollapsed?'is-collapsed':''} ${h.mobileSidebar?'sidebar-open':''}">${renderShellSidebar()}${h.mobileSidebar?'<button class="sidebar-scrim" data-action="dismiss-sidebar" aria-label="关闭侧栏"></button>':''}<div class="shell-main">${body}</div></div>${h.showWidget?renderPluginWidget():''}</div>`;
 const feed=document.getElementById('conversation-feed');if(feed&&shellScroll.has(feed.dataset.session+':'+(feed.dataset.view||'chat')))feed.scrollTop=shellScroll.get(feed.dataset.session+':'+(feed.dataset.view||'chat'));
 if(isSelfWorkspace()&&view==='workbench')loadRunDetails(selfSessionRun());
}
function renderShellSidebar(){
 const h=state.harness,isProject=nav.some(([id])=>id===view);
 return `<aside class="shell-sidebar" aria-label="工作空间与会话"><div class="shell-brand"><button data-action="navigate" data-view="workbench" class="shell-brand-name" aria-label="返回当前会话">${icon('compass')}<span>航向 <b>HARNESS</b></span></button><button class="icon-btn collapse-sidebar" data-action="toggle-sidebar" aria-label="展开或收起侧栏">${icon('sliders')}</button></div><button class="new-session-button" data-action="new-session" aria-label="${isSelfWorkspace()?'新一轮研发':'新建会话'}">${icon('plus')}<span>${isSelfWorkspace()?'新一轮研发':'新会话'}</span><kbd>⌘ N</kbd></button><nav class="shell-nav" aria-label="全局入口"><button data-action="navigate" data-view="plugins" class="${view==='plugins'||view==='capabilities'?'active':''}" aria-label="插件">${icon('box')}<span>插件</span></button><button data-action="navigate" data-view="automation" class="${view==='automation'?'active':''}" aria-label="Automation">${icon('clock')}<span>Automation</span>${state.projects.some(p=>p.direction)?'<i class="live-dot"></i>':''}</button><button data-action="shell-more" aria-label="更多功能">${icon('grid')}<span>更多</span></button></nav><div class="workspace-browser-heading"><span>工作空间</span><div class="row"><button class="icon-btn" data-action="command" aria-label="搜索工作空间与会话">${icon('search')}</button><button class="icon-btn" data-action="new-workspace" aria-label="添加工作空间">${icon('folder')}</button></div></div><div class="rail-workspaces"><button class="icon-btn" data-action="expand-workspaces" aria-label="浏览工作空间">${icon('folder')}</button></div><div class="workspace-tree">${state.projects.map(p=>{
  const collapsed=h.collapsedWorkspaces[p.id],sessions=h.sessions.filter(s=>s.workspace===p.id),active=p.id===state.activeProject;
  return `<section class="workspace-group"><div class="workspace-group-heading ${active?'current':''}"><button data-action="toggle-workspace" data-workspace="${esc(p.id)}" class="workspace-fold" aria-label="${collapsed?'展开':'折叠'} ${esc(p.name)}" aria-expanded="${!collapsed}">${icon(collapsed?'chevron':'down')}</button><button data-action="select-workspace" data-workspace="${esc(p.id)}" title="${esc(p.path)}" class="workspace-name">${icon('folder')}<span>${esc(p.name)}${['commerce','weekly'].includes(p.id)?' · 示例':''}</span></button><button class="workspace-new" data-action="workspace-new-session" data-workspace="${esc(p.id)}" aria-label="在 ${esc(p.name)} 新建会话">${icon('plus')}</button></div>${!collapsed?`<div class="workspace-children"><button class="autonomy-tree-row ${active&&isProject?'active':''}" data-action="select-autonomy" data-workspace="${esc(p.id)}" aria-label="${esc(p.name)} 的自主推进">${icon('compass')}<span>${p.direction?'自主推进':'设定长期方向'}</span>${p.direction?`<span class="tree-status ${p.paused?'paused':''}">${p.isReal?(selfData.snapshot?.runtime.ready?'可推进':'待连接'):p.paused?'已暂停':p.isNew||p.id!=='commerce'?'待接入':'进行中'}</span>`:''}</button>${sessions.filter(s=>!s.archived).map(s=>`<button class="tree-session ${active&&view==='workbench'&&s.id===h.activeSession?'active':''}" data-action="open-session" data-session="${esc(s.id)}" aria-label="打开会话：${esc(s.title)}"><span class="tree-session-glyph">${s.owner==='project'?icon('compass'):icon('terminal')}</span><span>${esc(s.title)}</span>${s.status==='running'?'<i class="live-dot"></i>':''}</button>`).join('')}</div>`:''}</section>`;
 }).join('')}</div><footer class="shell-sidebar-footer"><button data-action="navigate" data-view="settings" class="shell-settings ${view==='settings'?'active':''}" aria-label="设置">${icon('settings')}<span>设置</span><span class="settings-hint">⌘ ,</span></button><div class="shell-footnote"><span class="live-dot"></span><span>本地工作空间</span><button data-action="about" aria-label="查看原型说明">${icon('info')}</button></div></footer></aside>`;
}
function renderConversationWorkspace(){
 const s=currentSession(),h=state.harness,p=project(),d=dockState(),v=sessionView();
 return `<section class="conversation-workspace ${d.open&&!d.floating&&!d.fullscreen?'has-dock':''}" style="--dock-width:${Math.max(300,Math.min(800,d.width||520))}px"><section class="conversation-main" aria-label="Harness 会话"><header class="session-header"><button class="icon-btn" data-action="toggle-sidebar" aria-label="展开或收起侧栏">${icon('sliders')}</button><div class="session-heading"><h1>${esc(s.title)}</h1><span>${esc(p.name)}${s.owner==='project'?' · 自主执行':' · 直接会话'}</span></div><div class="grow"></div><button class="icon-btn" data-action="command" aria-label="搜索与快捷操作">${icon('search')}</button><button class="icon-btn" data-action="session-more" aria-label="会话更多操作">${icon('down')}</button>${!d.open?`<button class="icon-btn" data-action="open-tools" aria-label="展开右侧工具区">${icon('monitor')}</button>`:''}</header><div class="session-viewbar"><div role="tablist" aria-label="会话视图"><button role="tab" aria-selected="${v==='chat'}" class="${v==='chat'?'active':''}" data-action="conversation-view" data-view="chat">对话</button><button role="tab" aria-selected="${v==='trajectory'}" class="${v==='trajectory'?'active':''}" data-action="conversation-view" data-view="trajectory">执行轨迹</button><button class="icon-btn" data-action="view-more" aria-label="更多会话视图">${icon('plus')}</button></div><div class="viewbar-right">${v==='chat'?`<label><span>过程</span><select id="work-details" aria-label="工作过程显示方式"><option value="compact" ${h.workDetails==='compact'?'selected':''}>精简</option><option value="standard" ${h.workDetails==='standard'?'selected':''}>标准</option><option value="verbose" ${h.workDetails==='verbose'?'selected':''}>详细</option></select></label>`:''}<span class="view-demo">示例</span></div></div>${p.direction?`<div class="direction-ribbon"><button data-action="open-autonomy" aria-label="查看长期方向">${icon('compass')}<span class="ribbon-label">长期方向</span><span class="ribbon-goal">${esc(p.direction)}</span></button><button data-action="open-autonomy" class="ribbon-state"><i class="live-dot ${state.paused?'paused':''}"></i>${state.paused?'已暂停':p.isNew||p.id!=='commerce'?'等待接入':'自主推进中'}${icon('chevron')}</button></div>`:''}<div class="conversation-target ${v==='trajectory'?'trajectory-target':''}">${v==='trajectory'?renderTrajectory(s):renderChatTarget(s)}</div>${renderComposer(s)}</section>${d.open?renderDock(s,d):''}</section>`;
}
function renderChatTarget(s){
 const details=state.harness.workDetails,tools=s.messages.filter(m=>m.role==='tool').length;
 return `<div id="conversation-feed" class="conversation-feed" data-session="${esc(s.id)}" aria-live="polite">${s.messages.length?`${s.owner==='project'?`<div class="run-origin">${icon('compass')}<span>自主工作 #${esc(s.task.slice(1))} · 运行包 ${esc(s.pack)} · 检查点随执行保留</span><button class="link" data-action="session-task">决策依据</button></div>`:''}${s.messages.map((m,i)=>{if(m.role==='tool'&&details==='compact')return '';let html=renderMessage(m,i);if(m.role==='tool'&&details==='verbose')html=html.replace('<details ','<details open ');return html;}).join('')}${details==='compact'&&tools?`<button class="folded-work" data-action="show-work-details">${icon('chevron')}${tools} 条工具记录已折叠 · 展开查看</button>`:''}${s.messages.length?`<div class="turn-footer">${icon(s.status==='running'?'activity':'check')}<span>${s.status==='running'?'独立验证进行中':s.status==='stopped'?'本轮已停止，检查点保留':'本轮示例记录已展示'}</span><button data-action="conversation-view" data-view="trajectory">检查执行轨迹</button></div>`:''}`:`<div class="conversation-empty"><div class="empty-mark">${icon('compass')}</div><h2>从这里，开始下一件事。</h2><p>调查代码、处理文件，或让 AI 持续推进一个方向。</p><div class="prompt-examples">${['梳理这个仓库的结构','定位导入失败的原因','先分析方案，暂不修改代码'].map(t=>`<button data-action="fill-prompt" data-prompt="${t}">${t}${icon('arrow')}</button>`).join('')}</div></div>`}</div>`;
}
function renderComposer(s){
 return `<div class="composer-region">${s.owner==='human'&&s.messages.length?`<div class="session-handoff"><button class="link" data-action="session-to-project">${icon('compass')}${project().direction?'把这次发现交给自主项目':'建立长期方向'} ${icon('arrow')}</button></div>`:''}<form id="composer-form" class="composer-form"><div class="composer-box">${s.attachment?`<div class="attachment-chip">${icon('file')}${esc(s.attachment)}<button type="button" data-action="remove-attachment" aria-label="移除上下文文件">${icon('close')}</button></div>`:''}<div id="input-suggestions" class="input-suggestions"></div><label class="sr-only" for="session-prompt">${s.owner==='project'?'给自主项目补充上下文':'向 Harness 发送消息'}</label><textarea id="session-prompt" placeholder="${s.owner==='project'?'补充目标与上下文，AI 结合方向继续评估…':'描述想完成的事，/ 选择命令，@ 引用文件或会话…'}" rows="2" maxlength="4000">${esc(s.draft||'')}</textarea><div class="composer-controls"><div class="row"><button type="button" class="icon-btn" data-action="attach-context" aria-label="添加上下文">${icon('plus')}</button><select id="session-mode" aria-label="会话工作方式" ${s.owner==='project'?'disabled':''}><option value="code" ${s.mode==='code'?'selected':''}>默认</option><option value="plan" ${s.mode==='plan'?'selected':''}>仅分析</option><option value="creator" ${s.mode==='creator'?'selected':''}>Creator</option></select><button type="button" class="permission-mode" data-action="session-permissions">${icon('shield')}工作区权限</button></div><div class="row"><select id="session-model" aria-label="当前会话模型" ${s.owner==='project'?'disabled':''}>${state.harness.models.map(m=>`<option value="${esc(m.id)}" ${s.model===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>${s.status==='running'?`<button type="button" class="stop-turn" data-action="stop-session" aria-label="停止本轮">${icon('pause')}</button>`:''}<button type="submit" class="send-btn" aria-label="${s.owner==='project'?'提交补充上下文':'发送消息'}">${icon('arrow')}</button></div></div></div><p class="composer-hint">交互原型 · 消息、工具与执行均为示例　${s.owner==='project'?'补充内容作为线索保存':'⌘ / Ctrl + Enter 发送'}</p></form></div>`;
}
function traceRecords(s){return s.messages.map((m,i)=>({id:i,kind:m.role==='user'?'input':m.role==='tool'?'tool':m.role==='system'?'context':'model',label:{user:'USER',assistant:'ASSISTANT',tool:'TOOL',system:'CONTEXT'}[m.role]||'EVENT',text:m.text,role:m.role}));}
function renderTrajectory(s){
 const records=traceRecords(s),filtered=records.filter(r=>(traceFilter==='all'||r.kind===traceFilter)&&r.text.toLowerCase().includes(traceQuery.toLowerCase())),selected=filtered.find(r=>r.id===traceSelection)||filtered[0];
 return `<section class="trajectory" aria-label="执行轨迹"><div class="trace-toolbar"><div class="trace-filters">${[['all','全部'],['input','输入'],['model','模型'],['tool','工具']].map(([k,n])=>`<button data-action="trace-filter" data-filter="${k}" class="${traceFilter===k?'active':''}" aria-pressed="${traceFilter===k}">${n}</button>`).join('')}</div><label class="trace-search">${icon('search')}<input id="trace-search" value="${esc(traceQuery)}" aria-label="搜索执行事件" placeholder="搜索记录"></label></div><div class="timing-overview" aria-label="示例事件顺序概览">${[['input','输入'],['model','模型'],['tool','工具']].map(([kind,title])=>`<div class="timing-lane"><span>${title}</span><div class="timing-track">${records.map(r=>`<span class="timing-cell">${r.kind===kind?`<button class="timing-mark ${kind} ${selected?.id===r.id?'selected':''}" data-action="trace-record" data-record="${r.id}" aria-label="定位事件 ${r.id+1}：${r.label}"></button>`:''}</span>`).join('')}</div></div>`).join('')}<p>按示例事件顺序展示 · 未连接真实耗时与 Token 数据</p></div><div class="trace-body"><div class="trace-ledger" role="list" aria-label="会话事件">${filtered.length?filtered.map(r=>`<button role="listitem" class="trace-record ${selected?.id===r.id?'selected':''}" data-action="trace-record" data-record="${r.id}" aria-label="事件 ${r.id+1}：${r.label}"><span class="trace-index">${String(r.id+1).padStart(2,'0')}</span><span class="trace-kind ${r.kind}">${r.label}</span><span class="trace-text">${esc(r.text)}</span></button>`).join(''):'<div class="empty">没有匹配的事件</div>'}</div>${selected?`<aside class="trace-inspector" aria-label="事件详情"><div class="trace-detail-heading"><span class="trace-kind ${selected.kind}">${selected.label}</span><span>事件 ${selected.id+1}</span></div><div class="trace-detail-tabs" role="tablist" aria-label="事件详情类型">${[['summary','概要'],['payload','输入'],['result','输出'],['timing','时序']].map(([k,n])=>`<button role="tab" aria-selected="${traceDetail===k}" data-action="trace-detail-tab" data-tab="${k}" class="${traceDetail===k?'active':''}">${n}</button>`).join('')}</div><div class="trace-detail-content">${traceDetailContent(selected,s)}</div></aside>`:''}</div></section>`;
}
function traceDetailContent(r,s){
 if(traceDetail==='summary')return `<dl><dt>所属会话</dt><dd>${esc(s.title)}</dd><dt>来源</dt><dd>${s.owner==='project'?'自主项目 · 工作 #'+esc(s.task.slice(1)):'直接会话'}</dd><dt>运行包</dt><dd>${esc(s.pack)}</dd><dt>记录类型</dt><dd>${r.label}</dd></dl><div class="trace-preview">${esc(r.text)}</div>`;
 if(traceDetail==='payload')return `<div class="eyebrow">示例事件字段</div><pre>${esc(JSON.stringify({sequence:r.id+1,type:r.role,text:r.text,example:true},null,2))}</pre>`;
 if(traceDetail==='result')return `<div class="eyebrow">已展示内容</div><pre>${esc(r.text)}</pre><p class="tiny muted">当前没有真实工具返回值或模型响应对象。</p>`;
 return `<dl><dt>顺序</dt><dd>第 ${r.id+1} 条示例事件</dd><dt>实际开始时间</dt><dd>尚未接入</dd><dt>执行耗时</dt><dd>尚未接入</dd><dt>Token 用量</dt><dd>尚未接入</dd></dl>`;
}
function renderDock(s,d){
 const autoFullscreen=matchMedia('(max-width:767px)').matches;
 if(!d.tabs.length){d.tabs=[{id:'guide',kind:'guide',title:'工具'}];d.active='guide';}
 const active=d.tabs.find(t=>t.id===d.active)||d.tabs[0],second=d.tabs.find(t=>t.id===d.second);
 return `<aside class="dock-surface ${d.split&&second?'is-split':''} ${d.fullscreen||autoFullscreen?'is-fullscreen':''} ${d.floating&&!autoFullscreen?'is-floating':''}" aria-label="右侧工具区" style="${d.floating?`left:${d.x??'auto'}${d.x!=null?'px':''};top:${d.y??112}px;`:''}">${!d.fullscreen&&!d.floating?'<div class="dock-resize" data-dock-resize role="separator" aria-label="调整工具区宽度" tabindex="0"></div>':''}<div class="dock-topline" data-dock-drag><div class="dock-tabstrip" role="tablist" aria-label="工具标签">${d.tabs.map(t=>`<div class="dock-tab ${active.id===t.id?'active':''}"><button role="tab" aria-selected="${active.id===t.id}" data-action="dock-select" data-tab="${esc(t.id)}">${icon(t.kind==='terminal'?'terminal':t.kind==='browser'?'monitor':t.kind==='guide'?'grid':t.kind==='changes'?'git':'file')}<span>${esc(t.title)}</span></button><button data-action="dock-close-tab" data-tab="${esc(t.id)}" aria-label="关闭标签 ${esc(t.title)}">${icon('close')}</button></div>`).join('')}</div><div class="dock-window-actions"><button class="icon-btn" data-action="dock-add" aria-label="添加工具标签">${icon('plus')}</button><button class="icon-btn" data-action="dock-menu" aria-label="工具区布局">${icon('grid')}</button><button class="icon-btn" data-action="dock-fullscreen" aria-label="${d.fullscreen||autoFullscreen?'退出工具区全屏':'工具区全屏'}">${icon('expand')}</button><button class="icon-btn" data-action="dock-hide" aria-label="收起右侧工具区">${icon('close')}</button></div></div><div class="dock-panes"><section class="dock-pane" aria-label="工具主面板"><div class="dock-pane-content">${dockTabContent(active,s,d)}</div></section>${d.split&&second?`<section class="dock-pane dock-second" aria-label="工具第二面板"><div class="dock-second-head"><span>${esc(second.title)}</span><button class="icon-btn" data-action="dock-unsplit" aria-label="关闭第二面板">${icon('close')}</button></div><div class="dock-pane-content">${dockTabContent(second,s,d)}</div></section>`:''}</div></aside>`;
}
function dockTabContent(tab,s,d){
 if(s.isReal)return renderSelfDock(tab);
 if(tab.kind==='guide')return `<div class="dock-guide"><h2>打开一个工具</h2><p>文件、终端与插件页面跟随当前会话。</p><div class="dock-guide-grid">${[['files','folder','工作区文件'],['terminal','terminal','终端'],['browser','monitor','浏览器'],['changes','git','代码变更'],['plan','target','执行计划'],['extensions','box','插件视图']].map(([k,i,t])=>`<button data-action="dock-open-kind" data-kind="${k}">${icon(i)}<span>${t}</span>${icon('arrow')}</button>`).join('')}</div><button class="link" data-action="creator-draft" data-region="rightbar">${icon('spark')}创建一个工具插件</button><p class="dock-guide-note">交互示例 · 原生客户端将保留并适配 Harness 的插件宿主与工具节点。</p></div>`;
 if(tab.kind==='document')return `<div class="document-preview"><div class="document-path">${icon('file')}${esc(tab.file)}</div><pre>${esc(tab.file==='README.md'?'# 商家数据助手\n\n导入数据、校验字段、生成经营分析。\n\n当前内容为预览示例。':tab.file?.includes('header')?'// 示例源码\nexport function normalizeHeader(raw) {\n  return {\n    original: raw,\n    name: resolveAlias(raw.trim())\n  };\n}':'// 示例预览\n// '+tab.file)}</pre><button class="link" data-action="dock-attach-file" data-file="${esc(tab.file)}">作为会话上下文 ${icon('plus')}</button></div>`;
 if(tab.kind==='quality')return `<div class="plugin-quality"><span class="pill">插件组件 · 示例</span><h2>导入质量概况</h2><p>组件数据为示例；正式接入后显示所属项目的检测结果。</p><div class="quality-metric"><strong>48</strong><span>项示例检查通过</span></div><div class="criteria">${icon('check')}原始字段保留</div><div class="criteria">${icon('clock')}完整流程继续验证</div><button class="link" data-action="preview-widget">显示浮动组件 ${icon('expand')}</button></div>`;
 const oldTab=inspectorTab,oldFile=selectedFile;inspectorTab=tab.kind;selectedFile=d.file||'src/import/header.ts';
 const content=inspectorContent(s);inspectorTab=oldTab;selectedFile=oldFile;
 return `<div class="dock-provider-content">${content}</div>`;
}
function pluginsPage(){
 const tabs=[['installed','已安装'],['discover','发现'],['configuration','模型与配置']];
 return `<div class="plugins-page">${pageHeading('插件','通过可组合的插件扩展工具、运行方式与界面。',button('添加插件','add-plugin','','plus')+button('Creator','creator-draft','primary','spark'),'HARNESS EXTENSIONS')}<div class="surface-tabs" role="tablist" aria-label="插件页面">${tabs.map(([k,n])=>`<button role="tab" aria-selected="${pluginTab===k}" data-action="plugin-page-tab" data-tab="${k}" class="${pluginTab===k?'active':''}">${n}</button>`).join('')}</div>${pluginTab==='installed'?renderInstalledPlugins():pluginTab==='discover'?renderPluginDiscovery():`<div class="configuration-tabs">${[['models','模型'],['tools','工具与权限'],['skills','Skills'],['mcp','MCP']].map(([k,n])=>`<button data-action="capability-tab" data-tab="${k}" class="${capabilityTab===k?'active':''}">${n}</button>`).join('')}</div><p class="configuration-note">配置交互示例，不保存真实 API Key，不向外部服务发出请求。</p>${capabilityContent()}`}</div>`;
}
function renderInstalledPlugins(){
 const h=state.harness,plugins=[['teams','grid','Agent Teams','团队协作、成员与共享任务。',true],['review','shield','自动审批复核','按策略检查需要授权的操作。',true],['schedule','clock','定时任务','按约定时间运行明确的工作。',true],['voice','activity','语音输入','提供另一种输入方式。',true],['terminal','terminal','Terminal','命令与持久终端能力。',false],['loop','refresh','Agent Loop','模型请求、工具调度与执行循环。',false],['subagents','branch','Subagents','委派子任务并检查其执行记录。',false]];
 return `<div class="plugin-catalog-note">当前是原型中的能力目录，开关不会安装或加载实际插件。</div><h2 class="plugin-section-label">运行包内置 <span>${plugins.length}</span></h2><div class="builtin-plugin-list">${plugins.map(([id,i,n,desc,beta])=>`<article class="builtin-plugin"><div class="plugin-logo">${icon(i)}</div><div class="grow"><h3>${n}${beta?'<span class="beta-tag">实验性</span>':''}</h3><p>${desc}</p></div>${['terminal','loop','subagents'].includes(id)?button('配置','configure-plugin','ghost','settings',`data-plugin="${id}"`):`<button role="switch" aria-checked="${!!h.builtinPlugins[id]}" data-action="builtin-plugin-toggle" data-plugin="${id}" aria-label="${h.builtinPlugins[id]?'停用':'启用'} ${n}" class="skill-toggle"><span></span></button>`}</article>`).join('')}</div><h2 class="plugin-section-label">自定义扩展</h2><div class="custom-plugin-card"><div class="plugin-logo">${icon('compass')}</div><div class="grow"><h3>持续自主研发</h3><p>沿用 Harness 工作空间与会话，增加方向、独立验证和交付反馈。</p></div>${pill('产品扩展示例')}</div>${h.installed.map(n=>`<div class="custom-plugin-card"><div class="plugin-logo">${icon('box')}</div><div class="grow"><h3>${esc(n)}</h3><p>等待运行包认证，尚未安装。</p></div>${pill('待验证','amber')}</div>`).join('')}<section class="plugin-customization"><div><h3>界面，也可以按工作方式扩展。</h3><p>从会话视图、右侧工具到浮动组件，保留插件的展示位置。</p></div><div class="row">${button('预览插件组件','preview-quality','','monitor')}${button('创建界面插件','creator-draft','ghost','spark','data-region="interface"')}</div></section>`;
}
function renderPluginDiscovery(){return `<div class="plugin-discovery-intro"><h2>选择现有扩展，或让 Creator 创建。</h2><p>这里展示目录交互，不连接插件市场或安装软件。</p></div><div class="plugin-discovery-grid">${[['book','代码规范复核','把仓库约定带入变更检查。'],['activity','导入监测视图','在工具区持续观察数据导入质量。'],['file','经营报告工作流','整理文件与分析结果，形成可预览的报告。']].map(([i,n,t])=>`<section><div class="plugin-logo">${icon(i)}</div><h3>${n}</h3><p>${t}</p>${button(n==='导入监测视图'?'预览界面':'查看扩展位置',n==='导入监测视图'?'preview-quality':'creator-draft','ghost','arrow')}</section>`).join('')}</div>`;}
function automationPage(){
 const h=state.harness,projects=state.projects.filter(p=>p.direction);
 return `${pageHeading('Automation','让已明确的工作按时运行，让长期方向持续推进。',button('添加定时任务','new-schedule','','plus'),'BACKGROUND WORK')}<div class="surface-tabs" role="tablist" aria-label="自动化类型">${[['autonomy','自主推进'],['scheduled','定时任务']].map(([k,n])=>`<button role="tab" aria-selected="${automationTab===k}" data-action="automation-tab" data-tab="${k}" class="${automationTab===k?'active':''}">${n}</button>`).join('')}</div>${automationTab==='autonomy'?`<p class="automation-intro">人定义方向、边界与资源，AI 从反馈中选择工作并完成研发循环。</p><div class="autonomy-list">${projects.length?projects.map(p=>`<button data-action="select-autonomy" data-workspace="${esc(p.id)}"><div class="automation-icon">${icon('compass')}</div><div class="grow"><h2>${esc(p.name)}</h2><p>${esc(p.direction)}</p><small>方向 v${p.version} · ${p.isReal?'真实控制器 · '+(selfData.snapshot?.metrics.integrated||0)+' 轮自主整合':(p.budget||60)+' 元 / 天 · '+(p.isNew||p.id!=='commerce'?'等待环境接入':'1 项执行 · 2 项已交付（示例）')}</small></div>${p.isReal?pill(selfData.snapshot?.runtime.ready?'可推进':'待连接','amber'):pill(p.paused?'已暂停':p.isNew||p.id!=='commerce'?'待接入':'持续推进',p.paused?'amber':'green')}${icon('chevron')}</button>`).join(''):'<div class="empty">还没有长期方向</div>'}</div><div class="automation-footer">${icon('folder')}也可以从任意工作空间的“设定长期方向”开始。</div>`:`<p class="automation-intro">按指定时间触发一项明确任务；自主推进由目标与反馈驱动，分别管理。</p><div class="schedule-list">${h.schedules.length?h.schedules.map(t=>`<article><div class="automation-icon">${icon('clock')}</div><div class="grow"><h2>${esc(t.title)}</h2><p>${esc(t.frequency)}</p><small>${esc(state.projects.find(p=>p.id===t.workspace)?.name||'未指定工作空间')} · 示例配置</small></div><button role="switch" aria-checked="${t.enabled}" class="skill-toggle" data-action="toggle-schedule" data-schedule="${esc(t.id)}" aria-label="${t.enabled?'暂停':'启用'} ${esc(t.title)}"><span></span></button><button class="icon-btn" data-action="schedule-detail" data-schedule="${esc(t.id)}" aria-label="查看 ${esc(t.title)}">${icon('chevron')}</button></article>`).join(''):'<div class="empty">还没有定时任务</div>'}</div><div class="automation-footer">${icon('info')}原型只保存示例计划，不会创建系统计划或实际触发任务。</div>`}`;
}
function creatorDraft(region='interface'){
 const target=region==='rightbar'?'右侧工具区':region==='conversation'?'会话视图':'可扩展的界面';const s=makeSession(false);s.title='创建 '+(region==='conversation'?'会话视图插件':region==='rightbar'?'工具插件':'界面插件');s.mode='creator';
 s.draft='为当前 Harness 创建一个'+target+'插件，用于观察项目导入质量。请先调查现有插件接口，给出方案，再在允许的范围内实现并验证。';
 state.harness.mobileSidebar=false;view='workbench';closeOverlay();persist();render();document.getElementById('session-prompt')?.focus();toast('Creator 草稿已准备，尚未发送或安装插件。');
}
function renderPluginWidget(){return `<aside class="plugin-widget" aria-label="插件浮动组件示例"><header><span>${icon('activity')}导入监测</span><button class="icon-btn" data-action="hide-widget" aria-label="关闭浮动组件">${icon('close')}</button></header><div class="widget-value">48 <span>项检查通过</span></div><p>组件展示示例 · 未连接项目数据</p><footer>插件组件示例${button('在工具区打开','preview-quality','ghost','arrow')}</footer></aside>`;}
function shellPaletteResults(query){
 const entries=[{t:'新建会话',i:'plus',a:'new-session',hint:'会话'},{t:'插件',i:'box',a:'palette-navigate',v:'plugins',hint:'全局'},{t:'Automation',i:'clock',a:'palette-navigate',v:'automation',hint:'全局'},{t:'设置',i:'settings',a:'palette-navigate',v:'settings',hint:'桌面'},{t:'运行环境',i:'monitor',a:'palette-navigate',v:'runtime',hint:'桌面'},{t:'添加工作空间',i:'folder',a:'new-workspace',hint:'目录'},{t:'创建界面插件',i:'spark',a:'creator-draft',hint:'Creator'},...nav.map(([v,i,t])=>({t,i,a:'palette-navigate',v,hint:'当前自主项目'})),...state.harness.sessions.filter(s=>!s.archived).map(s=>({t:s.title,i:s.owner==='project'?'compass':'terminal',a:'open-session',session:s.id,hint:state.projects.find(p=>p.id===s.workspace)?.name||'会话'}))];
 const found=entries.filter(e=>e.t.toLowerCase().includes(query.toLowerCase()));
 return found.length?found.map(e=>`<button class="palette-result" data-action="${e.a}" ${e.v?`data-view="${e.v}"`:''} ${e.session?`data-session="${esc(e.session)}"`:''}>${icon(e.i)}<span>${esc(e.t)}</span><span class="hint">${esc(e.hint)}</span></button>`).join(''):'<div class="empty">没有匹配的页面或会话</div>';
}
function shellMenu(title,items,note=''){
 modal(title,'',`<div class="shell-menu-items">${items.map(([text,action,ic,data=''])=>button(text,action,'ghost',ic,data)).join('')}</div>${note?`<p class="tiny muted" style="margin-top:14px;line-height:1.9">${note}</p>`:''}`,button('关闭','close-overlay'));
}
function shellDesignNotes(){
 return `${pageHeading('沿用 Harness，加入持续自主研发。','v1.4 · 根据官方界面演示、插件与 Trajectory 截图，以及客户端模块说明修正。','','DESIGN REFERENCE')}<div class="design-note-grid">${[
  ['folder','单一侧栏','全局保留新会话、插件和 Automation。工作空间与会话在一个目录树中，长期方向和自主推进挂在所属工作空间下。'],
  ['activity','同一会话，不同视图','对话与执行轨迹显示同一次执行。工具过程可折叠；事件明细与项目的验收证据分别保留，不把模型回复结束当作交付成功。'],
  ['monitor','按需展开工具区','右侧提供文件、文档、终端、浏览器和插件标签，可分屏、浮动与全屏。标签和草稿跟随会话保存；改变布局不创建新的执行。'],
  ['box','界面同样可以扩展','保留 Creator 草稿、会话视图、右侧工具与浮动组件的接入位置。正式客户端应保留并适配上游客户端插件宿主，而非只复用后端调用。'],
  ['compass','人掌握方向','长期方向在会话顶部保持可见。AI 根据目标、证据和反馈选择工作；人可调整方向与边界，具体研发和常规交付在范围内自主推进。'],
  ['shield','桌面与运行包分开','Tauri 2 为拟定的桌面宿主。窗口、托盘和进程生命周期通过桥接适配；旧会话继续绑定原运行包及匹配的客户端插件。']
 ].map(([i,n,d])=>`<section class="card design-note">${icon(i)}<h3>${n}</h3><p>${d}</p></section>`).join('')}</div><section class="card card-pad" style="margin-top:23px"><h2>设计参考与实现范围</h2><p class="small muted" style="margin-top:13px;line-height:1.95">已查看 <a href="https://www.deepseek.com/en/harness/" target="_blank" rel="noreferrer">官方界面演示</a>，并核对 ui-sidebar、ui-conversation、ui-trajectory 与 ui-sidebar-right 的职责。这里展示的是本产品的静态交互原型，未引入或运行上游客户端代码。</p><p class="small muted" style="margin-top:12px;line-height:1.95">会话回复、文件、终端、插件目录、计划、验证和交付均为示例。尚未接入模型、Harness、Git 或操作系统，也没有创建真实定时任务、安装插件或打包 Tauri 客户端。</p></section>`;
}
function handleShellAction(el){
 const a=el.dataset.action,h=state.harness,s=currentSession();
 const rerender=()=>{persist();render();};
 switch(a){
 case 'navigate':case 'palette-navigate':h.mobileSidebar=false;return false;
 case 'toggle-sidebar':if(matchMedia('(max-width:1023px)').matches){h.mobileSidebar=!h.mobileSidebar;h.sidebarCollapsed=false;}else h.sidebarCollapsed=!h.sidebarCollapsed;rerender();return true;
 case 'dismiss-sidebar':h.mobileSidebar=false;render();return true;
 case 'expand-workspaces':h.sidebarCollapsed=false;h.mobileSidebar=true;render();return true;
 case 'toggle-workspace':h.collapsedWorkspaces[el.dataset.workspace]=!h.collapsedWorkspaces[el.dataset.workspace];rerender();return true;
 case 'select-workspace':activateWorkspace(el.dataset.workspace);h.mobileSidebar=false;view='workbench';rerender();return true;
 case 'workspace-new-session':activateWorkspace(el.dataset.workspace);h.mobileSidebar=false;makeSession(false);view='workbench';rerender();return true;
 case 'select-autonomy':activateWorkspace(el.dataset.workspace);h.mobileSidebar=false;closeOverlay();if(project().direction){view='overview';render();}else enableAutonomy();persist();return true;
 case 'open-session':openSessionById(el.dataset.session);return true;
 case 'shell-more':shellMenu('更多功能',[['搜索工作空间与会话','command','search'],['Creator：创建界面插件','creator-draft','spark'],['归档会话','archived-sessions','history'],['运行环境','palette-navigate','monitor','data-view="runtime"'],['设计说明','palette-navigate','info','data-view="notes"']]);return true;
 case 'session-more':shellMenu('会话操作',[['重命名会话','rename-session','file'],['创建分支会话','fork-session','branch'],...(s.status!=='running'?[['归档会话','archive-session','box']]:[]),['查看当前权限','session-permissions','shield'],['把发现交给自主项目','session-to-project','compass'],['在插件页管理能力','palette-navigate','box','data-view="plugins"']],'会话归属和运行包保持不变。原型不修改实际权限。');return true;
 case 'rename-session':modal('重命名会话','保持会话归属、历史与运行包不变。',`<form id="rename-session-form"><div class="field"><label for="session-title">会话名称</label><input id="session-title" name="title" required maxlength="80" value="${esc(s.title)}"></div></form>`,`${button('取消','close-overlay')}<button class="btn primary" type="submit" form="rename-session-form">保存名称</button>`);return true;
 case 'fork-session':{const fork=makeSession(false);Object.assign(fork,{title:s.title+' · 分支',owner:'human',pack:s.pack,messages:structuredClone(s.messages),draft:'',sourceSession:s.id});closeOverlay();view='workbench';rerender();toast('已复制示例会话记录，没有复制执行进程或真实工作树。');return true;}
 case 'archive-session':if(s.status==='running')return true;s.archived=true;h.activeSession='';ensureWorkspaceSession();closeOverlay();rerender();toast('会话已归档，可在“更多”中恢复。');return true;
 case 'archived-sessions':modal('归档会话','可恢复当前原型中的归档记录。',`<div class="shell-menu-items">${h.sessions.filter(s=>s.archived).map(s=>button(esc(s.title),'restore-archive','ghost','history',`data-session="${esc(s.id)}"`)).join('')||'<p class="small muted">暂无归档会话。</p>'}</div>`,button('关闭','close-overlay'));return true;
 case 'restore-archive':{const target=h.sessions.find(s=>s.id===el.dataset.session);if(target){target.archived=false;openSessionById(target.id);}return true;}
 case 'view-more':shellMenu('扩展会话视图',[['浏览更多插件','palette-navigate','box','data-view="plugins"'],['Creator：创建一个会话视图','creator-draft','spark','data-region="conversation"']],'正式客户端通过 Harness 的会话视图注册机制挂载已认证扩展。');return true;
 case 'conversation-view':closeOverlay();h.sessionViews[s.id]=el.dataset.view;rerender();return true;
 case 'show-work-details':h.workDetails='verbose';rerender();return true;
 case 'trace-filter':traceFilter=el.dataset.filter;render();return true;
 case 'trace-record':traceSelection=Number(el.dataset.record);if(el.classList?.contains('timing-mark'))traceFilter='all';render();return true;
 case 'trace-detail-tab':traceDetail=el.dataset.tab;render();return true;
 case 'open-tools':{const d=dockState();d.open=true;if(!d.tabs.length){d.tabs=[{id:'guide',kind:'guide',title:'工具'}];d.active='guide';}rerender();return true;}
 case 'dock-open-kind':closeOverlay();openDockTab(el.dataset.kind,{second:!!el.closest?.('.dock-second')});return true;
 case 'dock-select':{const d=dockState();if(d.split&&d.second===el.dataset.tab)d.second=d.active;d.active=el.dataset.tab;rerender();return true;}
 case 'dock-close-tab':{const d=dockState();d.tabs=d.tabs.filter(t=>t.id!==el.dataset.tab);if(d.active===el.dataset.tab)d.active=d.tabs[0]?.id;if(d.second===el.dataset.tab){d.second=null;d.split=false;}if(!d.tabs.length){d.open=false;d.split=false;d.floating=false;d.fullscreen=false;}rerender();return true;}
 case 'dock-hide':dockState().open=false;rerender();return true;
 case 'dock-add':shellMenu('添加工具标签',[['工作区文件','dock-open-kind','folder','data-kind="files"'],['终端','dock-open-kind','terminal','data-kind="terminal"'],['浏览器','dock-open-kind','monitor','data-kind="browser"'],['代码变更','dock-open-kind','git','data-kind="changes"'],['插件视图','dock-open-kind','box','data-kind="extensions"']]);return true;
 case 'dock-fullscreen':{closeOverlay();const d=dockState();if(matchMedia('(max-width:767px)').matches)d.open=false;else{d.fullscreen=!d.fullscreen;d.floating=false;}rerender();return true;}
 case 'dock-menu':{const d=dockState();shellMenu('工具区布局',[[d.split?'取消分屏':'上下分屏','dock-split','grid'],[d.floating?'停靠到右侧':'浮动窗口','dock-float','monitor'],[d.fullscreen?'退出全屏':'全屏查看','dock-fullscreen','expand']],'工具内容跟随当前会话，改变布局不重新启动执行。');return true;}
 case 'dock-split':{const d=dockState();closeOverlay();if(d.split){d.split=false;}else{if(d.tabs.length<2){const kind=d.active==='guide'?'files':'guide';d.tabs.push({id:kind,kind,title:kind==='guide'?'工具':'工作区文件'});}d.second=d.tabs.find(t=>t.id!==d.active)?.id;d.split=!!d.second;}rerender();return true;}
 case 'dock-unsplit':dockState().split=false;rerender();return true;
 case 'dock-float':{const d=dockState();closeOverlay();d.floating=!d.floating;d.fullscreen=false;rerender();return true;}
 case 'inspect-file':dockState().file=el.dataset.file;openDockTab('document',{file:el.dataset.file,second:!!el.closest?.('.dock-second')});return true;
 case 'inspector-tab':openDockTab(el.dataset.tab);return true;
 case 'dock-attach-file':s.attachment=el.dataset.file;rerender();toast('已添加示例上下文，没有读取真实文件。');return true;
 case 'attach-inspected-file':s.attachment=dockState().file;rerender();return true;
 case 'plugin-page-tab':pluginTab=el.dataset.tab;render();return true;
 case 'creator-draft':creatorDraft(el.dataset.region);return true;
 case 'builtin-plugin-toggle':h.builtinPlugins[el.dataset.plugin]=!h.builtinPlugins[el.dataset.plugin];rerender();toast('已保存原型开关；未加载或卸载真实插件。');return true;
 case 'configure-plugin':pluginConfiguration(el.dataset.plugin);return true;
 case 'automation-tab':automationTab=el.dataset.tab;render();return true;
 case 'toggle-schedule':{const t=h.schedules.find(t=>t.id===el.dataset.schedule);if(t)t.enabled=!t.enabled;rerender();return true;}
 case 'new-schedule':scheduleEditor();return true;
 case 'schedule-detail':{const t=h.schedules.find(t=>t.id===el.dataset.schedule);if(t)modal(t.title,t.frequency,`<p>${esc(t.prompt)}</p><div class="help-box" style="margin-top:18px">这是示例计划，未创建系统定时任务。</div>`,button('关闭','close-overlay'));return true;}
 case 'extension-view':if(el.dataset.id==='creator'){creatorDraft();}else{view='automation';automationTab='scheduled';closeOverlay();render();}return true;
 case 'preview-quality':h.showWidget=false;view='workbench';closeOverlay();openDockTab('quality');return true;
 case 'preview-widget':h.showWidget=true;rerender();return true;
 case 'hide-widget':h.showWidget=false;rerender();return true;
 case 'insert-command':insertComposerCommand(el.dataset.command);return true;
 case 'insert-reference':{s.attachment=el.dataset.reference;s.draft=(s.draft||'').replace(/@[\w\u4e00-\u9fff.\/-]*$/,'@'+el.dataset.reference+' ');rerender();document.getElementById('session-prompt')?.focus();return true;}
 default:return false;
 }
}
function pluginConfiguration(id){
 const names={loop:'Agent Loop',terminal:'Terminal',subagents:'Subagents'},values=state.harness.pluginConfig||{};
 modal(names[id]+' · 配置示例','只保存演示偏好，不修改运行包或已有会话。',`<form id="plugin-config-form"><input type="hidden" name="plugin" value="${id}"><div class="field"><label for="plugin-number">${id==='loop'?'工具并发上限':id==='terminal'?'单次命令时间预算（秒）':'子代理数量上限'}</label><input id="plugin-number" name="value" type="number" min="1" max="${id==='terminal'?600:16}" required value="${values[id]||(id==='terminal'?60:4)}"></div><div class="help-box">正式实现以固定运行包的实际配置 schema 为准，变更需明确作用于后续执行。</div></form>`,`${button('取消','close-overlay')}<button class="btn primary" form="plugin-config-form" type="submit">保存示例配置</button>`);
}
function scheduleEditor(){
 modal('添加定时任务','原型只保存任务描述和时间，不会设置真实计划。',`<form id="schedule-form"><div class="field"><label for="schedule-title">任务名称</label><input id="schedule-title" name="title" maxlength="80" required></div><div class="field"><label for="schedule-workspace">工作空间</label><select id="schedule-workspace" name="workspace">${state.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===state.activeProject?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label for="schedule-prompt">要执行什么？</label><textarea id="schedule-prompt" name="prompt" required maxlength="1000" rows="3"></textarea></div><div class="field"><label for="schedule-frequency">执行时间（Asia/Shanghai）</label><select id="schedule-frequency" name="frequency"><option>每个工作日 09:00 · Asia/Shanghai</option><option>每周五 17:00 · Asia/Shanghai</option></select></div></form>`,`${button('取消','close-overlay')}<button class="btn primary" form="schedule-form" type="submit">保存示例计划</button>`);
}
function insertComposerCommand(command){
 const s=currentSession();if(s.owner==='project'&&command!=='permissions'){toast('自主执行的工作方式由项目策略管理；可补充上下文或查看方向。');return;}s.draft=(s.draft||'').replace(/\/[\w-]*$/,'');
 if(command==='plan')s.mode='plan';if(command==='creator')s.mode='creator';persist();render();
 if(command==='permissions')handleAction({dataset:{action:'session-permissions'}});else document.getElementById('session-prompt')?.focus();
}
function renderInputSuggestions(value){
 const seat=document.getElementById('input-suggestions');if(!seat)return;
 const command=value.match(/(?:^|\s)\/([\w-]*)$/),reference=value.match(/(?:^|\s)@([\w\u4e00-\u9fff.\/-]*)$/);
 if(command){const entries=[['plan','仅分析，先形成方案'],['permissions','查看会话权限'],['creator','切换 Creator 模式']].filter(([c])=>(currentSession().owner!=='project'||c==='permissions')&&c.includes(command[1]));seat.innerHTML=entries.map(([c,n])=>`<button type="button" data-action="insert-command" data-command="${c}"><code>/${c}</code><span>${n}</span></button>`).join('');}
 else if(reference){const q=reference[1].toLowerCase(),files=['README.md','src/import/header.ts',...workspaceSessions().map(s=>s.title)].filter(n=>n.toLowerCase().includes(q));seat.innerHTML=files.slice(0,5).map(n=>`<button type="button" data-action="insert-reference" data-reference="${esc(n)}">${icon('file')}<span>${esc(n)}</span><small>引用示例</small></button>`).join('');}
 else seat.innerHTML='';
}
document.addEventListener('change',event=>{if(event.target.id==='work-details'){state.harness.workDetails=event.target.value;persist();render();}});
document.addEventListener('input',event=>{
 if(!event.isComposing&&event.target.id==='session-prompt')renderInputSuggestions(event.target.value);
 if(event.target.id==='trace-search'){
  const start=event.target.selectionStart;traceQuery=event.target.value;render();const n=document.getElementById('trace-search');n?.focus();n?.setSelectionRange(start,start);
 }
});
document.addEventListener('submit',event=>{
 if(event.target.id==='rename-session-form'){event.preventDefault();const title=String(new FormData(event.target).get('title')).trim();if(!title)return;currentSession().title=title;persist();closeOverlay();render();}
 if(event.target.id==='plugin-config-form'){
  event.preventDefault();const f=new FormData(event.target);state.harness.pluginConfig=state.harness.pluginConfig||{};state.harness.pluginConfig[f.get('plugin')]=Number(f.get('value'));persist();closeOverlay();render();toast('示例配置已保存，未影响实际运行。');
 }
 if(event.target.id==='schedule-form'){
  event.preventDefault();const f=new FormData(event.target),title=String(f.get('title')).trim(),prompt=String(f.get('prompt')).trim();if(!title||!prompt)return;
  state.harness.schedules.push({id:'schedule-'+Date.now(),title,prompt,workspace:String(f.get('workspace')),frequency:String(f.get('frequency')),enabled:true});automationTab='scheduled';view='automation';persist();closeOverlay();render();toast('已保存示例计划；不会实际触发任务。');
 }
});
document.addEventListener('keydown',event=>{if(event.isComposing)return;
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'&&!event.shiftKey&&!overlay){event.preventDefault();handleAction({dataset:{action:'new-session'}});}
 if((event.metaKey||event.ctrlKey)&&event.key===','&&!overlay){event.preventDefault();view='settings';render();}
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='b'&&!overlay){event.preventDefault();handleShellAction({dataset:{action:'toggle-sidebar'}});}
 if(event.key==='Escape'&&!overlay){state.harness.mobileSidebar=false;const d=currentSession()&&dockState();if(d&&matchMedia('(max-width:767px)').matches&&d.open)d.open=false;else if(d&&(d.fullscreen||d.floating)){d.fullscreen=false;d.floating=false;}render();}
 if(event.target.matches('[data-dock-resize]')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const d=dockState();d.width=Math.max(300,Math.min(innerWidth*.7,d.width+(event.key==='ArrowLeft'?40:-40)));persist();render();}
});
let dockDrag=null;
document.addEventListener('pointerdown',event=>{
 const resize=event.target.closest('[data-dock-resize]'),move=event.target.closest('[data-dock-drag]');
 if(resize){event.preventDefault();dockDrag={type:'resize',element:resize.closest('.conversation-workspace')};resize.setPointerCapture?.(event.pointerId);}
 else if(move&&dockState().floating&&!event.target.closest('button')){const rect=move.closest('.dock-surface').getBoundingClientRect();dockDrag={type:'move',element:move.closest('.dock-surface'),dx:event.clientX-rect.left,dy:event.clientY-rect.top};move.setPointerCapture?.(event.pointerId);}
});
document.addEventListener('pointermove',event=>{
 if(!dockDrag)return;const d=dockState();
 if(dockDrag.type==='resize'){d.width=Math.round(Math.max(300,Math.min(innerWidth*.7,innerWidth-event.clientX)));dockDrag.element.style.setProperty('--dock-width',d.width+'px');}
 else{d.x=Math.max(0,Math.min(innerWidth-220,event.clientX-dockDrag.dx));d.y=Math.max(32,Math.min(innerHeight-120,event.clientY-dockDrag.dy));dockDrag.element.style.left=d.x+'px';dockDrag.element.style.top=d.y+'px';}
});
document.addEventListener('pointerup',()=>{if(dockDrag){dockDrag=null;persist();}});
