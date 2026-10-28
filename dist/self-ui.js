'use strict';

// Real controller data has a separate source and never falls back to commerce fixtures.
const selfWorkspaceId = 'vela-self';
const selfData = { snapshot: null, loading: true, error: '', csrf: null, pending: false, details: false, refreshTimer: null };
const selfStatusLabels = { blocked: '等待连接', preparing: '准备工作区', executing: '执行中', verifying: '独立验证', validated: '验证通过', integrating: '整合中', integrated: '已整合', failed: '未通过', cancelled: '已取消', interrupted: '需要核对', no_change: '未产生变更' };
const selfActiveStatuses = ['preparing', 'executing', 'verifying', 'validated', 'integrating'];
const selfEventLabels = { 'run.created': '创建本轮工作', 'run.blocked': '执行条件未满足', 'workspace.prepared': '准备独立工作区', 'runner.started': '启动 Harness', 'runner.completed': '执行结束，转交验证', 'candidate.captured': '捕获候选代码', 'candidate.empty': '未产生代码变更', 'verification.failed': '独立验证未通过', 'verification.passed': '独立验证通过', 'integration.started': '开始整合候选', 'integration.completed': '候选已快进整合', 'integration.reconciled': '核对整合结果', 'integration.uncertain': '整合状态待核对', 'run.failed': '本轮失败', 'cancel.requested': '收到停止请求', 'run.cancelled': '本轮已取消', 'run.reconciled': '恢复时核对状态' };
function isSelfWorkspace() { return state.activeProject === selfWorkspaceId; }
function isSelfRecordView() { return isSelfWorkspace() && (view === 'workbench' || nav.some(([id]) => id === view)); }
function initSelfProject() {
  let p = state.projects.find(p => p.id === selfWorkspaceId);
  if (!p) {
    p = { id: selfWorkspaceId, name: '航向 Vela', path: 'vela-agent-workspace', direction: '用 Vela 自身验证自主研发闭环', detail: '先建立真实仓库、执行、验证与可追溯的交付记录。', version: 1, isReal: true, paused: true };
    state.projects.unshift(p); state.activeProject = selfWorkspaceId;
  }
  p.isReal = true;
}
function initSelfSessions() {
  const h = state.harness;
  h.sessions = h.sessions.filter(s => s.workspace !== selfWorkspaceId || s.isReal);
  if (!h.sessions.some(s => s.id === 'self-controller')) h.sessions.unshift({ id: 'self-controller', workspace: selfWorkspaceId, title: '自主研发 · 当前进展', owner: 'project', isReal: true, status: 'idle', model: 'default', pack: 'Harness 0.2.1-rc.3', messages: [] });
  if (isSelfWorkspace() && !currentSession()) h.activeSession = 'self-controller';
}
function selfSessionRun() {
  const id = currentSession()?.realRun;
  return selfData.snapshot?.runs.find(run => run.id === id) || selfData.snapshot?.runs[0] || null;
}
function selfModeLabel() { return selfData.loading ? '读取真实记录' : selfData.error ? '连接中断 · 保留记录' : selfData.snapshot?.source === 'qa-fixture' ? '验收样本 · 非模型实跑' : selfData.snapshot?.source === 'local-controller' ? '本地控制器 · 实时' : '真实记录 · 只读快照'; }
function selfShort(sha) { return sha ? sha.slice(0, 9) : '尚未产生'; }
function selfTime(value) { return formatRunTime(value); }

function selfPill(status) { return pill(selfStatusLabels[status] || status, ['failed','blocked','interrupted'].includes(status) ? 'amber' : status === 'integrated' ? 'green' : ''); }
function selfHeading(title, copy, actions = '') { return pageHeading(esc(title), esc(copy), actions, 'VELA · SELF DEVELOPMENT'); }
function selfRunButton() {
  const data=selfData.snapshot,local=data?.source==='local-controller';
  if(selfData.error)return button('重新连接','self-refresh','','refresh');
  if(data?.repository.state==='uninitialized')return button('建立 Git 基线','self-connect','','git');
  const active=data?.runs.find(run=>selfActiveStatuses.includes(run.status));
  if(active&&local)return button('停止本轮','self-cancel','','pause',`data-run="${esc(active.id)}" ${selfData.pending?'disabled':''}`);
  return button(selfData.pending?'正在创建工作…':local?'自主推进一轮':'连接本地控制器',local?'self-run':'self-connect','primary',local?'play':'terminal',selfData.pending?'disabled':'');
}

