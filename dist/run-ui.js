'use strict';

const runUi = { details: new Map(), filter: 'important', expanded: new Set(), loading: new Set() };
const runStages = [['preparing','检查环境'],['executing','模型研发'],['candidate','候选变更'],['verifying','独立验证'],['integrated','整合']];
function formatRunTime(value, short = false) {
  if (!value || !Number.isFinite(new Date(value).valueOf())) return '—';
  const options = short ? {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false} : {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false};
  return new Intl.DateTimeFormat('zh-CN',{...options,timeZone:state.settings?.timeZone||'Asia/Shanghai'}).format(new Date(value));
}
function inlineRunMarkdown(text) {
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let output='',start=0;
  for(const match of text.matchAll(pattern)){
    output+=esc(text.slice(start,match.index));
    output+=match[1]!==undefined?`<code>${esc(match[1])}</code>`:match[2]!==undefined?`<strong>${esc(match[2])}</strong>`:`<a href="${esc(match[4])}" target="_blank" rel="noopener noreferrer">${esc(match[3])}</a>`;
    start=match.index+match[0].length;
  }
  return output+esc(text.slice(start));
}
function runMarkdown(value) {
  const lines=String(value||'').slice(0,24000).replace(/\r/g,'').split('\n');
  let html='',paragraph=[],list='',code=null;
  const flush=()=>{if(paragraph.length){html+=`<p>${inlineRunMarkdown(paragraph.join(' '))}</p>`;paragraph=[];}if(list){html+=`</${list}>`;list='';}};
  for(const line of lines){
    if(/^\s*```/.test(line)){flush();if(code!==null){html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;code=null;}else code=[];continue;}
    if(code!==null){code.push(line);continue;}
    if(!line.trim()){flush();continue;}
    const heading=/^\s*#{1,6}\s+(.+)$/.exec(line),item=/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
    if(heading){flush();html+=`<h3>${inlineRunMarkdown(heading[1])}</h3>`;}
    else if(item){if(paragraph.length){html+=`<p>${inlineRunMarkdown(paragraph.join(' '))}</p>`;paragraph=[];}const kind=item[1]?'ul':'ol';if(list!==kind){if(list)html+=`</${list}>`;html+=`<${kind}>`;list=kind;}html+=`<li>${inlineRunMarkdown(item[2])}</li>`;}
    else {if(list){html+=`</${list}>`;list='';}paragraph.push(line.trim());}
  }
  flush();if(code!==null)html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;
  return `<div class="run-markdown">${html}</div>`;
}
function runFailure(run) {
  const check=run?.verification?.checks?.find(check=>!check.passed);
  if(check)return {title:check.name,detail:check.detail||run.failure||'检查未通过'};
  const reason=run?.verification?.error||run?.failure;
  const known={independent_checks_failed:'独立验证未通过。展开检查结果查看具体失败项。',controller_process_lost:'执行进程已退出，需要核对本轮状态。',timeout:'模型执行超过本轮时间限制。',output_limit:'模型输出超过本轮上限，执行已停止。',runner_protocol_or_exit:'执行进程异常结束，尚未得到完整响应。'};
  return {title:run?.failureStage==='verifying'?'独立验证未通过':'本轮未完成',detail:known[reason]||reason||'旧版本未保存失败详情。可在执行轨迹中展开 verification.failed，或导出诊断。'};
}
function runName(run) { return `${formatRunTime(run.createdAt,true)} · ${selfStatusLabels[run.status]||run.status} · ${run.id.slice(0,4)}`; }
function renderRunOutcome(run) {
  if(!run)return '';
  const failed=['failed','interrupted'].includes(run.status),reason=runFailure(run);
  const report=run.verification;
  return `<section class="run-outcome ${failed?'is-failure':run.status==='integrated'?'is-success':''}" aria-label="本轮结果"><div class="row between"><div><div class="eyebrow">本轮结果 · ${esc(run.id.slice(0,8))}</div><h2>${failed?esc(reason.title):run.status==='integrated'?'候选已验证并整合':run.status==='blocked'?'执行条件未满足':run.status==='no_change'?'本轮没有代码变更':run.status==='cancelled'?'本轮已取消':'正在自主推进'}</h2></div>${selfPill(run.status)}</div>${failed?`<pre class="run-failure-detail">${esc(reason.detail)}</pre><p>本轮候选未整合。已保留的差异和检查结果可在下方查看。</p>`:run.status==='blocked'?`<p>${(run.blockers||[]).map(b=>esc(b.message)).join('<br>')}</p>`:`<p>${run.status==='integrated'?'工程检查通过；发布和产品效果仍需单独观察。':selfActiveStatuses.includes(run.status)?'模型与控制器正在执行，下方会持续更新已发生的工作。':'已完成的记录保留，可查看本轮报告。'}</p>`}<div class="run-meta"><span>方向 v${run.directionVersion}</span><span>${esc(formatRunTime(run.createdAt))}</span><span>基线 <code>${selfShort(run.baseSha)}</code></span>${run.execution?.durationMs!=null?`<span>模型执行 ${(run.execution.durationMs/1000).toFixed(1)} 秒</span>`:''}</div><div class="run-outcome-actions">${report?button('查看检查结果','self-checks','','shield'):''}${run.diffHash?button('查看候选差异','self-diff','','git'):''}${selfData.snapshot?.source==='local-controller'?`<a class="btn ghost" href="/api/runs/${encodeURIComponent(run.id)}/diagnostics" download>导出诊断</a>`:''}</div></section>`;
}
function renderRunChecks(run, compact = false) {
  const report=run?.verification;
  if(!report)return `<div class="run-empty-note">${run?.status==='executing'?'本轮尚未进入独立验证。':'尚无独立验证结果。'}</div>`;
  const heading=`<div class="row between"><h2>独立验证</h2><span>${(report.checks||[]).filter(c=>c.passed).length} 项通过 · ${pill(report.passed?'通过':'未通过',report.passed?'green':'amber')}</span></div>`;
  const body=`${report.error?`<pre class="run-failure-detail">${esc(report.error)}</pre>`:''}${(report.checks||[]).map(check=>`<details class="run-check" ${check.passed?'':'open'}><summary>${icon(check.passed?'check':'alert')}<span>${esc(check.name)}</span><small>${check.passed?'通过':'未通过'}</small>${icon('down')}</summary><pre>${esc(check.detail||'未保存详细输出')}</pre></details>`).join('')}<p class="tiny muted">验证绑定候选 ${selfShort(run.candidateSha)}；本轮${run.integratedSha?'已整合':'未整合'}。</p>`;
  return compact?`<details class="card run-check-card run-check-summary"><summary>${heading}${icon('down')}</summary>${body}</details>`:`<section class="card run-check-card" id="run-check-results">${heading}${body}</section>`;
}
function renderRunStages(run) {
  const stage=run.status==='integrated'?4:run.failureStage==='verifying'||run.verification||run.status==='verifying'?3:run.candidateSha?2:['executing','no_change'].includes(run.status)?1:0;
  return `<ol class="run-stages" aria-label="研发阶段">${runStages.map(([,label],i)=>`<li class="${i<stage||run.status==='integrated'?'done':i===stage?'current':''} ${i===stage&&['failed','interrupted'].includes(run.status)?'failed':''}"><span>${i<stage||run.status==='integrated'?icon('check'):i+1}</span>${label}</li>`).join('')}</ol>`;
}
function renderRepositoryNotice() {
  const data=selfData.snapshot;
  if(data.repository.state!=='uninitialized')return '';
  return `<section class="run-outcome is-failure"><h2>先建立 Git 基线</h2><p>${esc(data.repository.message||'当前源码目录没有 Git 提交，暂不能生成候选。')}</p><p>建议使用 Git 克隆仓库运行。若使用下载的 ZIP，可在当前源码目录执行：</p><pre>git init -b main\ngit add .\ngit -c user.name="Vela" -c user.email="vela@localhost" commit -m "Initialize Vela baseline"</pre><p class="tiny muted">提交前确认 .gitignore 已排除本地凭据、依赖和 .vela/。完成后刷新此页。</p></section>`;
}
function renderRunProgress(run) {
  const data=selfData.snapshot;
  const serviceError=data.serviceError?`<div class="run-connection-error" role="alert">无法开始新一轮：${esc(data.serviceError.message)}</div>`:'';
  if(run){
    const detail=runUi.details.get(run.id),events=detail?.events||run.events||[],texts=events.filter(e=>e.kind==='harness.text'&&e.payload.text);
    const summary=run.summary||events.findLast(e=>e.kind==='harness.final')?.payload.text;
    return `${serviceError}${selfData.error?`<div class="run-connection-error" role="status">${esc(selfData.error)}</div>`:''}${renderRunOutcome(run)}${renderRunStages(run)}${renderRunChecks(run,true)}${summary?`<section class="card run-report"><div class="row between"><h2>本轮报告</h2>${pill('模型输出')}</div>${runMarkdown(summary)}</section>`:texts.length?`<section class="card run-report"><h2>执行进展</h2>${texts.slice(-3).map(e=>runMarkdown(e.payload.text)).join('')}</section>`:selfActiveStatuses.includes(run.status)?'<div class="run-empty-note">等待下一条模型或工具记录…</div>':''}<section class="card run-change-card"><h2>候选代码</h2><div class="run-meta"><span>候选 <code>${selfShort(run.candidateSha)}</code></span><span>整合 <code>${selfShort(run.integratedSha)}</code></span></div>${run.changedFiles.length?`<div class="self-file-list">${run.changedFiles.map(path=>`<div>${icon('file')}<code>${esc(path)}</code></div>`).join('')}</div>`:'<p>本轮尚未捕获候选变更。</p>'}</section>${button('查看执行轨迹','conversation-view','ghost','activity','data-view="trajectory"')}${detail?.error?`<div class="run-connection-error">${esc(detail.error)}${button('重试读取详情','self-details-refresh','ghost','refresh')}</div>`:''}`;
  }
  return `${serviceError}${selfData.error?`<div class="run-connection-error">${esc(selfData.error)}</div>`:''}${renderRepositoryNotice()}<div class="self-feed-intro"><div class="eyebrow">${data.source==='local-controller'?'LOCAL WORKSPACE':'EXPORTED RECORDS'}</div><h2>从当前方向，开始一轮研发。</h2><p>模型先调查仓库并选择改进，控制器再独立验证候选。已完成和未完成的工作都会保留记录。</p></div><section class="card self-record-card"><h2>${data.repository.head?'本地源码基线已就绪':'等待 Git 基线'}</h2><p>${esc(data.project.repository)} · ${esc(data.repository.branch||'未建立分支')} · ${selfShort(data.repository.head)} · ${data.repository.trackedFiles} 个跟踪文件</p><p class="tiny muted">初始开发证据保存在最初的开发环境，不会自动复制到每台电脑。</p></section>${selfBlockers()}${data.bootstrap?selfBootstrapCard():''}`;
}
function eventTitle(event) {
  const p=event.payload||{};
  if(event.kind==='harness.status')return ({turn_start:'开始模型回合',step_start:'开始模型步骤',step_end:'模型步骤完成',turn_end:'模型回合结束'})[p.phase]||'模型状态更新';
  if(event.kind==='harness.session')return '建立 Harness 会话';
  if(event.kind==='harness.text')return '模型说明';
  if(event.kind==='harness.final')return '本轮报告';
  if(event.kind==='harness.error')return '模型执行错误';
  if(event.kind==='harness.tool_call'||event.kind==='harness.tool_result'){
    let input={};try{input=JSON.parse(p.input||'{}');}catch{}
    const tool=String(p.tool||''),path=input.path||input.file_path||input.filename;
    const action=/read|view_file/i.test(tool)?'读取文件':/write|edit|replace/i.test(tool)?'修改文件':/bash|shell|terminal/i.test(tool)?'运行命令':/search|grep|find/i.test(tool)?'搜索代码':tool?'调用工具 · '+tool:'工具调用';
    return event.kind==='harness.tool_result'?'工具返回'+(tool?' · '+tool:''):action+(path?' · '+String(path).slice(0,100):'');
  }
  return selfEventLabels[event.kind]||({'runner.exited':'模型进程退出'})[event.kind]||'控制器事件';
}
function visibleRunEvents(events, filter=runUi.filter) {
  const calls=new Set(events.filter(e=>e.kind==='harness.tool_call'&&e.payload.callId).map(e=>e.payload.callId));
  return events.filter(e=>e.kind!=='harness.thinking'&&!(e.kind==='harness.tool_result'&&calls.has(e.payload.callId)))
    .filter(e=>{if(filter==='all')return true;if(filter==='tools')return e.kind.includes('tool_');if(filter==='model')return ['harness.text','harness.final','harness.error'].includes(e.kind);return !['harness.status','harness.session'].includes(e.kind);});
}
function renderRunTrajectory(run) {
  if(!run)return '<div class="run-empty-note">尚无执行记录。</div>';
  const detail=runUi.details.get(run.id),events=detail?.events||run.events||[],rows=visibleRunEvents(events),results=new Map(events.filter(e=>e.kind==='harness.tool_result'&&e.payload.callId).map(e=>[e.payload.callId,e]));
  return `${renderRunOutcome(run)}<div class="run-trace-toolbar"><div role="tablist" aria-label="轨迹筛选">${[['important','关键事件'],['tools','工具'],['model','模型输出'],['all','全部']].map(([id,label])=>`<button role="tab" aria-selected="${runUi.filter===id}" class="${runUi.filter===id?'active':''}" data-action="self-trace-filter" data-filter="${id}">${label}</button>`).join('')}</div><span>${detail?.totalEvents||run.eventCount||events.length} 条记录${runUi.filter!=='all'?' · 已折叠步骤状态':''}</span></div>${detail?.hasMore?button('加载更早记录','self-load-older','ghost','history',detail.loading?'disabled':''):''}${detail?.error?`<div class="run-connection-error">${esc(detail.error)}${button('重试','self-details-refresh','ghost','refresh')}</div>`:''}<div class="self-event-ledger">${rows.map(event=>{
    const payload=event.payload||{},result=results.get(payload.callId),key=run.id+':'+event.seq,isModel=['harness.text','harness.final'].includes(event.kind);
    return `<details class="self-event run-event" data-event-key="${esc(key)}" ${runUi.expanded.has(key)?'open':''}><summary><span class="self-event-seq">${event.seq}</span><span class="run-event-title">${esc(eventTitle(event))}</span>${result?`<span class="pill ${result.payload.status==='error'?'amber':'green'}">${result.payload.status==='error'?'工具报错':'完成'}</span>`:''}<time>${formatRunTime(event.at,true)}</time>${icon('down')}</summary><div>${isModel?runMarkdown(payload.text||'旧版本未保存模型文本；可读取现有日志恢复。'):event.kind==='harness.tool_call'?`<div class="run-tool-label">${esc(payload.tool||'工具')}</div><pre>${esc(payload.input||'旧版本没有保存工具输入。')}</pre>${result?`<div class="run-tool-label">${result.payload.status==='error'?'错误输出':'工具结果'}</div><pre>${esc(result.payload.result||'旧版本未保存返回内容。')}</pre>`:''}`:`<pre>${esc(JSON.stringify(payload,null,2))}</pre>`}<div class="run-event-type">${esc(event.kind)}</div></div></details>`;
  }).join('')||`<div class="empty">${detail?.loading?'正在读取执行记录…':'当前筛选下没有记录。'}</div>`}</div><p class="self-trace-caption">时间按设置时区展示（默认 Asia/Shanghai）。工具调用与返回按调用 ID 合并，原始事件类型可展开查看。</p>`;
}
async function loadRunDetails(run, {older=false,force=false}={}) {
  if(!run||selfData.snapshot?.source!=='local-controller')return;
  let current=runUi.details.get(run.id)||{events:[]};
  const version=`${run.updatedAt}:${run.eventCount}`;
  if(current.loading||(!older&&!force&&current.version===version))return;
  current={...current,loading:true,error:''};runUi.details.set(run.id,current);
  const feed=document.getElementById('conversation-feed'),oldHeight=feed?.scrollHeight||0,oldTop=feed?.scrollTop||0;
  try{
    const response=await fetch(`/api/runs/${encodeURIComponent(run.id)}${older&&current.beforeSeq?'?before='+current.beforeSeq:''}`,{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'无法读取运行详情');
    const merged=new Map([...current.events,...data.events].map(e=>[e.seq,e])),events=[...merged.values()].sort((a,b)=>a.seq-b.seq);
    const retainedEarlierPage=!older&&current.beforeSeq!=null&&current.beforeSeq<data.beforeSeq;
    runUi.details.set(run.id,{...data,events,beforeSeq:events[0]?.seq??null,hasMore:retainedEarlierPage?current.hasMore:data.hasMore,version,loading:false});
    if(runUi.details.size>12)runUi.details.delete(runUi.details.keys().next().value);
  }catch(error){runUi.details.set(run.id,{...current,version,loading:false,error:error.message});}
  if(isSelfWorkspace()&&view==='workbench'&&selfSessionRun()?.id===run.id){render();if(older){const next=document.getElementById('conversation-feed');if(next)next.scrollTop=oldTop+next.scrollHeight-oldHeight;}}
}
async function showRunDiff(run) {
  if(!run||selfData.snapshot?.source!=='local-controller'){selfConnectionDialog();return;}
  try{const response=await fetch(`/api/runs/${encodeURIComponent(run.id)}/diff`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);modal('候选差异',`候选 ${selfShort(data.sha)} · ${run.status==='integrated'?'已整合':'尚未整合'}`,`<pre class="run-diff">${esc(data.patch.slice(0,131072))}</pre>${data.patch.length>131072?'<p class="tiny muted">此处显示前 128K 字符；完整差异保存在本地运行目录。</p>':''}`,button('关闭','close-overlay','primary'));}catch(error){toast(error.message);}
}
function handleRunAction(el) {
  const a=el.dataset.action,run=selfSessionRun();
  if(a==='self-trace-filter'){runUi.filter=el.dataset.filter;render();return true;}
  if(a==='self-load-older'||a==='self-details-refresh'){loadRunDetails(run,{older:a==='self-load-older',force:true});return true;}
  if(a==='self-checks'){modal('本轮验证结果',`运行 ${run?.id.slice(0,8)||'—'}`,renderRunChecks(run),button('关闭','close-overlay','primary'));return true;}
  if(a==='self-diff'){showRunDiff(run);return true;}
  return false;
}
document.addEventListener('toggle',event=>{const el=event.target;if(!el.matches?.('[data-event-key]'))return;el.open?runUi.expanded.add(el.dataset.eventKey):runUi.expanded.delete(el.dataset.eventKey);},true);
