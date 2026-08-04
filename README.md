# orchestrate-parallel-work

一个独立发布的 Agent Skill，用于判断复杂任务是否值得拆分，并在授权范围内组织隔离工作单元、分波次执行、统一集成和独立终验。

## 核心亮点

> **按工作单元动态选择当前平台支持的执行配置。**
>
> 它不会假设所有 Agent 拥有相同的模型、effort、推理、上下文或隔离接口。对每个工作单元，先遵守当前平台和项目规则，再从实际可用能力中选择**足够可靠的最轻量执行路径**。适合时继承父级配置；缺少安全的委派、并发或隔离能力时自动转为串行，不伪装已经并行。

## 主要优势

- **不为了并行而并行**：简单任务直接完成；只有多个单元能够独立就绪、独立验收且不存在写入冲突时才并行。
- **按能力跨平台适配**：通用核心不绑定某个 Agent API；Codex 和 Claude Code 由独立适配层映射指令、上下文、委派、权限和 worktree 机制。
- **授权边界清楚**：区分只需评估或方案、明确要求执行，以及接续已有工作的不同模式，不因拆分扩大任务范围或外部影响。
- **先稳定共享基础**：多个单元依赖共同术语、接口、数据口径或安全边界时，先建立并验收最小共享基础。
- **工作单元相互隔离**：每个单元都有唯一负责人、允许和禁止触碰的范围、预期产物、验证标准与失败回退，避免多个执行者同时修改同一资源。
- **验证方式匹配任务类型**：代码使用测试、linter、类型检查和构建；数据使用断言、复算和口径核对；研究检查来源和证据；文档检查结构、引用与渲染。
- **统一集成而非简单拼接**：单元通过验收后按依赖顺序集成，每接入一波都进行相关检查，及时发现接口、术语、数据和行为冲突。
- **独立终验降低自检偏差**：由未参与实现、默认只读的 Validator 从用户目标出发复核最终成果，第一轮不预先获得实现者的自我评价或预期结论。
- **能够处理变化与失败**：隔离失败结果，识别共享基础变化导致的过期结果，并根据实际情况重试、缩小范围、重新派发或转为串行。

## 能做什么

适合包含多个依赖、写入面、专业角色或验收环节的复杂目标，例如：

- 多模块软件开发、重构、迁移和跨组件集成。
- 多 Agent 协作，以及需要分支、worktree 或独立工作流隔离的任务。
- 大型研究、资料核验和多来源证据整理。
- 数据分析、多指标计算和跨口径复算。
- 多章节报告、文档、内容生产与统一编辑。
- 需要分阶段交付、集成检查和最终验收的项目。

它会把复杂目标转换成边界清楚、依赖明确、互不冲突且可以独立验证的工作单元，最后整合为经过统一检查的完整成果。

## 工作流程

1. **确认工作模式与授权**：判断用户只需要方案、要求直接执行，还是需要接续已有工作。
2. **评估是否值得拆分**：检查复杂度、依赖、风险、协调成本和可隔离性，决定直接完成、先串行解耦或进入并行编排。
3. **冻结目标契约**：明确目标、非目标、权威输入、约束、风险、验收标准、交付位置和集成负责人。
4. **建立共享基础**：仅在多个单元共同依赖时建立术语、接口、数据、模板或安全边界，并先完成验收。
5. **设计工作单元**：为每个单元指定负责人、隔离方式、输入快照、产物、验证证据、经当前平台能力核对的执行配置或父级继承、集成顺序和失败回退。
6. **按依赖分波次执行**：只启动前置依赖已通过、输入稳定且没有写入冲突的单元，并持续维护状态和证据。
7. **逐单元验收并统一集成**：验证通过后才能接入整体；每完成一波都运行相关集成检查。
8. **独立终验与交付**：从原始目标出发复核端到端结果、边界情况、安全性、可回滚性和交付完整性。

## 文件

- `skills/orchestrate-parallel-work/SKILL.md`：完整的 Skill 定义和执行规范。
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

需要可用的 Node.js 和 `npx` 环境。以下命令始终从仓库的 `main` 分支安装当前版本，不绑定 CLI 或 Skill 的版本号。

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

After an installation or update, run `npx --yes skills list --global --agent <agent-id> --json` again and recursively compare the installed directory with the downloaded upstream payload. Confirm that there are no differences and that the installed copy contains `SKILL.md`, `references/runtime-generic.md`, `references/runtime-codex.md`, `references/runtime-claude-code.md`, and `references/validation.md`. Read the installed `SKILL.md` frontmatter and confirm that its name is `orchestrate-parallel-work`.

Do not run, invoke, or otherwise execute the orchestration skill. Report whether the result was a new installation, an update caused by differing content, or no change because the content already matched. Include the installation path and verification result.
```

## 许可证

本项目采用 [MIT License](LICENSE)。