function selfSourceBar() {
  const data = selfData.snapshot;
  return `<div class="self-source-bar"><span class="self-source-dot ${data?.source === 'local-controller' ? 'online' : ''}"></span><span>${esc(selfModeLabel())}</span><span class="self-source-time">${data ? '更新于 ' + selfTime(data.generatedAt) : ''}</span><button class="link" data-action="self-refresh" ${selfData.loading ? 'disabled' : ''}>${icon('refresh')}刷新</button></div>`;
}
async function loadSelfSnapshot({quiet=false}={}) {
  if(selfData.fetching)return;
  selfData.fetching=true;selfData.loading=!quiet;let changed=false,data;
  const loopback=['127.0.0.1','localhost','[::1]'].includes(location.hostname);
  try {
    let response;
    try{response=await fetch('/api/snapshot',{cache:'no-store',signal:AbortSignal.timeout(5000)});}
    catch(error){if(loopback||selfData.snapshot?.source==='local-controller')throw new Error('本地控制器无法连接。请确认 npm run serve 仍在运行，然后重新连接。');}
    const isJson=response?.headers.get('content-type')?.includes('application/json');
    const local=loopback||response?.headers.get('x-vela-controller')==='1'||selfData.snapshot?.source==='local-controller';
    if(isJson){const body=await response.json();if(!response.ok){if(local)throw new Error(body.error||'本地控制器返回错误');}else data=body;}
    else if(local)throw new Error('本地控制器没有返回有效记录。请使用终端输出的 127.0.0.1 地址访问。');
    if(!data){const snapshot=await fetch('./self-development.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!snapshot.ok)throw new Error('无法读取导出记录');data=await snapshot.json();}
    if(data.schemaVersion!==1||data.project?.id!==selfWorkspaceId||!Array.isArray(data.runs))throw new Error('记录格式不兼容，请更新代码并重启控制器。');
    selfData.csrf=data.csrfToken||null;delete data.csrfToken;
    changed=!!selfData.error||JSON.stringify({...selfData.snapshot,generatedAt:''})!==JSON.stringify({...data,generatedAt:''});
    selfData.snapshot=data;selfData.error='';
    const p=state.projects.find(p=>p.id===selfWorkspaceId);
    Object.assign(p,{name:data.project.name,path:data.project.repository,direction:data.project.direction.goal,detail:data.project.direction.constraints.join('\n'),version:data.project.direction.version,paused:!data.runtime.ready});
    const h=state.harness,ids=new Set(data.runs.map(run=>'self-run-'+run.id));
    h.sessions=h.sessions.filter(s=>s.workspace!==selfWorkspaceId||s.id==='self-controller'||ids.has(s.id));
    for(const run of [...data.runs].reverse()){
      const id='self-run-'+run.id,fields={id,workspace:selfWorkspaceId,title:runName(run),owner:'project',isReal:true,realRun:run.id,status:selfActiveStatuses.includes(run.status)?'running':'idle',model:'default',pack:`Harness ${run.runtimeVersion||data.runtime.expectedVersion}`,messages:[]};
      const existing=h.sessions.find(s=>s.id===id);if(existing)Object.assign(existing,fields);else h.sessions.unshift(fields);
    }
    if(selfData.awaitingRunIds){const created=data.runs.find(run=>!selfData.awaitingRunIds.includes(run.id));if(created){activateWorkspace(selfWorkspaceId);h.activeSession='self-run-'+created.id;h.sessionViews[h.activeSession]='chat';view='workbench';selfData.awaitingRunIds=null;selfData.pending=false;changed=true;}else if(data.serviceError||Date.now()-selfData.launchTime>15000){selfData.pending=false;selfData.awaitingRunIds=null;}}
    if(isSelfWorkspace()){state.paused=p.paused;if(!currentSession())h.activeSession='self-controller';}
  }catch(error){selfData.error=error.message||'暂时无法读取控制器记录';selfData.csrf=null;changed=true;}
  finally{
    selfData.fetching=false;selfData.loading=false;
    if((changed||!quiet)&&(isSelfWorkspace()||view==='automation'))render();
    if(isSelfWorkspace()&&view==='workbench'&&selfData.snapshot?.source==='local-controller'&&!selfData.error)loadRunDetails(selfSessionRun());
    clearTimeout(selfData.refreshTimer);
    if(loopback||selfData.snapshot?.source==='local-controller')selfData.refreshTimer=setTimeout(()=>loadSelfSnapshot({quiet:true}),3000);
  }
}

function selfUnavailable() {
  return `<section class="card self-unavailable">${icon(selfData.loading ? 'refresh' : 'alert')}<h2>${selfData.loading ? '读取真实研发记录…' : '暂时无法读取记录'}</h2><p>${esc(selfData.error || '正在连接本地控制器或读取它导出的快照。')}</p>${button('重新读取', 'self-refresh', '', 'refresh')}</section>`;
}
function selfBlockers() {
  const blockers = selfData.snapshot?.runtime.blockers || [];
  return blockers.length ? `<div class="self-blocker"><span class="self-blocker-icon">${icon('key')}</span><div><strong>运行条件未满足</strong>${blockers.map(b => `<p>${esc(b.message)}</p>`).join('')}<small>请先处理以上条件，再开始下一轮。</small></div>${button('本地连接方式','self-connect','ghost','arrow')}</div>` : '';
}
function selfStats() {
  const data = selfData.snapshot;
  return `<div class="self-metrics"><div><span>真实仓库</span><strong>${data.repository.trackedFiles}<small>个跟踪文件</small></strong><code>${esc(data.repository.branch || 'detached')} · ${selfShort(data.repository.head)}</code></div><div><span>源码基线</span><strong>${data.repository.head?'已就绪':'待建立'}</strong><small>当前本地 Git 源码版本</small></div><div><span>Harness 自主整合</span><strong>${data.metrics.integrated}<small>轮</small></strong><small>${data.metrics.attempts} 次发起记录</small></div><div><span>产品效果</span><strong class="self-unmeasured">待观察</strong><small>独立于工程检查与部署</small></div></div>`;
}
function selfBootstrapCard() {
  const b = selfData.snapshot?.bootstrap;
  if (!b) return `<section class="card self-record-card"><h2>本地源码基线</h2><p>${esc(selfData.snapshot.project.repository)} · ${esc(selfData.snapshot.repository.branch||'未建立')} · ${selfShort(selfData.snapshot.repository.head)}</p><p class="tiny muted">初始引导证据保存在开发环境。本机的研发结果以运行记录为准。</p></section>`;
  return `<section class="card self-record-card"><div class="row between"><div class="row">${icon('check')}<h2>${esc(b.title)}</h2></div>${pill('工程检查通过','green')}</div><p>${esc(b.provenance)}</p><div class="self-commit-pair"><span>基线 <code>${selfShort(b.baseSha)}</code></span>${icon('arrow')}<span>代码 <code>${selfShort(b.codeSha)}</code></span><small>${b.changedFiles.length} 个文件</small></div><div class="self-checks">${b.checks.map(check => `<div>${icon(check.passed?'check':'alert')}<span>${esc(check.name)}</span><small>${check.report.tests ? `${check.report.passed} / ${check.report.tests} 通过` : `${check.report.checks?.length || 0} 项通过`}</small></div>`).join('')}</div><button class="link" data-action="self-bootstrap-details">${selfData.details?'收起':'查看'}变更与验证证据 ${icon('chevron')}</button>${selfData.details?`<div class="self-details"><div class="self-file-list">${b.changedFiles.map(file=>`<div><code>${esc(file.path)}</code><span>+${file.added ?? '—'} −${file.removed ?? '—'}</span></div>`).join('')}</div><p class="tiny muted">证据 SHA-256</p><code class="self-hash">${esc(b.evidenceHash)}</code><p class="tiny muted">记录时间 ${selfTime(b.at)} · 发布与产品效果另行跟踪</p></div>`:''}</section>`;
}
function selfRunCard(run) {
  return `<button class="self-run-row" data-action="self-open-run" data-run="${esc(run.id)}"><span class="self-run-icon">${icon(run.status==='blocked'?'key':run.status==='integrated'?'check':'activity')}</span><div class="grow"><strong>${esc(runName(run))}</strong><p>${run.status==='failed'?esc(runFailure(run).title+'：'+runFailure(run).detail.slice(0,100)):run.summary ? esc(run.summary.slice(0,100)) : run.status==='blocked'?'执行前检查发现缺少条件，未调用模型。':'调查代码，自主选择改进，再交给独立验证。'}</p><small>Harness ${esc(run.runtimeVersion || '未安装')} · ${selfTime(run.createdAt)} · ${selfShort(run.baseSha)}</small></div>${selfPill(run.status)}${icon('chevron')}</button>`;
}
function renderSelfProjectPage() {
  const data = selfData.snapshot;
  if (!data) return selfSourceBar() + selfUnavailable();
  if (view === 'direction') return selfSourceBar() + selfHeading('人掌握方向，AI 负责推进。',`当前方向 v${data.project.direction.version} · ${data.source === 'local-controller'?'本地持久保存':'快照只读'}`,button('调整方向','self-edit-direction','','compass')) + `<section class="card self-record-card"><div class="eyebrow">长期方向</div><h2 class="self-goal">${esc(data.project.direction.goal)}</h2>${data.project.direction.constraints.map(c=>`<div class="criteria">${icon('shield')}<span>${esc(c)}</span></div>`).join('')}<div class="self-boundary"><span>单轮 ${data.acceptance.maxRunSeconds} 秒</span><span>最多 ${data.acceptance.maxChangedFiles} 个文件</span><span>范围 ${data.acceptance.allowed.map(esc).join('、')}</span></div></section>`;
  if (view === 'tasks') return selfSourceBar() + selfHeading('每一轮，都留下真实证据。','只展示本控制器记录的执行；测试夹具不作为自主研发成果。',selfRunButton()) + `<section class="card">${data.runs.map(selfRunCard).join('')||'<div class="empty">尚未发起 Harness 自主迭代。</div>'}</section>`;
  if (view === 'deliveries') return selfSourceBar() + selfHeading('先交付可验证的工程结果。','引导开发、Harness 自主整合、发布与产品效果分别记账。') + selfBootstrapCard() + `<section class="card self-record-card"><h2>Harness 自主交付</h2>${data.runs.filter(r=>r.status==='integrated'&&r.engine==='deepseek-harness').map(selfRunCard).join('')||'<p>尚无自主交付。模型连接后，首轮候选将关联代码 SHA、差异摘要与独立验证证据。</p>'}</section>`;
  if (view === 'decisions') return selfSourceBar() + selfHeading('从真实现状，决定下一步。','当前首先验证“方向到代码”的最小闭环。') + `<section class="card self-record-card"><h2>先连通自主研发，再扩展桌面宿主</h2><p>仓库已经具备交互原型，第一步建立控制器、执行适配器和验证证据。模型尚未连接，暂不生成由 AI 作出的产品决策。</p><div class="self-checks"><div>${icon('folder')}<span>依据</span><small>${data.repository.trackedFiles} 个跟踪文件 · ${selfShort(data.repository.head)}</small></div><div>${icon('shield')}<span>冻结验收</span><small>${esc(data.acceptance.id)}</small></div><div>${icon('key')}<span>执行条件</span><small>${data.runtime.ready?'可发起首轮':'等待模型凭据'}</small></div></div></section>` + selfBlockers();
  if (view === 'knowledge') return selfSourceBar() + selfHeading('保留证据，再形成经验。','不会从测试夹具或界面示例推断产品规律。') + `<section class="card self-record-card"><h2>当前可确认</h2><div class="criteria">${icon('check')}<span>固定版本 Harness ${esc(data.runtime.installedVersion || '未安装')}；headless 启动检查${data.runtime.probe?.passed?'通过':'待完成'}。</span></div><div class="criteria">${icon('check')}<span>方向、执行与事件持久保存在本地 SQLite，刷新界面不会重放任务。</span></div><div class="criteria">${icon('clock')}<span>产品效果与长期自主选择能力，等待真实模型运行后积累证据。</span></div></section>`;
  return selfSourceBar() + selfHeading('让 Vela，成为第一个真实项目。','从这套工作台自身，验证人定方向、AI 推进的研发闭环。',selfRunButton()) + `<section class="card self-direction"><div class="eyebrow">长期方向 · v${data.project.direction.version}</div><h2>${esc(data.project.direction.goal)}</h2><button class="link" data-action="navigate" data-view="direction">方向与边界 ${icon('arrow')}</button></section>` + selfStats() + selfBlockers() + `<div class="self-section-heading"><h2>真实研发记录</h2><span>${pill(data.source==='local-controller'?'实时控制器':'导出快照')}</span></div>` + selfBootstrapCard() + `<section class="card">${data.runs.map(selfRunCard).join('')||'<div class="empty">尚未发起 Harness 自主迭代。</div>'}</section>`;
}
function renderSelfConversation() {
  const s = currentSession(), data = selfData.snapshot, run = selfSessionRun(), d = dockState(), trajectory = sessionView()==='trajectory';
  return `<section class="conversation-workspace ${d.open&&!d.floating&&!d.fullscreen?'has-dock':''}" style="--dock-width:${Math.max(300,Math.min(800,d.width||520))}px"><section class="conversation-main" aria-label="真实研发记录"><header class="session-header"><button class="icon-btn" data-action="toggle-sidebar" aria-label="展开或收起侧栏">${icon('sliders')}</button><div class="session-heading"><h1>${s.id==='self-controller'?'自主研发 · 当前进展':esc(s.title)}</h1><span>航向 Vela · ${esc(selfModeLabel())}</span></div><div class="grow"></div><button class="icon-btn" data-action="self-refresh" aria-label="刷新真实记录">${icon('refresh')}</button><button class="icon-btn" data-action="open-tools" aria-label="展开右侧工具区">${icon('monitor')}</button></header><div class="session-viewbar"><div role="tablist" aria-label="会话视图">${[['chat','进展'],['trajectory','执行轨迹']].map(([id,title])=>`<button role="tab" aria-selected="${trajectory===(id==='trajectory')}" class="${trajectory===(id==='trajectory')?'active':''}" data-action="conversation-view" data-view="${id}">${title}</button>`).join('')}</div><span class="view-demo self-real-badge">${data?.source==='qa-fixture'?'验收样本':'真实记录'}</span></div><div class="direction-ribbon"><button data-action="select-autonomy" data-workspace="vela-self">${icon('compass')}<span class="ribbon-label">长期方向</span><span class="ribbon-goal">${esc(data?.project.direction.goal || project().direction)}</span></button><button class="ribbon-state" data-action="select-autonomy" data-workspace="vela-self">项目概览 ${icon('chevron')}</button></div><div class="conversation-target"><div id="conversation-feed" class="conversation-feed self-feed ${trajectory?'self-trace-feed':''}" data-session="${esc(s.id)}" data-view="${trajectory?'trajectory':'chat'}">${!data?selfUnavailable():trajectory?renderSelfTrajectory(run):renderSelfProgress(run)}</div></div><div class="self-session-footer"><div>${icon('compass')}<span>你调整方向，控制器根据范围推进一轮。</span></div><div class="row">${button('调整方向','self-edit-direction','ghost','sliders')}${selfRunButton()}</div></div></section>${d.open?renderDock(s,d):''}</section>`;
}
function renderSelfProgress(run) { return renderRunProgress(run); }

function renderSelfTrajectory(run) { return renderRunTrajectory(run); }

function renderSelfDock(tab) {
  const data=selfData.snapshot,run=selfSessionRun();
  if(!data)return selfUnavailable();
  if(tab.kind==='guide')return `<div class="dock-guide"><h2>检查真实证据</h2><p>来自当前仓库与控制器记录。</p><div class="dock-guide-grid">${[['files','folder','仓库文件'],['changes','git','实际变更'],['terminal','terminal','验证结果'],['plan','target','推进边界']].map(([k,i,n])=>`<button data-action="dock-open-kind" data-kind="${k}">${icon(i)}<span>${n}</span>${icon('arrow')}</button>`).join('')}</div></div>`;
  if(tab.kind==='files'||tab.kind==='document')return `<div class="self-dock-content"><h2>真实仓库文件</h2><p>${esc(data.project.repository)} · ${selfShort(data.repository.head)}</p><div class="self-file-list">${data.repository.files.map(path=>`<div>${icon('file')}<code>${esc(path)}</code></div>`).join('')}</div><p class="tiny muted">当前显示已提交文件索引；源码在项目仓库中审阅。</p></div>`;
  if(tab.kind==='changes')return `<div class="self-dock-content"><h2>实际代码变更</h2><p>${data.bootstrap?'引导开发：'+selfShort(data.bootstrap.baseSha)+' → '+selfShort(data.bootstrap.codeSha):'尚未记录引导提交'}</p><div class="self-file-list">${(data.bootstrap?.changedFiles||[]).map(file=>`<div><code>${esc(file.path)}</code><span>+${file.added??'—'} −${file.removed??'—'}</span></div>`).join('')}</div><h3>Harness 本轮候选</h3><p>${run?.candidateSha?selfShort(run.candidateSha):'尚未产生'}</p>${run?.changedFiles.map(file=>`<code>${esc(file)}</code>`).join('')||''}${run?.diffHash?button('查看候选差异','self-diff','','git'):''}</div>`;
  if(tab.kind==='terminal')return `<div class="self-dock-content"><h2>本轮验证结果</h2>${renderRunChecks(run)}</div>`;
  if(tab.kind==='legacy-terminal')return `<div class="self-dock-content"><h2>真实验证结果</h2><p>Harness ${esc(data.runtime.installedVersion||'未安装')} · ${data.runtime.probe?.passed?'headless 启动检查通过':'尚未检查'}</p><pre>${esc(JSON.stringify(data.bootstrap?.checks||{status:'等待引导开发验证'},null,2))}</pre><p class="tiny muted">命令退出码只表示工程检查；未连接交互终端。</p></div>`;
  if(tab.kind==='plan')return `<div class="self-dock-content"><h2>本轮推进边界</h2>${data.project.direction.constraints.map(c=>`<div class="criteria">${icon('shield')}<span>${esc(c)}</span></div>`).join('')}<p>单轮 ${data.acceptance.maxRunSeconds} 秒，最多 ${data.acceptance.maxChangedFiles} 个文件。</p><p class="tiny muted">缺少模型连接时不生成推测性的 AI 计划。</p></div>`;
  return `<div class="self-dock-content"><h2>尚未接入此能力</h2><p>真实工作空间目前提供文件索引、代码变更和验证证据。</p></div>`;
}
function selfConnectionDialog() {
  if(selfData.snapshot?.repository.state==='uninitialized'){modal('建立 Git 基线','当前目录需要源码基线，才能隔离和验证候选。',renderRepositoryNotice(),button('关闭','close-overlay','primary'));return;}
  if(selfData.snapshot?.source==='local-controller'){modal('本地控制器已连接','模型、运行包与源码状态分别检查。',`${selfBlockers()}<p class="small muted">运行包：${esc(selfData.snapshot.runtime.installedVersion||'未安装')}；源码：${selfShort(selfData.snapshot.repository.head)}。</p><p class="small muted">当前支持方向驱动的单轮研发。直接聊天和原生桌面功能尚未接入。</p>`,button('关闭','close-overlay','primary'));return;}
  modal('连接本地自主研发控制器','托管页面展示导出快照；本地工作台才能发起真实执行。',`<div class="self-connect-steps"><p>在项目目录使用 Node 24+，完成一次运行包安装：</p><pre>npm run harness:install</pre><p>通过本机环境或凭据管理器给控制器配置 <code>DEEPSEEK_API_KEY</code>，然后运行：</p><pre>npm run controller -- doctor --probe\nnpm run serve</pre><p>打开终端输出的本地地址，点击“自主推进一轮”。控制器会从方向自主选择工作，并记录候选、检查与整合结果。</p><p class="tiny muted">凭据只进入本地子进程；网页不接收 API Key。关闭控制器会结束它拥有的运行。</p></div>`,button('明白了','close-overlay','primary'));
}
async function selfPost(path, body) {
  if(!selfData.csrf||selfData.snapshot?.source!=='local-controller')throw new Error('请先连接本地控制器。');
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Vela-Token':selfData.csrf},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result;
}
function selfEditDirection() {
  if(selfData.snapshot?.source!=='local-controller'){selfConnectionDialog();return;}
  const direction=selfData.snapshot.project.direction;
  modal('调整长期方向','方向保存为新版本；执行中的工作需先结束。',`<form id="self-direction-form"><div class="field"><label for="self-goal">产品方向</label><textarea id="self-goal" name="goal" rows="4" maxlength="1000" required>${esc(direction.goal)}</textarea></div><div class="field"><label for="self-constraints">优先级与边界（每行一条）</label><textarea id="self-constraints" name="constraints" rows="5" maxlength="5000">${esc(direction.constraints.join('\n'))}</textarea></div><p class="tiny muted">候选可修改的文件范围与验证器仍由稳定控制器管理。</p><p id="self-direction-error" class="form-error" role="alert"></p></form>`,`${button('取消','close-overlay')}<button class="btn primary" type="submit" form="self-direction-form">保存方向</button>`);
}
function handleSelfAction(el) {
  const a=el.dataset.action;
  if(handleRunAction(el))return true;
  if(a==='self-refresh'){loadSelfSnapshot();return true;}
  if(a==='self-connect'){selfConnectionDialog();return true;}
  if(a==='self-edit-direction'){selfEditDirection();return true;}
  if(a==='self-bootstrap-details'){selfData.details=!selfData.details;render();return true;}
  if(a==='self-open-run'){const s=state.harness.sessions.find(s=>s.realRun===el.dataset.run);if(s){openSessionById(s.id);loadRunDetails(selfSessionRun());}return true;}
  if(a==='self-run'||a==='self-cancel'){
    if(a==='self-run'&&selfData.snapshot?.repository.state==='uninitialized'){selfConnectionDialog();return true;}
    if(selfData.pending)return true;
    selfData.pending=true;if(a==='self-run'){selfData.awaitingRunIds=(selfData.snapshot?.runs||[]).map(run=>run.id);selfData.launchTime=Date.now();}render();
    selfPost(a==='self-run'?'/api/runs':'/api/cancel',a==='self-run'?{}:{id:el.dataset.run}).then(()=>loadSelfSnapshot()).catch(error=>{selfData.awaitingRunIds=null;selfData.pending=false;toast(error.message);}).finally(()=>{if(a==='self-cancel')selfData.pending=false;render();});return true;
  }
  if(isSelfWorkspace()&&['new-session','session-more','edit-direction','toggle-pause','stop-session','session-permissions','session-to-project','new-workspace'].includes(a)){
    if(a==='edit-direction')selfEditDirection();else if(a==='new-session'&&selfData.snapshot?.source==='local-controller')return handleSelfAction({dataset:{action:'self-run'}});else selfConnectionDialog();return true;
  }
  if(a==='workspace-new-session'&&el.dataset.workspace===selfWorkspaceId){if(selfData.snapshot?.source==='local-controller'){activateWorkspace(selfWorkspaceId);return handleSelfAction({dataset:{action:'self-run'}});}selfConnectionDialog();return true;}
  return false;
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='self-direction-form')return;
  event.preventDefault();const form=new FormData(event.target),goal=String(form.get('goal')).trim(),constraints=String(form.get('constraints')).split('\n').map(s=>s.trim()).filter(Boolean);
  selfPost('/api/direction',{goal,constraints}).then(()=>{closeOverlay();return loadSelfSnapshot();}).then(()=>toast('方向已持久保存。')).catch(error=>{const el=document.getElementById('self-direction-error');if(el)el.textContent=error.message;});
});
document.addEventListener('DOMContentLoaded',()=>loadSelfSnapshot());
