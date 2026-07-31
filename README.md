# orchestrate-parallel-work

一个独立发布的 Agent Skill，用于判断复杂任务是否值得拆分，并在授权范围内组织隔离工作单元、分波次执行、统一集成和独立终验。

## 核心亮点

> **按工作单元动态选择模型与推理等级。**
>
> 它不会让整个复杂任务固定使用同一种配置。对每个工作单元，先遵守适用的 `AGENTS.md` 规则；再从当前运行时实际支持的选择中，按难度、风险、上下文规模、工具调用和验收要求挑选**足够可靠的最轻量组合**。适合时会继承父级配置。执行前会验证该组合确实可用，并记录所选配置及理由；不会把具体模型名称写死在规范中。

## 主要优势

- **不为了并行而并行**：简单任务直接完成；只有多个单元能够独立就绪、独立验收且不存在写入冲突时才并行。
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
5. **设计工作单元**：为每个单元指定负责人、隔离方式、输入快照、产物、验证证据、经规则与可用性核对的模型/推理配置、集成顺序和失败回退。
6. **按依赖分波次执行**：只启动前置依赖已通过、输入稳定且没有写入冲突的单元，并持续维护状态和证据。
7. **逐单元验收并统一集成**：验证通过后才能接入整体；每完成一波都运行相关集成检查。
8. **独立终验与交付**：从原始目标出发复核端到端结果、边界情况、安全性、可回滚性和交付完整性。

## 文件

- `skills/orchestrate-parallel-work/SKILL.md`：完整的 Skill 定义和执行规范。
- `skills/orchestrate-parallel-work/agents/openai.yaml`：Codex/OpenAI 界面元数据。

## 支持范围

目前仅支持 Codex。

## 安装

需要 Node.js 22.20.0 或更高版本，并确保 `npx` 可用。`skills@1.5.21` 是本项目已测试的 CLI 版本。

### 最新版：全局安装

将 skill 安装到当前用户的 Codex skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent codex --global --yes
```

### 最新版：安装到当前项目

将 skill 安装到当前项目的 Agent skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent codex --yes
```

### 可复现安装：v0.1.1

需要固定版本时，使用 GitHub 中该版本的直接 skill 目录 URL，并固定已测试的 CLI：

```bash
npx --yes skills@1.5.21 add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/v0.1.1/skills/orchestrate-parallel-work" --agent codex --global --yes
```

### 免安装临时使用

下载到临时目录并启动 Codex，不进行持久安装：

```bash
npx --yes skills use "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work" --agent codex
```

### 给 AI 的安装 Prompt

将下面英文 Prompt 原样交给 AI；它只负责安装和验证，不会执行该 skill：

```text
Install and verify the `orchestrate-parallel-work` skill globally for Codex only. Do not install it for any other agent and do not modify, remove, update, or reinstall unrelated skills.

First inspect the installed global Codex skills with this exact command:

npx --yes skills@1.5.21 list --global --agent codex

Then run this exact pinned v0.1.1 installation command whether or not the skill is already present. The `add` command installs a new copy or replaces the existing copy of this skill without changing unrelated skills:

npx --yes skills@1.5.21 add "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/v0.1.1/skills/orchestrate-parallel-work" --agent codex --global --yes

Read the complete output of every command. If output could be truncated, redirect it to a temporary file and read that file completely. Then verify the result with this exact command:

npx --yes skills@1.5.21 list --global --agent codex

Confirm that the installed copy contains `SKILL.md`, `agents/openai.yaml`, `references/codex-runtime.md`, and `references/validation.md`. Read the installed `SKILL.md` frontmatter and confirm that its name is `orchestrate-parallel-work`. Do not run, invoke, or otherwise execute the orchestration skill; only install and verify it. Report whether this was a first installation or replacement, the installation path, and the verification result.
```

## 许可证

本项目采用 [MIT License](LICENSE)。
