'use strict';

// UI-only sample data. Runtime and native operations are deliberately not executed.
let inspectorTab='files',sessionFilter='all',sessionQuery='',capabilityTab='models',selectedFile='src/import/header.ts';
const inspectorLabels={files:'工作区文件',changes:'代码变更',terminal:'终端',plan:'执行计划',browser:'浏览器',extensions:'插件视图'};
function sampleMessages(kind){
 if(kind==='auto')return [
  {role:'system',text:'来源：自主项目 / 工作 #128。执行归项目控制层管理。'},
  {role:'user',text:'依据方向 v3，修复已复现的非标准表头问题。保留原始字段，不引入新的外部服务。'},
  {role:'assistant',text:'8 个失败样本与列名别名有关。我已增加保留原始字段的映射方案，正在进行独立验证。'},
  {role:'tool',text:'workspace_files.read · src/import/header.ts'},
  {role:'tool',text:'terminal · 导入回归检查：48 项通过（示例）'}
 ];
 if(kind==='review')return [
  {role:'user',text:'帮我理解导入模块的结构，看看哪些地方值得先改。'},
  {role:'assistant',text:'我会先阅读入口、表头映射和错误处理，再给出有代码依据的建议。'},
  {role:'tool',text:'workspace_files.read · src/import/header.ts'},
  {role:'assistant',text:'导入逻辑分为文件解析、字段识别和数据校验。当前最明确的障碍是表头别名不一致；可以先增加映射，同时保留原始列名。这次会话只调查现状，尚未修改代码。'}
 ];
 return [];
}
function initHarnessState(){
 initSelfProject();
 if(!state.harness)state.harness={sessions:[
  {id:'direct-review',workspace:'commerce',title:'理解导入模块，找到改进点',owner:'human',status:'idle',model:'default',mode:'code',pack:'A',draft:'',messages:sampleMessages('review')},
  {id:'auto-r128',workspace:'commerce',title:'非标准表头识别 · 工作 #128',owner:'project',task:'r128',status:'running',model:'default',mode:'code',pack:'A',draft:'',messages:sampleMessages('auto')},
  {id:'direct-api',workspace:'commerce',title:'整理 API 错误处理约定',owner:'human',status:'idle',model:'default',mode:'plan',pack:'A',draft:'',messages:[{role:'user',text:'先帮我整理 API 的错误处理约定。'},{role:'assistant',text:'这是一段会话历史示例。可以继续补充上下文，或为新的问题新建会话。'}]},
  {id:'weekly-start',workspace:'weekly',title:'了解周报生成流程',owner:'human',status:'idle',model:'default',mode:'plan',pack:'A',draft:'',messages:[{role:'assistant',text:'这是经营周报工作空间的独立会话示例。'}]}
 ],activeSession:'direct-review',models:[{id:'default',name:'DeepSeek 默认模型',provider:'DeepSeek',endpoint:'官方路由',configured:true}],capabilities:{files:true,terminal:true,skill:true,mcp:false,creator:false},skills:{'仓库调查':true,'代码变更复核':true,'插件开发':false},connections:[],installed:[],viewRegistry:[{id:'creator',title:'Creator',desc:'通过插件扩展当前 Harness 的工具与界面。',icon:'spark'},{id:'scheduled',title:'定时任务',desc:'查看插件提供的提醒和计划入口。',icon:'clock'}]};
 if(!Array.isArray(state.harness.sessions))state.harness.sessions=[];
 ensureWorkspaceSession();
 initShellState();
 initSelfSessions();
}
function workspaceSessions(){return state.harness.sessions.filter(s=>s.workspace===state.activeProject);}
function syncTaskSessionStates(){
 for(const t of tasks)Object.assign(t,structuredClone(taskSeed.find(x=>x.id===t.id)));
 for(const s of workspaceSessions()){if(s.task&&s.status==='stopped'){const t=tasks.find(t=>t.id===s.task);if(t){t.status='stopped';t.statusText='已停止 · 待重新评估';t.outcome='本轮已停止；检查点保留，尚未发布。';t.checks=t.checks.map(([n,r])=>[n,r.includes('验证中')?'已停止':r]);}}}
}
function currentSession(){return state.harness.sessions.find(s=>s.id===state.harness.activeSession&&s.workspace===state.activeProject&&!s.archived);}
function ensureWorkspaceSession(){
 if(currentSession())return;
 const found=workspaceSessions().find(s=>!s.archived);
 if(found){state.harness.activeSession=found.id;return;}
 makeSession(false);
}
function makeSession(save=true){
 const s={id:'session-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),workspace:state.activeProject,title:'新会话',owner:'human',status:'idle',model:'default',mode:'code',pack:state.activePack,draft:'',messages:[]};
 state.harness.sessions.unshift(s);state.harness.activeSession=s.id;
 if(save)persist();return s;
}
function sessionStatus(s){return s.status==='running'?'运行中':s.status==='stopped'?'已停止':'等待输入';}
function modelName(s){return (state.harness.models.find(m=>m.id===s.model)||state.harness.models[0]).name;}
function workbenchPage(){return isSelfWorkspace()?renderSelfConversation():renderConversationWorkspace();}
function renderMessage(m,i){
 if(m.role==='tool')return `<details class="tool-event"><summary>${icon('check')}<span>${esc(m.text)}</span>${icon('down')}</summary><div class="tool-event-body">示例工具事件 · 运行包 ${esc(currentSession().pack)}<pre>${m.text.startsWith('terminal')?'exit_code: 0\n48 passed · 示例输出':'path: '+esc(selectedFile)+'\nresult: 只读文件内容示例'}</pre><button class="link" data-action="inspector-tab" data-tab="${m.text.startsWith('terminal')?'terminal':'files'}">在检查面板中展开 ${icon('arrow')}</button></div></details>`;
 if(m.role==='system')return `<div class="system-message">${icon('compass')}${esc(m.text)}</div>`;
 return `<article class="chat-message ${m.role==='user'?'user-message':'assistant-message'}"><div class="message-avatar">${m.role==='user'?'你':icon('spark')}</div><div class="message-content"><div class="message-label">${m.role==='user'?'你':'Harness'}<span>${m.demo?'演示回复':m.role==='assistant'?'示例会话':''}</span></div><p>${esc(m.text).replace(/\n/g,'<br>')}</p></div></article>`;
}
function inspectorContent(s){
 const hasContext=s.workspace==='commerce'&&['direct-review','auto-r128'].includes(s.id);
 if(inspectorTab==='extensions')return `<div class="inspector-intro">由运行包注册的页面、面板与工具组件，在同一工作空间内展示。</div>${state.harness.viewRegistry.map(v=>`<button class="extension-view" data-action="extension-view" data-id="${v.id}">${icon(v.icon)}<span>${v.title}<small>${v.desc}</small></span>${icon('chevron')}</button>`).join('')}<button class="link" data-action="navigate" data-view="capabilities">管理插件与能力 ${icon('arrow')}</button>`;
 if(!hasContext)return `<div class="inspector-empty">${icon(inspectorTab==='terminal'?'terminal':'folder')}<p>当前会话尚无${inspectorLabels[inspectorTab]}记录</p><small>工具产生的内容跟随会话保存，<br>不会复用其他会话的结果。</small></div>`;
 if(inspectorTab==='files')return `<div class="repo-heading">${icon('folder')}commerce-insight</div><div class="file-tree"><div>${icon('down')}src / import</div>${['src/import/header.ts','src/import/parse.ts','src/import/validate.ts','tests/import/header.spec.ts','README.md'].map(f=>`<button data-action="inspect-file" data-file="${f}" class="${f===selectedFile?'active':''}">${icon('file')}<span>${esc(f.replace('src/import/',''))}</span>${s.owner==='project'&&f.includes('header')?'<i>M</i>':''}</button>`).join('')}</div><div class="file-preview-head">${esc(selectedFile)}</div><pre class="file-preview"><span class="code-note">// 代码内容为示例</span>
${selectedFile.includes('header')?'export function normalizeHeader(raw) {\n  return {\n    original: raw,\n    name: resolveAlias(raw.trim())\n  };\n}':selectedFile==='README.md'?'# Commerce Insight\n\n导入商家数据并生成经营分析。':'// 选择的文件：'+esc(selectedFile)+'\n// 真实客户端按需读取文件内容。'}</pre><button class="link" data-action="attach-inspected-file">作为会话上下文 ${icon('plus')}</button>`;
 if(inspectorTab==='changes')return `<div class="repo-heading">${icon('git')}${s.owner==='project'?'agent/import-header-alias':'当前会话未修改代码'}</div>${s.owner==='project'?`<div class="change-summary"><span>2 个文件</span><span class="green-text">+18</span><span class="red-text">−4</span></div><div class="file-preview-head">src/import/header.ts</div><pre class="mini-diff"><span>  const raw = column;</span><em>− return { name: raw.trim() };</em><b>+ const name = resolveAlias(raw.trim());</b><b>+ return { name, original: raw };</b></pre><div class="file-preview-head">tests/import/header.spec.ts</div><p class="inspector-intro">补充重复表头、空列与别名覆盖检查。</p>`:'<div class="inspector-empty">这次会话正在调查仓库。<small>其他自主工作位于隔离工作区，<br>其差异不会合并到这里。</small></div>'}`;
 if(inspectorTab==='terminal')return `<div class="repo-heading">${icon('terminal')}bash · ${s.owner==='project'?'验证工作区':'只读调查'}</div><pre class="inspector-terminal">${s.owner==='project'?'$ pnpm test:import\n\n✓ 表头别名映射         14\n✓ 空字段与重复字段      8\n✓ 原有导入回归         26\n\n48 passed · 示例输出\nexit_code: 0':'$ rg --files src/import\n\nsrc/import/header.ts\nsrc/import/parse.ts\nsrc/import/validate.ts\n\nexit_code: 0\n\n示例只读命令记录'}</pre><p class="inspector-intro">真实终端通过运行包的 PTY 能力连接；当前仅展示记录。</p>`;
 if(inspectorTab==='plan')return `<div class="inspector-intro">计划属于当前会话，不改变项目方向。</div>${['调查入口与失败样本','形成候选方案','独立验证与记录结果'].map((n,i)=>`<div class="plan-step">${icon(i<2?'check':'clock')}<span>${n}</span></div>`).join('')}`;
 if(inspectorTab==='browser')return `<div class="inspector-empty">${icon('monitor')}<p>浏览器工具尚未连接</p><small>浏览器结果与交互视图由运行包中的<br>相应插件提供；当前没有实际网页会话。</small></div>`;
 return '';
}
function sessionsPage(){
 const list=workspaceSessions().filter(s=>(sessionFilter==='all'||s.owner===sessionFilter)&&s.title.toLowerCase().includes(sessionQuery.toLowerCase()));
 return `${pageHeading('所有会话，都能继续。','直接编码与自主执行分别标记来源，共用 Harness 的会话与工具记录。',button('新建会话','new-session','primary','plus'),'HARNESS SESSIONS')}<div class="session-filter-bar"><div class="filter-bar">${[['all','全部会话'],['human','直接会话'],['project','自主项目']].map(([k,n])=>`<button class="filter-chip ${sessionFilter===k?'active':''}" data-action="session-filter" data-filter="${k}">${n}</button>`).join('')}</div><label class="session-search">${icon('search')}<input id="session-search" placeholder="搜索当前工作空间" value="${esc(sessionQuery)}" aria-label="搜索会话"></label></div><section class="card" id="session-results">${list.length?list.map(s=>`<button class="session-record" data-action="open-session" data-session="${esc(s.id)}"><div class="session-record-icon">${icon(s.owner==='project'?'compass':'terminal')}</div><div class="grow"><h3>${esc(s.title)}</h3><p>${s.owner==='project'?'来源：自主项目 · 工作 #'+esc(s.task.slice(1)):'来源：直接会话'} · ${s.messages.length} 条记录 · ${esc(modelName(s))}</p></div>${pill(sessionStatus(s),s.status==='running'?'green':'')}${icon('chevron')}</button>`).join(''):'<div class="empty">没有匹配的会话</div>'}</section>`;
}
function capabilitiesPage(){
 const tabs=[['models','模型'],['tools','工具与权限'],['skills','Skills'],['mcp','MCP'],['plugins','插件与界面']];
 return `${pageHeading('Harness 的能力，在这里管理。','编码会话与自主项目共用能力目录，具体生效范围由会话与运行策略决定。','','HARNESS CAPABILITIES')}<div class="capability-tabs" role="tablist" aria-label="Harness 能力类型">${tabs.map(([k,n])=>`<button role="tab" aria-selected="${capabilityTab===k}" class="${capabilityTab===k?'active':''}" data-action="capability-tab" data-tab="${k}">${n}</button>`).join('')}</div><div class="capability-notice">${icon('info')}以下是配置交互示例。尚未安装插件、连接 MCP 或保存真实凭据。</div><div role="tabpanel">${capabilityContent()}</div>`;
}
function capabilityContent(){
 const h=state.harness;
 if(capabilityTab==='models')return `<section class="card"><div class="card-head"><h2>模型路由</h2>${button('添加模型','add-model','','plus')}</div>${h.models.map((m,i)=>`<div class="capability-row"><span class="capability-icon">${icon('spark')}</span><div class="grow"><h3>${esc(m.name)} ${i===0?'<span class="pill">默认</span>':''}</h3><p>${esc(m.provider)} · ${esc(m.endpoint)}</p></div>${pill(m.configured?'示例路由':'待连接凭据',m.configured?'green':'amber')}</div>`).join('')}</section><div class="help-box" style="margin-top:18px">正式客户端的凭据由后台凭据服务管理。会话可以选择模型；项目按已授权的模型策略分配执行资源。</div>`;
 if(capabilityTab==='tools')return `<section class="card"><div class="card-head"><h2>可用执行能力</h2>${pill('本地运行包目录')}</div>${[['files','folder','文件读写','读取与修改已授权工作区中的文件。'],['terminal','terminal','终端与命令','命令、长任务与运行结果由独立执行进程管理。'],['skill','book','Skills 加载','按上下文发现和加载任务所需的能力说明。'],['mcp','cloud','MCP 工具','接入已配置的外部服务及资源。']].map(([k,i,n,d])=>capabilityToggle(k,i,n,d)).join('')}</section><section class="card card-pad" style="margin-top:18px"><h2>权限按执行方式生效</h2><div class="criteria">${icon('terminal')}<span>直接会话遵循当前会话的权限策略，需要授权时在会话中处理。</span></div><div class="criteria">${icon('compass')}<span>自主项目继承方向与授权边界，在范围内自动决策，超出边界时请求方向调整。</span></div><p class="tiny muted">能力启用不代表批准每一次调用。已有运行保持创建时绑定的运行包与策略。</p></section>`;
 if(capabilityTab==='skills')return `<section class="card"><div class="card-head"><h2>可发现的 Skills</h2>${pill('示例目录')}</div>${Object.entries(h.skills).map(([n,on],i)=>`<div class="capability-row"><span class="capability-icon">${icon('book')}</span><div class="grow"><h3>${esc(n)}</h3><p>${i===0?'工作区':'运行包'} · ${i===2?'扩展 Harness 插件与界面':'按任务需要加载完整说明'}</p></div><button class="skill-toggle" role="switch" aria-checked="${on}" aria-label="${on?'停用':'启用'} ${esc(n)}" data-action="skill-toggle" data-name="${esc(n)}"><span></span></button></div>`).join('')}</section>`;
 if(capabilityTab==='mcp')return `<section class="card"><div class="card-head"><h2>MCP 连接</h2>${button('添加连接','add-mcp','','plus')}</div>${h.connections.length?h.connections.map(c=>`<div class="capability-row"><span class="capability-icon">${icon('cloud')}</span><div class="grow"><h3>${esc(c.name)}</h3><p>${esc(c.url)}</p></div>${pill('待连接','amber')}</div>`).join(''):`<div class="empty"><p>尚未配置连接</p><p class="tiny muted">按需接入服务，让模型使用其工具与资源。</p></div>`}</section><div class="help-box" style="margin-top:18px">连接与工具的适用范围需由固定运行包的能力契约确认。这里不假定所有上游插件都支持工作区隔离。</div>`;
 return `<section class="card"><div class="card-head"><h2>插件与组合</h2>${button('模拟添加插件','add-plugin','','plus')}</div>${[['核心编码组合','会话、模型、文件、终端与工具事件','已启用'],['Creator','用对话构建和管理 Harness 扩展','可选能力'],...h.installed.map(p=>[p,'待验证的示例插件','待验证'])].map(([n,d,status])=>`<div class="capability-row"><span class="capability-icon">${icon('box')}</span><div class="grow"><h3>${esc(n)}</h3><p>${esc(d)}</p></div>${pill(status,status==='已启用'?'green':'')}</div>`).join('')}</section><section class="card card-pad" style="margin-top:18px"><h2>插件提供的界面入口</h2><p class="small muted" style="margin:9px 0 16px">插件贡献的页面、设置和工具节点通过界面注册表接入。更换桌面外壳后，仍保留这些入口。</p><div class="plugin-view-grid">${h.viewRegistry.map(v=>`<button data-action="extension-view" data-id="${v.id}">${icon(v.icon)}<span>${v.title}</span>${icon('arrow')}</button>`).join('')}</div></section>`;
}
function capabilityToggle(k,i,n,d){const on=state.harness.capabilities[k];return `<div class="capability-row"><span class="capability-icon">${icon(i)}</span><div class="grow"><h3>${n}</h3><p>${d}</p></div><button class="skill-toggle" role="switch" aria-checked="${on}" aria-label="${on?'停用':'启用'} ${n}" data-action="capability-toggle" data-id="${k}"><span></span></button></div>`;}
function enableAutonomy(fromSession=false){
 modal('给自主项目一个方向','当前目录可以继续直接编码。开启后，AI 才会持续选择并推进范围内的工作。',`<form id="enable-autonomy-form"><input type="hidden" name="sourceSession" value="${fromSession?esc(currentSession().id):''}"><div class="field"><label for="autonomy-goal">希望产品朝哪里改进？</label><textarea id="autonomy-goal" name="direction" rows="3" maxlength="240" required placeholder="描述使用者、问题与希望看到的改善…">${fromSession?esc(currentSession().title):''}</textarea></div><div class="field"><label for="autonomy-boundary">边界与优先级</label><textarea id="autonomy-boundary" name="detail" rows="2" maxlength="500" required placeholder="例如：优先修复导入流程，不新增外部服务…"></textarea></div><div class="help-box">工作区、会话和能力配置继续保留。原型只保存方向，不会开始实际执行。</div></form>`,`${button('继续直接编码','close-overlay')}<button class="btn primary" type="submit" form="enable-autonomy-form">建立方向 ${icon('compass')}</button>`);
}
function handoffSession(){
 if(!project().direction){enableAutonomy(true);return;}
 modal('把这条线索交给自主项目','AI 会结合当前方向评估优先级，不会直接把聊天内容变成待执行命令。',`<form id="session-handoff-form"><div class="field"><label for="handoff-note">希望项目继续关注什么？</label><textarea id="handoff-note" name="note" rows="3" maxlength="1000" required>${esc(currentSession().title)}</textarea></div><div class="reason-card"><div class="reason-title">关联当前方向 v${project().version}</div><p>${esc(project().direction)}</p></div></form>`,`${button('取消','close-overlay')}<button class="btn primary" type="submit" form="session-handoff-form">保存为项目线索 ${icon('arrow')}</button>`);
}
function projectLeads(){const leads=project().leads||[];return leads.length?`<section class="card project-leads"><div class="card-head"><h2>来自会话的项目线索</h2>${pill('待 AI 评估','amber')}</div>${leads.map(l=>`<div class="lead-row"><div class="grow">${esc(l.text)}<p>保持原有方向与授权，AI 评估后再决定是否推进。</p></div><button class="link" data-action="open-session" data-session="${esc(l.session)}">来源会话 ${icon('arrow')}</button></div>`).join('')}</section>`:'';}
function handleHarnessAction(el){
 const a=el.dataset.action,s=currentSession();
 switch(a){
  case 'new-session':state.harness.mobileSidebar=false;makeSession();view='workbench';closeOverlay();render();document.getElementById('session-prompt')?.focus();break;
  case 'open-session':openSessionById(el.dataset.session);break;
  case 'open-task-session':{const id=el.dataset.task,t=tasks.find(x=>x.id===id);if(!t)return;let target=workspaceSessions().find(x=>x.task===id);if(!target){target={id:'auto-'+id+'-'+state.activeProject,workspace:state.activeProject,title:t.title,owner:'project',task:id,status:t.status==='running'?'running':'idle',model:'default',mode:'code',pack:t.pack||'A',draft:'',messages:[{role:'system',text:'来源：自主项目 / 工作 #'+id.slice(1)},{role:'assistant',text:t.summary+' 这是执行会话的历史示例。'}]};state.harness.sessions.push(target);}state.harness.activeSession=target.id;inspectorTab='terminal';view='workbench';persist();closeOverlay();render();break;}
  case 'session-task':if(s?.task)taskDetail(s.task);break;
  case 'session-to-project':handoffSession();break;
  case 'fill-prompt':s.draft=el.dataset.prompt;persist();render();document.getElementById('session-prompt')?.focus();break;
  case 'inspector-tab':inspectorTab=el.dataset.tab;state.harness.hideInspector=false;state.harness.narrowInspector=true;render();break;
  case 'close-inspector':state.harness.narrowInspector=false;state.harness.hideInspector=!matchMedia('(max-width:1050px)').matches;persist();render();break;
  case 'toggle-inspector':if(matchMedia('(max-width:1050px)').matches){state.harness.narrowInspector=!state.harness.narrowInspector;state.harness.hideInspector=false;}else state.harness.hideInspector=!state.harness.hideInspector;persist();render();break;
  case 'inspect-file':selectedFile=el.dataset.file;render();break;
  case 'attach-inspected-file':s.attachment=selectedFile;persist();render();toast('已添加示例上下文；未读取真实文件。');break;
  case 'attach-context':modal('添加会话上下文','真实客户端支持从工作区选择文件与附件。',`<p class="small muted">原型提供一份示例上下文，不会打开本地文件选择器。</p>`,`${button('取消','close-overlay')}${button('添加 README 示例','attach-sample','primary','file')}`);break;
  case 'attach-sample':s.attachment='README.md · 示例';persist();closeOverlay();render();break;
  case 'remove-attachment':delete s.attachment;persist();render();break;
  case 'stop-session':s.status='stopped';syncTaskSessionStates();s.messages.push({role:'system',text:'已演示请求停止本轮；项目的后续调度保持原策略。'});persist();render();toast('当前会话已演示停止；未暂停整个项目。');break;
  case 'session-permissions':modal('当前会话的权限','运行能力与调用授权分别管理。',`<div class="criteria">${icon('folder')}<span>文件仅限当前授权工作区：${esc(project().path)}</span></div><div class="criteria">${icon('shield')}<span>${s.owner==='project'?'继承自主项目的方向、资源与授权边界。':'按会话权限策略评估工具调用，需要时在当前会话请求授权。'}</span></div><p class="small muted">这里是权限说明示例，不会改变实际操作系统权限。</p>`,button('明白了','close-overlay','primary'));break;
  case 'session-filter':sessionFilter=el.dataset.filter;render();break;
  case 'capability-tab':capabilityTab=el.dataset.tab;pluginTab='configuration';render();break;
  case 'capability-toggle':state.harness.capabilities[el.dataset.id]=!state.harness.capabilities[el.dataset.id];persist();render();toast('已保存能力偏好示例；不改变已有运行的能力快照。');break;
  case 'skill-toggle':state.harness.skills[el.dataset.name]=!state.harness.skills[el.dataset.name];persist();render();break;
  case 'add-model':modal('添加模型路由','原型只保存路由信息，不接收 API Key。',`<form id="model-form"><div class="field"><label for="model-name">显示名称</label><input id="model-name" name="name" maxlength="60" required placeholder="例如：代码审查模型"></div><div class="field"><label for="model-provider">服务提供方</label><input id="model-provider" name="provider" maxlength="60" required placeholder="OpenAI 兼容服务"></div><div class="field"><label for="model-endpoint">API 地址</label><input id="model-endpoint" name="endpoint" type="url" required placeholder="https://api.example.com/v1"></div><p class="tiny muted">凭据由原生端安全管理，此处尚未连接。</p></form>`,`${button('取消','close-overlay')}<button class="btn primary" form="model-form" type="submit">保存路由示例</button>`);break;
  case 'add-mcp':modal('添加 MCP 连接','只记录示例配置，不会向服务发送请求。',`<form id="mcp-form"><div class="field"><label for="mcp-name">连接名称</label><input id="mcp-name" name="name" required maxlength="60"></div><div class="field"><label for="mcp-url">服务地址</label><input id="mcp-url" name="url" type="url" required placeholder="https://example.com/mcp"></div></form>`,`${button('取消','close-overlay')}<button class="btn primary" form="mcp-form" type="submit">保存连接示例</button>`);break;
  case 'add-plugin':modal('模拟添加 Harness 插件','实际客户端经运行包与插件管理流程验证后再加载。',`<form id="plugin-form"><div class="field"><label for="plugin-name">插件包名</label><input id="plugin-name" name="name" required maxlength="100" placeholder="@your-org/dsh-plugin-example"></div><p class="tiny muted">此原型只添加待验证条目，不下载或执行插件。</p></form>`,`${button('取消','close-overlay')}<button class="btn primary" form="plugin-form" type="submit">添加待验证条目</button>`);break;
  case 'extension-view':{const v=state.harness.viewRegistry.find(x=>x.id===el.dataset.id);if(!v)return;modal(v.title+' · 插件入口',v.desc,`<div class="help-box">这里展示扩展页面的接入位置。原生端通过界面注册表挂载已认证的插件页面、面板与设置；工具事件使用相应的节点渲染器。</div><p class="small muted" style="margin-top:16px">当前未连接实际插件。保留入口并不等于承诺任意上游 UI 插件能在新宿主中直接运行，仍需适配验证。</p>`,button('返回工作空间','close-overlay','primary'));break;}
  case 'new-workspace':projectMenu=false;render();modal('添加工作空间','选一个目录，直接开始编码。自主项目可以之后开启。',`<form id="workspace-form"><div class="field"><label for="workspace-name">名称</label><input id="workspace-name" name="name" maxlength="50" required placeholder="例如：我的工具箱"></div><div class="field"><label for="workspace-path">目录（示例）</label><input id="workspace-path" name="path" required placeholder="~/Projects/my-toolbox"></div><p class="tiny muted">正式桌面端使用原生目录授权；此处不会读取文件。</p></form>`,`${button('取消','close-overlay')}<button class="btn primary" type="submit" form="workspace-form">打开工作空间 ${icon('arrow')}</button>`);break;
 }
}
document.addEventListener('submit',event=>{
 const id=event.target.id;
 if(!['composer-form','workspace-form','model-form','mcp-form','plugin-form','enable-autonomy-form','session-handoff-form'].includes(id))return;
 event.preventDefault();
 const f=new FormData(event.target),h=state.harness,s=currentSession();
 if(id==='composer-form'){
  const input=document.getElementById('session-prompt'),text=input.value.trim();if(!text)return;
  s.messages.push({role:'user',text});s.draft='';
  if(s.messages.length===1)s.title=text.slice(0,30);
  if(s.owner==='project'){
   project().leads=project().leads||[];project().leads.push({text,session:s.id});
   s.messages.push({role:'assistant',text:'已将补充内容记为项目线索（演示）。后续由项目结合当前方向评估；没有直接修改代码或启动工具。',demo:true});
  }else{
   s.messages.push({role:'assistant',text:s.mode==='creator'?'这是 Creator 交互演示。正式接入后会通过 Harness 插件机制调查、创建并验证扩展；当前没有创建或安装插件。':s.mode==='plan'?'这是分析流程的演示回复。正式接入后，Harness 将阅读所需上下文、形成方案，并在此展示依据；当前没有读取或修改文件。':'消息已保存，这是交互演示回复。正式接入后，Harness 会在当前工作空间中调查、实现并展示工具结果；此原型没有调用模型或执行命令。',demo:true});
   s.status='idle';
  }
 }else if(id==='workspace-form'){
  const name=String(f.get('name')).trim(),path=String(f.get('path')).trim();if(!name||!path)return;
  const wid='workspace-'+Date.now();state.projects.push({id:wid,name,path,direction:'',detail:'',version:0,isNew:true});state.activeProject=wid;state.paused=false;state.budget=60;makeSession(false);state.harness.mobileSidebar=false;view='workbench';
 }else if(id==='model-form'){
  const name=String(f.get('name')).trim(),provider=String(f.get('provider')).trim(),endpoint=String(f.get('endpoint')).trim();if(!name||!provider||!endpoint)return;
  h.models.push({id:'model-'+Date.now(),name,provider,endpoint,configured:false});
 }else if(id==='mcp-form'){
  const name=String(f.get('name')).trim(),url=String(f.get('url')).trim();if(!name||!url)return;h.connections.push({name,url});
 }else if(id==='plugin-form'){
  const name=String(f.get('name')).trim();if(!name)return;h.installed.push(name);
 }else if(id==='enable-autonomy-form'){
  const direction=String(f.get('direction')).trim(),detail=String(f.get('detail')).trim();if(!direction||!detail)return;
  Object.assign(project(),{direction,detail,version:1});const source=String(f.get('sourceSession')||'');if(source)project().leads=[{text:direction,session:source}];view='overview';
 }else if(id==='session-handoff-form'){
  const text=String(f.get('note')).trim();if(!text)return;project().leads=project().leads||[];project().leads.push({text,session:s.id});view='decisions';
 }
 persist();closeOverlay();render();
 if(id==='composer-form'){document.getElementById('session-prompt')?.focus();document.getElementById('conversation-feed')?.lastElementChild?.scrollIntoView({block:'nearest'});}
 else toast('已保存原型状态；未触发实际执行。');
});
document.addEventListener('input',event=>{
 if(event.target.id==='session-prompt'){currentSession().draft=event.target.value;persist();}
 if(event.target.id==='session-search'){
  sessionQuery=event.target.value;
  // Preserve input focus while replacing only the results.
  const template=document.createElement('template');template.innerHTML=sessionsPage();document.getElementById('session-results').innerHTML=template.content.querySelector('#session-results').innerHTML;
 }
});
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.id==='inspector-select'){inspectorTab=el.value;render();}
 if(el.id==='session-model'||el.id==='session-mode'){const s=currentSession();if(s.owner==='project')return;s[el.id==='session-model'?'model':'mode']=el.value;persist();render();}
});
document.addEventListener('keydown',event=>{if(event.isComposing)return;
 if(event.target.id==='session-prompt'&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();document.getElementById('composer-form')?.requestSubmit();}
});
