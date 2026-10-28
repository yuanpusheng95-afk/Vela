import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const selfSource=await readFile(new URL('../dist/self-ui.js',import.meta.url),'utf8');
const runSource=await readFile(new URL('../dist/run-ui.js',import.meta.url),'utf8');
function ui(overrides={}){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const c=vm.createContext({document:{addEventListener(){},getElementById(){return null;}},location:{hostname:'127.0.0.1'},fetch:async()=>{throw new Error('unexpected fetch');},AbortSignal,Intl,Date,Map,Set,JSON,Number,console,setTimeout(){return 1;},clearTimeout(){},render(){},esc:escape,icon:()=>'<svg></svg>',pill:text=>escape(text),button:text=>`<button>${escape(text)}</button>`,view:'workbench',nav:[],state:{activeProject:'vela-self'},...overrides});
  vm.runInContext(selfSource,c);vm.runInContext(runSource,c);return c;
}
test('Markdown reports are formatted while HTML and javascript links remain inert',()=>{
  const c=ui();const html=vm.runInContext('runMarkdown("## 调查依据\\n\\n- **保留** `README.md`\\n\\n<script>alert(1)</script>\\n[危险](javascript:alert(1))\\n[文档](https://example.com)")',c);
  assert.match(html,/<h3>调查依据<\/h3>/);assert.match(html,/<ul>/);assert.match(html,/<strong>保留<\/strong>/);assert.match(html,/&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/rel="noopener noreferrer"/);
});
test('progress shows failed check/output ahead of model report with no phantom bootstrap',()=>{
  const c=ui();vm.runInContext(`selfData.snapshot={source:'local-controller',serviceError:null};selfData.snapshot.project={repository:'Vela'};`,c);
  const html=vm.runInContext(`renderRunProgress({id:'abcdef01',createdAt:'2026-10-28T09:00:00Z',status:'failed',directionVersion:1,baseSha:'1234567',candidateSha:'7654321',changedFiles:['dist/app.js'],summary:'## 调查依据\\n有一项实现。',verification:{passed:false,checks:[{name:'JavaScript · app.js',passed:false,detail:'SyntaxError: missing )'}]},events:[]})`,c);
  assert.ok(html.indexOf('SyntaxError')<html.indexOf('本轮报告'));assert.match(html,/未整合/);assert.match(html,/<h3>调查依据/);assert.ok(!html.includes('BOOTSTRAP'));assert.ok(!html.includes('引导开发正在'));
});
test('important trajectory hides repetitive phase rows and merges tool results',()=>{
  const c=ui();const count=vm.runInContext(`visibleRunEvents([{kind:'harness.status',payload:{phase:'step_start'}},{kind:'harness.tool_call',payload:{callId:'one',tool:'bash'}},{kind:'harness.tool_result',payload:{callId:'one',status:'completed'}},{kind:'verification.failed',payload:{}}],'important').length`,c);
  assert.equal(count,2);
});
test('initial local API failure is visible and never silently replaced by a stale exported snapshot',async()=>{
  const calls=[];const c=ui({fetch:async path=>{calls.push(path);return {ok:false,status:409,headers:{get:name=>name==='content-type'?'application/json':'1'},json:async()=>({error:'repository failed'})};}});
  await vm.runInContext('loadSelfSnapshot()',c);assert.deepEqual(calls,['/api/snapshot']);assert.equal(vm.runInContext('selfData.snapshot',c),null);assert.equal(vm.runInContext('selfData.error',c),'repository failed');
});
test('failed detail fetch does not start an infinite render/retry loop',async()=>{
  let calls=0;const c=ui({fetch:async()=>{calls++;throw new Error('disconnected');}});
  vm.runInContext(`selfData.snapshot={source:'local-controller'};state.activeProject='other';`,c);
  await vm.runInContext(`loadRunDetails({id:'run',updatedAt:'1',eventCount:2})`,c);
  await vm.runInContext(`loadRunDetails({id:'run',updatedAt:'1',eventCount:2})`,c);
  assert.equal(calls,1);
});

test('fresh live events preserve an already loaded older page and its pagination cursor',async()=>{
  const page=(seqs,hasMore)=>({events:seqs.map(seq=>({seq,kind:'harness.status',payload:{}})),totalEvents:5,beforeSeq:seqs[0],hasMore});
  const pages=[page([3,4],true),page([1,2],false),page([4,5],true)];
  const c=ui({fetch:async()=>({ok:true,json:async()=>pages.shift()})});
  vm.runInContext("selfData.snapshot={source:'local-controller'};state.activeProject='other';",c);
  await vm.runInContext("loadRunDetails({id:'run',updatedAt:'1',eventCount:4})",c);
  await vm.runInContext("loadRunDetails({id:'run',updatedAt:'1',eventCount:4},{older:true})",c);
  await vm.runInContext("loadRunDetails({id:'run',updatedAt:'2',eventCount:5})",c);
  assert.equal(vm.runInContext("JSON.stringify(runUi.details.get('run').events.map(e=>e.seq))",c),'[1,2,3,4,5]');
  assert.equal(vm.runInContext("runUi.details.get('run').beforeSeq",c),1);
  assert.equal(vm.runInContext("runUi.details.get('run').hasMore",c),false);
});

test('tool titles use an action and path rather than only the internal event name',()=>{
  const c=ui();assert.equal(vm.runInContext(`eventTitle({kind:'harness.tool_call',payload:{tool:'workspace_files.read',input:'{"path":"dist/self-ui.js"}'}})`,c),'读取文件 · dist/self-ui.js');
});
