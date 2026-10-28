import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Controller } from './controller.mjs';
import { recordBootstrap } from './bootstrap.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const root = resolve(option('--root') || '.');
const action = args[0] || 'status';
const help = `Vela 本地控制器 · Node 24+
  npm run controller -- doctor --probe   检查固定版本运行包，不调用模型
  npm run controller -- status           查看真实仓库和持久记录
  npm run controller -- run              从当前方向自主选择并执行一轮
  npm run controller -- export           刷新工作台只读快照
  npm run controller -- direction --file <json>  保存 {goal,constraints} 方向版本
  npm run controller -- recover <run-id>  核对已失去所属进程的执行，禁止自动重放
  npm run controller -- record-bootstrap --base <sha>  独立检查并记录外部引导开发
  npm run serve                         打开本地工作台（同源 API）
可用 --root <repo> 指定源码仓库。仅从本地进程环境读取 DEEPSEEK_API_KEY。`;

if (['help', '--help', '-h'].includes(action)) { console.log(help); }
else {
  let controller;
  try {
    controller = await Controller.open(root);
    const stop = () => controller.stop();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    let result;
    if (action === 'doctor') result = await controller.doctor({ probe: args.includes('--probe') });
    else if (action === 'status') result = await controller.snapshot();
    else if (action === 'export') result = await controller.exportSnapshot();
    else if (action === 'run') { result = await controller.run(); await controller.exportSnapshot(); process.exitCode = result.status === 'blocked' ? 2 : ['integrated', 'no_change'].includes(result.status) ? 0 : 1; }
    else if (action === 'recover') { result = await controller.recover(args[1]); await controller.exportSnapshot(); }
    else if (action === 'record-bootstrap') { result = await recordBootstrap(controller, option('--base')); await controller.exportSnapshot(); }
    else if (action === 'direction') {
      const body = JSON.parse(await readFile(resolve(option('--file') || ''), 'utf8'));
      if (typeof body.goal !== 'string' || body.goal.trim().length < 5 || body.goal.length > 1000 || !Array.isArray(body.constraints)
        || body.constraints.some(value => typeof value !== 'string' || value.length > 1000)) throw new Error('invalid_direction: 需要 goal 和字符串数组 constraints。');
      result = controller.store.setDirection({ goal: body.goal.trim(), constraints: body.constraints }); await controller.exportSnapshot();
    } else throw new Error(help);
    // Status output is a public whitelist; private candidate paths and prompts stay in the database.
    if (['run', 'recover'].includes(action)) result = (await controller.snapshot()).runs.find(run => run.id === result.id);
    console.log(JSON.stringify(result, null, 2));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { controller?.close(); }
}
