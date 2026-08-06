---
name: orchestrate-parallel-work
description: 把复杂目标编译为可审批、可追踪的 DAG，使用类型化 Task 和 Artifact 契约执行串行、并行或串并行工作，并通过独立事实验证后交付。Use when an AI agent runtime must plan or execute genuinely multi-part work with dependency graphs, delegated roles, staged artifacts, localhost visualization, approval gates, isolated workstreams, or cross-unit validation. Do not use for small single-output tasks or ordinary validation without multiple schedulable units.
---

# Orchestrate Parallel Work

把复杂工作视为经契约编译的有向无环图。先规划角色、Node、Edge、Task 和 Artifact，展示完整 Graph 并等待用户批准；只执行获批版本，按依赖释放工作，并以事实型独立验证完成交付。

## Guardrails

1. 不因拆分扩大用户授权、目标范围、写入面或外部影响。
2. 编排后必须停止；没有用户对具体 `plan_id`、`plan_version` 和 `plan_hash` 的明确批准，不启动执行者或 Validator。
3. 不让两个活动 Node 写同一资源；无法隔离时增加依赖并串行。
4. 每个 Node 恰好绑定一个可独立交付、重试和验证的 Task Contract。
5. 每个 Node 交付前必须通过预先声明的测试与 lint 门，或用户随计划批准的等价检查。
6. 不以自检或 Agent 完成声明替代独立验证和整体通过。

## 1. Confirm the operating mode

- 用户只要求分析或计划时，生成并展示计划，不执行计划。
- 用户要求实现或完成时，仍先生成计划并进入批准门；初始执行请求不等于批准尚未生成的计划。
- 用户要求继续已批准的运行时，读取实际控制面和批准记录，只继续匹配的未完成版本。
- 小而明确、单一产物且单一写入面的请求不使用本 Skill；直接完成。

批准前只允许在隔离的 `.orchestration/runs/<run-id>/` 中创建控制面文件并启动只读 localhost Dashboard。不要修改目标实现、创建执行 worktree、启动 Worker/Validator，或产生业务外部影响。

## 2. Compile the graph plan

在编排前读取 [Graph、Task、Artifact 与运行状态契约](references/graph-contracts.md)、[任务交付门与事实型独立验证](references/validation.md)，以及适用的运行时适配。

由顶层 Planner/Coordinator：

1. 冻结目标、非目标、权威输入、约束、权限、写入范围、整体验收和终端产物。
2. 选择执行档位并写入 `execution_profile`：低风险且不超过四个非验证 Node 使用 `lightweight`；一般复杂工作使用 `standard`；高风险工作使用 `assurance`。轻量模式使用单一 Validator、无专用 Integration Node，并让每个 Node 的测试和 lint 共用一个证据 Artifact；高风险模式至少使用分别聚焦 `conformance` 与 `boundary` 的两个 Validator。
3. 规划可复用的 Agent Type；必须包含只读、不可修复产物的 Validator 类型。
4. 建立 DAG。Node 是最小可交付单元；Edge 绑定来源输出端口和目标输入端口，数据身份使用 Artifact Contract 而不是文件名。
5. 为每个 Node 生成一个 Task Contract，并声明输入、输出、功能点、模块、边界维度、测试、lint、验收和失败策略。一个 Node 应只有一个独立重试/失效理由；紧密共享同一不变量的解析、规范化与聚合可以保留为共同基础，能独立交付的接口或写入面必须拆开。每个非 Validator Task 的 `boundary_dimensions` 必须声明事实型分区、最少样例数和取样策略；精度或排序维度必须使用相邻值或穷举已声明分区。
6. 建立 Artifact Catalog；包含业务产物以及每个 Node 的测试和 lint 证据产物。轻量模式把同一 Node 的两道门合并到一个证据 Artifact；其他模式分开记录。没有实际 fan-in、跨模块集成或独立失效理由时不要创建 Integration Node。
7. 计算串行、并行或串并行拓扑波次，并检查同波次写入与外部影响冲突。
8. 从本 Skill 目录解析脚本路径，使用 `node <skill-dir>/scripts/graphctl.mjs validate <plan-directory>` 编译并验证完整契约目录。Schema、references 和 `graphctl` 输出是规划接口；除非工具自身失败，不要读取 `graph-core.mjs` 或 Dashboard 实现来推断合同。不要执行未通过编译的 Graph。

V1 只允许 DAG。用新 attempt 表示重试，用新计划版本表示结构、范围或契约变化；不要用任意循环隐藏终止条件。

## 3. Materialize and show the control plane

在运行目录落地 Graph、Agent Type、Task 和 Artifact 契约，用 `graphctl.mjs summary <plan-directory> --json`复核派生统计，并按 [localhost Dashboard](references/dashboard.md) 使用 `<skill-dir>/scripts/dashboardctl.mjs start` 启动可跨 Agent 回合存活的只读页面，再以 `dashboardctl.mjs status` 验证健康和计划身份。Dashboard 默认绑定 `127.0.0.1:8088`；它不是 Agent，不占用 Agent 容量。不要直接以前台 `dashboard-server.mjs` 作为普通编排启动方式，也不要在未复核状态时声称页面仍在线。

向用户同时交付聊天摘要和 Dashboard 地址。摘要必须包含：

