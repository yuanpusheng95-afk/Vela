# 航向 Vela · 自主研发工作台

人掌握方向，AI 负责调查、选择工作、实现、验证与交付。第一阶段用 Vela 自身作为验证项目。

当前包含真实的本地研发控制器和保留 Harness 工作方式的 UI。商家数据助手、经营周报仍为交互示例；“航向 Vela”读取本仓库的真实记录。没有构建 Tauri 安装包，也没有引入上游 Web Client。

## 当前闭环

1. 人保存长期方向、优先级和边界，SQLite 记录方向版本。
2. 控制器检查源码分支、未提交修改、固定运行包和模型凭据。
3. 从确切 SHA 导出独立目录，Harness 自行调查并选择一项改进。执行目录没有源仓库的 Git 元数据。
4. 稳定控制器捕获差异，拒绝越界文件、符号链接和超过范围的候选，再生成候选提交。
5. 在另一个干净检出目录运行冻结验证器，不执行候选提供的 npm 脚本。
6. 证据绑定基线 SHA、候选 SHA、差异摘要、策略、运行包与验证器；源分支仍在原基线且工作区干净时才快进整合。
7. 保存事件和工程结果。发布与产品效果单独记录，当前不自动部署。

每次发起只推进一轮。尚未实现长期调度、反馈驱动的下一轮选择、语义审查或稳定控制器升级候选控制器。工程静态检查通过不代表产品有效。

缺少模型凭据时保存 `blocked` 记录并结束，不生成模型消息或自主改进结论。外部 Codex 引导开发单独记为 `bootstrap`；测试执行器标为 `fixture-test`，均不计入 Harness 自主整合次数。

## 本地使用

控制器与运行包要求 Node 24+、Git；`npm test` 和 `npm run check` 只做静态验收，已在 Node 22.22 上通过。本轮在 Linux 验证；Windows、macOS 和 Tauri WebView 尚待原生验收。

推荐用 `git clone https://github.com/yuanpusheng95-afk/Vela.git` 获取源码。GitHub 下载的 ZIP 不含 Git 历史；运行界面会提示先建立基线，控制器不会误用上级目录的仓库。

```sh
npm run harness:install
npm run controller -- doctor --probe
npm run serve
```

`doctor --probe` 实际启动固定版本的 headless 帮助入口，不调用模型。通过本机进程环境或凭据管理器配置 `DEEPSEEK_API_KEY`，再启动控制器；不要把 Key 写入源码、浏览器表单或导出快照。

打开终端输出的本地地址，在“航向 Vela”工作空间调整方向并点击“自主推进一轮”。也可以使用 CLI：

```sh
npm run controller -- run
npm run controller -- status
npm run controller -- export
```

`run` 阻塞时退出码为 2，失败为 1，已整合或无变更为 0。状态和导出使用白名单字段，不包含凭据、私有执行路径、原始模型推理或工具参数。

方向通过本地界面持久保存，也可使用包含 `goal` 和字符串数组 `constraints` 的 JSON 文件：

```sh
npm run controller -- direction --file /absolute/path/direction.json
```

文件范围、单轮 300 秒、最多 12 个变更文件与验收规则由 `controller/policy.json` 冻结。本阶段候选只允许修改 `dist/` 产品文件和 `README.md`，不得修改控制器、验证器、运行包、策略或 `dist/self-development.json`。

### 交付前检查

交付前在仓库根目录依次运行：

```sh
npm test
npm run check
```

`npm test` 通过 Node 内置 test runner 执行 `tests/*.test.mjs`。控制器部分在独立临时 Git 仓库中验证 SQLite 重开与状态/事件一致性、并发排他、真实候选的独立检出与快进整合、失败与越界/基线变化拒绝、取消与进程丢失核对、凭据缺失和日志脱敏、Runner 的 NDJSON/版本/超时/UTF-8 行为及本地 API 来源校验；界面部分以 VM 加载 `dist/` 脚本，检查 Markdown 转义、失败展示、事件过滤与分页等。涉及仓库和数据库的测试都使用独立临时目录，不调用模型，也不依赖 `DEEPSEEK_API_KEY`。通过标准是进程退出码为 0，且汇总中 fail 与 cancelled 均为 0；任一测试失败时退出码为 1，并列出失败用例。

`npm run check` 运行 `node controller/verify-ui.mjs .`，也就是控制器使用的同一份冻结 UI 验证器。它检查 `dist/index.html` 引用的本地资源都存在且不越出 `dist/`、`dist/` 中没有符号链接、所有 `.js`/`.mjs` 文件通过 `node --check` 语法检查，并确认 `dist/shell-ui.js` 仍保留会话、插件与工具区的核心入口。通过标准是退出码为 0，输出 JSON 的 `"passed": true` 且每项 `checks` 的 `passed` 均为 `true`；失败时退出码为 1，输出会给出未通过的检查项和 `detail`，或直接给出 `error`。该检查只覆盖静态结构与语法，不替代浏览器行为与视觉验收。

## 数据与恢复

