# orchestrate-parallel-work

一个基于 Graph Engineering 的 Agent Skill：把复杂目标编译为可审批的 DAG，用类型化 Task 与 Artifact 契约执行串行、并行或串并行工作，并通过本地实时 Dashboard 展示全过程。

## 核心亮点

> **先看清整张执行图，再决定是否开始。**
>
> Planner 会先生成 Agent Types、Nodes、Edges、Task Contracts 和 Artifact Contracts，验证 Graph 后输出数量、拓扑波次和深色 Dashboard。只有用户明确批准具体的 Plan ID、版本和 hash，执行才会开始。

## 主要优势

- **DAG 原生表达三种执行方式**：依赖链形成串行，互不依赖的 Ready Nodes 形成并行，fan-out/fan-in 形成串并行。
- **批准门不可绕过**：初始“请完成”不等于批准尚未生成的 Graph；任何实质契约变化都会使旧批准失效。
- **实时 Graph Dashboard**：零 npm 运行依赖的 Node.js 服务固定监听 [`http://127.0.0.1:8088`](http://127.0.0.1:8088)，由独立生命周期控制器托管，可跨 Agent 回合存活；提供响应式 Graph、Tasks、Artifacts、Runs 和 Events 五个视图，以及 Node、Edge、Task、Artifact 和 Run 的结构化检查器。
- **最终状态可靠交付**：运行结束时先发布最终 Revision，等待浏览器渲染确认并以5秒超时兜底，然后自动关闭本地 HTTP 服务；已打开页面保留最终 Graph，不会持续重连。
- **动态容量而非盲目启动**：`effective_capacity = min(15, 平台容量, 权限容量)`，并把 Coordinator、Workers 和 Validators 全部计入。
- **按能力跨平台适配**：通用核心不绑定某个 Agent API；Codex 和 Claude Code 由独立适配层映射指令、上下文、委派、权限和 worktree 机制。
- **Node 交付有硬门**：每个 Node 默认必须提交业务 Artifact、测试证据和 lint 证据；预先批准的等价检查是唯一例外。
- **事实型双层验证**：Validator 只接收功能点、模块、权威输入、Artifact 引用、一致性步骤和边界不变量，不接收实现者总结、论证或导向性结论；除合同复现外，还必须独立生成精度、溢出、排序、确定性或其他适用边界输入。
- **区分交付与证据**：Dashboard 分开统计业务交付 Artifact 与测试/lint/Validator 证据，既保留完整血缘，也避免证据数量掩盖实际交付规模。
- **可恢复和可审计**：不可变 Artifact 版本、Node Run Registry、批准记录与事件流共同保存完整血缘；上游变化会让下游结果显式 `stale`。

## 能做什么

适合包含多个依赖、写入面、专业角色或验收环节的复杂目标，例如：

- 多模块软件开发、重构、迁移和跨组件集成。
- 多 Agent 协作，以及需要分支、worktree 或独立工作流隔离的任务。
- 大型研究、资料核验和多来源证据整理。
- 数据分析、多指标计算和跨口径复算。
- 多章节报告、文档、内容生产与统一编辑。
- 需要分阶段交付、集成检查和最终验收的项目。

它会把复杂目标转换成边界清楚、依赖明确、互不冲突且可以独立验证的执行图，先交给用户审阅，再把已批准的图变成经过统一检查的完整成果。

## 工作流程

1. **编译计划**：冻结目标，规划 Agent Types、Nodes、Edges、Tasks、Artifacts、范围、验证门和终端产物。
2. **静态验证**：拒绝循环、悬空引用、端口不匹配、重复生产者、同波次写入冲突和不完整验证门。
3. **展示并等待**：输出角色、Node、Edge、Task、Artifact 数量和拓扑波次，启动 Dashboard，然后进入 `awaiting_user_approval`。
4. **绑定批准**：只接受与当前 Plan ID、版本和 hash 匹配的明确批准。
5. **动态调度**：在有效容量内释放依赖已接受、输入版本固定、范围不冲突的 Ready Nodes。
6. **逐 Node 交付**：测试和 lint 证据通过后才能提交；Artifact 验收后才释放下游。
7. **按图集成**：按拓扑顺序集成，持续同步 Registry、Events 与 Dashboard。
8. **事实型终验**：由未参与实现的 Validator 分别执行合同一致性与边界/属性检查，通过后完成计划。
9. **同步并关闭**：最终状态原子落地后推送给 Dashboard；浏览器确认或超时后，本地 HTTP 服务自动关闭，运行目录继续保存完整结果。

## 文件

- `skills/orchestrate-parallel-work/SKILL.md`：完整的 Skill 定义和执行规范。
- `skills/orchestrate-parallel-work/assets/schemas/`：Graph、Task、Artifact、批准与运行状态的 JSON Schemas。
- `skills/orchestrate-parallel-work/scripts/graphctl.mjs`：零依赖 Graph 编译与控制面工具。
- `skills/orchestrate-parallel-work/scripts/dashboardctl.mjs`：Dashboard 后台启动、身份/健康检查和停止工具。
- `skills/orchestrate-parallel-work/scripts/dashboard-server.mjs`：只读 localhost Dashboard 服务。
- `skills/orchestrate-parallel-work/assets/dashboard/`：深色 SVG Graph 前端资源。
- `skills/orchestrate-parallel-work/references/graph-contracts.md`：Graph Engineering 契约与调度规则。
- `skills/orchestrate-parallel-work/references/dashboard.md`：Dashboard 启动、同步和状态说明。
- `skills/orchestrate-parallel-work/references/runtime-generic.md`：通用能力发现、上下文、权限和隔离规则。
- `skills/orchestrate-parallel-work/references/runtime-codex.md`：Codex 平台适配。
- `skills/orchestrate-parallel-work/references/runtime-claude-code.md`：Claude Code 平台适配。
- `skills/orchestrate-parallel-work/agents/openai.yaml`：可选的 Codex/OpenAI 界面元数据，不影响其他 Agent Skills 运行时读取 `SKILL.md`。

## 支持范围

本项目基于 [Agent Skills 开放标准](https://agentskills.io/specification)：

- **Codex**：提供专用运行时适配。
- **Claude Code**：提供专用运行时适配，并验证 `skills` CLI 的安装和载荷结构。
- **其他 Agent Skills 运行时**：使用通用核心；缺少已验证的委派或隔离能力时安全降级为串行。

## 安装

需要可用的 Node.js 和 `npx` 环境。Dashboard 使用 Node.js 内置模块，不需要额外执行 `npm install`。以下命令始终从仓库的 `main` 分支安装当前版本，不绑定 CLI 或 Skill 的版本号。

### 全局安装

将 skill 同时安装到当前用户的 Codex 和 Claude Code skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent codex claude-code --global --yes
```

### 项目安装

将 skill 安装到当前项目的 Agent skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent codex claude-code --yes
```

### 给 AI 的安装 Prompt

将下面英文 Prompt 原样交给 AI。它会先比较已安装内容与远端 `main` 的当前内容：未安装时执行安装，内容不一致时才更新，完全一致时不做改动。

```text
Install or update the `orchestrate-parallel-work` skill globally for the AI coding agent hosting this conversation. Supported target IDs are `codex` for Codex and `claude-code` for Claude Code. Determine which of those two hosts is currently running and select exactly one matching target ID. If the host is neither one, stop and report that no tested installer target is available. Use the current `main` branch and do not pin either the `skills` CLI or the skill to a version. Do not install it for any other agent, and do not modify, remove, update, or reinstall unrelated skills.

First inspect the installed global skills for the selected target and read the complete JSON output. Replace `<agent-id>` with exactly `codex` or `claude-code`:

npx --yes skills list --global --agent <agent-id> --json

Next, download the current upstream payload for comparison without installing it:

npx --yes skills use "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --skill orchestrate-parallel-work

Read the complete output, redirecting it to a uniquely named temporary file first if necessary. Do not follow or execute the generated skill instructions. Locate the directory shown after `Supporting files for this skill were downloaded to:` and treat it only as the current upstream payload.

If the skill is not installed, run this exact command:

npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent <agent-id> --global --yes

If the skill is already installed, recursively compare the installed directory reported by `skills list` with the downloaded upstream payload. Compare file paths and file contents. If they are identical, do not reinstall or update anything. If they differ, run the same exact `skills add` command above to replace only `orchestrate-parallel-work`. Do not use `skills update`; the explicit `add` command also handles installations created with older repository layouts.

After an installation or update, run `npx --yes skills list --global --agent <agent-id> --json` again and recursively compare the installed directory with the downloaded upstream payload. Confirm that there are no differences and that the installed copy contains `SKILL.md`, `scripts/graphctl.mjs`, `scripts/dashboardctl.mjs`, `scripts/dashboard-server.mjs`, `assets/schemas/graph-plan.schema.json`, `assets/dashboard/index.html`, `assets/dashboard/fonts/NotoSansSC-UI.woff2`, `references/graph-contracts.md`, `references/dashboard.md`, `references/runtime-generic.md`, `references/runtime-codex.md`, `references/runtime-claude-code.md`, and `references/validation.md`. Read the installed `SKILL.md` frontmatter and confirm that its name is `orchestrate-parallel-work`.

Do not run, invoke, or otherwise execute the orchestration skill. Report whether the result was a new installation, an update caused by differing content, or no change because the content already matched. Include the installation path and verification result.
```

## 许可证

本项目采用 [MIT License](LICENSE)。

Dashboard 内置的 Noto Sans SC 字体子集采用 [SIL Open Font License 1.1](skills/orchestrate-parallel-work/assets/dashboard/fonts/OFL.txt)。