```text
Plan ID / Version / Hash:
Agent 角色类型数 / 预计峰值 Agents:
编排档位 / 风险等级 / 集成与证据策略:
Node 数 / Edge 数:
Task 数:
计划 Artifact 数（交付 / 证据） / 已生成 Artifact 数（批准前必须为 0）:
有效容量与预计峰值:
执行形态与拓扑波次:
测试、lint 等价检查或其他批准例外:
写入范围与外部影响:
Dashboard URL:
```

Graph 视图必须显示每个 Node 和 Edge；Edge 标出传递的 Artifact。然后把计划状态设为 `awaiting_user_approval`，停止并请求用户批准这个确定版本。

## 4. Enforce approval and capacity

只接受与当前 `plan_id`、`plan_version` 和规范化内容 hash 完全匹配的明确批准。角色、Node、Edge、Task、Artifact、范围、外部影响、验证例外或并发上限增加发生变化时，使旧批准失效、递增版本并重新展示。

运行时容量降低只会缩小波次或转为串行；告知用户但不改变任务契约。每次调度计算：

```text
effective_capacity = min(15, runtime_capacity, permission_capacity)
```

容量包含顶层 Planner/Coordinator、活动 Worker 和 Validator；Dashboard 进程不计入。未知容量不得按15推断：发现实际能力，无法验证时串行协调或报告限制。

## 5. Execute approved nodes

在每次 scheduler tick 检查批准仍有效。只有所有前置 Node 已 `accepted`、必需 Artifact 版本和 digest 已固定、写入面可隔离且有容量时，Node 才从 `blocked` 进入 `ready`。

只由顶层 Coordinator 创建、跟进或终止执行者；执行者和 Validator 不得嵌套委派。给执行者自包含的 Task Contract、确切输入 Artifact、工作目录、允许和禁止范围及验证命令。代码工作使用独立分支/worktree；非代码工作隔离文件、章节、查询、证据或外部影响。

要求每个 Node 返回实际产物及原始证据。测试或 lint 未运行、失败或缺少证据时，Node 不得进入 `submitted`、不得注册 accepted Artifact、不得释放下游。只接受计划中已批准的等价检查；执行者不能临时豁免。

状态使用：

```text
blocked → ready → active → submitted → accepted → integrated
```

并使用 `failed`、`stale`、`skipped`、`cancelled` 表示旁路状态。上游 Artifact 版本或 digest 改变时，把所有传递依赖者标记为 `stale`，隔离活动后代并用新 attempt 重验。

## 6. Register artifacts and integrate

Artifact Catalog 是批准前的计划契约；Artifact Registry 只登记实际版本、生产 Node/run/attempt/Agent、相对 URI、文件、digest、状态和验证证据。重试创建新版本，不覆盖已接受历史。

由 Coordinator 作为控制面的单一写入者原子更新 Registry、Node Run Registry、批准记录和事件。执行者只写其隔离交付面。按拓扑顺序集成已接受 Node；每一波后运行相关集成检查。

## 7. Validate facts independently

每个功能点和模块至少映射到一个未参与其实现的 Validator。Validator 第一轮只接收结构化事实白名单：功能点及预期行为、模块及路径、权威输入引用、Artifact 引用、可复现一致性步骤，以及非空的事实型 `boundary_checks`。每个检查必须引用上游 `task_id:boundary_dimension_id`，覆盖其全部分区和最低样例数；Validator 自行生成具体输入，不接收实现者样例。现有测试通过不能替代独立生成的边界输入。

不要向 Validator 提供实现者总结、自评、论证、推荐结论、预期结论、已知缺陷导向或修复叙事。Validator 默认只读，只输出 expected/observed、命令或步骤、退出码、状态、证据和覆盖缺口；不得修改产物。

Validator 必须把每个声明检查的实际 `case_id`、分区、生成输入或 fixture 引用、expected/observed、状态和证据写入 Node Run 的 `validation_observations`，并明确 `coverage_gaps`。缺少分区、样例数不足、存在失败样例或仍有覆盖缺口时，Validator Run 不得接受。

高风险或跨多个信任边界的交付使用两个独立 Validator Node，分别执行合同一致性和边界/属性探测；小型任务可由同一 Validator 执行两部分。Validator 未通过时由 Coordinator 创建修复 attempt，并在修复后进行定向复验。独立性不可用时，必须在计划中作为例外获得批准并在最终交付披露。

## 8. Report and close

保持 Dashboard 与落地的 Graph、Task、Artifact、Registry 和事件同步；每个波次和最终写入前用 `dashboardctl.mjs status` 复核，非终态意外退出时检查日志并恢复。只有终端产物集成且独立验证通过，计划才能标记 `completed`。

结束时先原子写入全部最终 Task、Artifact、Registry、Node Run 和事实事件，再把 `state.json` 作为最后一次写入递增 revision 并设置 `completed`、`failed`、`cancelled` 或其他实际终态。不要在最终 revision 落地前停止 Dashboard。服务检测到终态后会发布最终 Snapshot，等待已连接浏览器完成渲染确认，并在5秒超时兜底后自动关闭；当前页面保留最终画面且停止重连，持久化运行目录可供以后重新启动 Dashboard 检查。Coordinator 不得提前强制终止该进程。

最终报告批准版本、实际波次与峰值、Node 状态、Artifact 版本、测试/lint/集成/独立验证证据、边界检查覆盖与缺口、偏差、未解决风险、最终 Dashboard revision 和经实际健康检查确认的服务状态。不得仅因计划内检查通过就声称“没有未解决风险”。