- SQLite 使用 WAL；方向、运行与按序号追加的事件持久保存，状态和对应事件在同一事务提交。
- 每个项目最多有一个执行中或等待整合的候选，多个本地进程通过数据库约束仲裁。
- 执行与验证目录位于私有临时目录。完成或失败后清理；状态不确定的候选保留供核对。
- 支持有界取消、超时和输出上限；退出期间不启动尚在准备的模型请求。
- 意外退出后用 `status` 找到运行 ID，再执行 `recover <run-id>`。不能接管存活的所属进程。失去进程的运行标为 `interrupted`，不自动重放；整合中断先核对实际分支 HEAD。
- 没有分布式租约或跨主机调度。候选临时目录丢失后需要重新开始一轮。

本地状态位于忽略提交的 `.vela/`，原始日志留在本地。执行环境使用独立目录、环境白名单及上游 workspace-write 权限，尚未完成跨平台原生沙箱验收。

## UI 与托管预览

保留单一侧栏、工作空间与会话、进展/执行轨迹、按需工具区、插件和 Automation。真实项目与示例项目分别标记来源。

`npm run serve` 使用同源 API，可保存方向、发起和取消执行。仅监听 loopback，校验 Host、Origin 与进程内随机令牌，不开放 CORS。令牌不进入快照。

托管页面只读 `dist/self-development.json`。快照包含生成时间和对应代码版本；网页不会连接访问者机器的 localhost，不能发起真实命令。浏览器 localStorage 只保存示例与界面偏好，不能改变工程记录。

## Harness 与升级

`runtime/harness/package.json` 精确固定 `@deepseek-ai/dsh@0.2.1-rc.3`，lockfile 固定传递依赖。运行包安装在项目私有目录，不修改全局 Harness。

第一版使用原生 CLI profile：

```text
node <pinned-dsh>/lib/bin.js --profile headless --json -
```

提示词经 stdin 传递，使用独立 HOME / DSH_HOME、明确的环境白名单，以及该版本支持的 `DSH_PERMISSION_MODE=workspace-write`。不复用 GUI 账号或用户 profile。暂不提供多模型路由表。

Runner 将 NDJSON 转为自有持久事件，校验单一会话、最终响应与退出状态；Harness 完成后仍须独立验证代码。完整 stdout/stderr 只留本地，记录前脱敏；托管快照不包含原始模型日志。

后续迁移原生 Runner 插件时保留项目、方向、运行、证据和 UI 协议。SDK 是可选执行适配器。升级先构建固定运行包，验证 Runner 合约和真实模型行为，再切换新任务；已有记录保留原版本，不跨版本续接会话。

当前实现固定版本拒绝、启动探测与适配边界，尚未实现多运行包热切换/回退。正式桌面仍以 Tauri 2 薄宿主为设计目标；原生桌面桥接、上游插件宿主兼容及资源占用测量尚未实施。本轮 Node 控制器是可替换的引导实现。

## 运行失败时

“进展”页首先显示当前运行的失败项、具体输出、候选 SHA 和是否整合。模型报告支持 Markdown；完整检查列表可以展开。执行轨迹默认隐藏重复步骤状态，将工具调用和返回合并，支持分类和分页。时间默认使用 Asia/Shanghai。

本地工作台可通过“导出诊断”下载当前运行的 JSON，包含验证结果和已脱敏的日志；候选差异可以单独查看。旧版本的模型说明和工具详情会尽可能从已有 stdout.jsonl 恢复，旧版没有保存的验证原始日志无法追溯生成。

验证器已修复符号链接路径与实际路径比较不一致的问题，包括 macOS 临时目录常见的路径别名；路径校验仍拒绝越界资源。失败检查不再丢弃原始验证输出。

更新代码前停止旧服务，更新后重新运行 `npm run serve`。保留本机的 `.vela/`、凭据环境和已安装运行包，以便读取已有记录。界面遇到本地 API 错误或连接断开时会明确报错，保留最后一次记录，不用导出的旧快照替代当前控制器状态。

冻结 UI 验证器检查 JavaScript 语法、本地资源和核心入口。浏览器行为、视觉回归、产品验收和发布后效果分别补充。

## 主要文件

| 位置 | 用途 |
| --- | --- |
| `controller/controller.mjs` | 单轮状态机、验证与整合 |
| `controller/store.mjs` | SQLite 方向、运行与事件 |
| `controller/harness.mjs` | 固定版本 CLI Runner |
| `controller/repository.mjs` | 独立目录、候选 SHA 与整合 |
| `controller/verify-ui.mjs` | 稳定验收入口 |
| `controller/server.mjs` / `cli.mjs` | 本地 API 与命令行 |
| `controller/bootstrap.mjs` | 外部引导开发的真实验证记录 |
| `dist/self-ui.js` / `self-ui.css` | 真实项目视图 |
| `dist/shell-ui.js` / `shell-ui.css` | 单侧栏、会话与工具区 |
| `dist/harness-ui.js` / `app.js` | 交互示例与共享 UI |

托管配置保留既有 Site 身份，后续修改继续复用。
