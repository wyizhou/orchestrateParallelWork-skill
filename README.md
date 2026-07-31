# orchestrate-parallel-work

一个独立发布的 Agent Skill，用于判断复杂任务是否值得拆分，并在授权范围内组织隔离工作单元、分波次执行、统一集成和独立终验。

## 文件

- `SKILL.md`：完整的 skill 定义和执行规范。
- `agents/openai.yaml`：Codex/OpenAI 界面元数据。

## 支持范围

目前仅支持 Codex。

## 安装

需要 Node.js 22.20.0 或更高版本，并确保 `npx` 可用。

### 一键全局安装

将 skill 安装到当前用户的 Codex skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill" --skill "orchestrate-parallel-work" --agent codex --global --yes
```

### 安装到当前项目

将 skill 安装到当前项目的 Agent skills 目录：

```bash
npx --yes skills add "https://github.com/wyizhou/orchestrateParallelWork-skill" --skill "orchestrate-parallel-work" --agent codex --yes
```

### 免安装临时运行

下载到临时目录并启动 Codex，不进行持久安装：

```bash
npx --yes skills use "https://github.com/wyizhou/orchestrateParallelWork-skill" --skill "orchestrate-parallel-work" --agent codex
```
