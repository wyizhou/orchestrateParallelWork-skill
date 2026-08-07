# 技术架构

本文面向希望理解、维护或审查 `orchestrate-parallel-work` 的开发者。使用与安装请先阅读项目根目录的 [README](../README.md)。

## 1. 系统边界

项目由四层组成：

1. **Skill 指令层**：`SKILL.md` 让 Planner 根据目标、风险和运行时能力设计执行图。
2. **契约与编译层**：JSON Schema 和 `graphctl.mjs` 校验 Graph、Task、Artifact、批准记录及运行状态。
3. **执行控制面**：Coordinator 按 DAG 释放 Node，登记不可变 Artifact，并维护状态与事件。
4. **可视化层**：只读 localhost Dashboard 从落地控制面生成实时页面。

`graphctl` 不生成计划，也不替 Planner 做任务拆解。它只提供确定性校验，从而保留 Skill 根据具体任务动态规划的能力。

## 2. 控制面目录

每次运行使用独立目录：

```text
.orchestration/runs/<run-id>/
├── graph-plan.json
├── agent-types.json
├── tasks/<task-id>.json
├── artifacts/catalog.json
├── artifact-payloads/<artifact>.json
├── approval.json
├── artifact-registry.json
├── node-runs.json
├── run.json
├── events.ndjson
├── state.json
├── dashboard-runtime.json
└── dashboard.log
```

计划文件参与批准 hash；运行状态不参与。`events.ndjson` 是追加式事实流，`state.json` 是最后写入的单调 revision 标记。Dashboard 生命周期文件不改变业务计划身份。

## 3. Graph Contract Schema 1.1

### Graph

Graph 是有向无环图：

- Node 对应一个可独立交付、重试和验收的 Task。
- Data Edge 绑定来源输出端口、目标输入端口和 Artifact Contract。
- Control Edge 只表达顺序依赖。
- fan-out 形成并行，fan-in 形成汇合，多层组合形成串并行。

编译器拒绝循环、悬空引用、端口不匹配、重复生产者、孤立 Node、缺失输入以及无序写入冲突。

### 执行档位

`execution_profile` 是批准内容的一部分：

| 档位 | 适用范围 | 约束 |
| --- | --- | --- |
| `lightweight` | 低风险、最多四个非验证 Node | 单 Validator、内联集成、每个 Node 合并测试/lint 证据 |
| `standard` | 一般复杂任务 | 根据实际 fan-in 决定是否创建 Integration Node |
| `assurance` | 高风险或多个信任边界 | 至少两个独立 Validator，分别关注合同一致性与边界探测 |

轻量档位只减少控制面开销，不会取消测试或 lint 门。

### Task

Task Contract 冻结目标、功能点、模块、输入输出、负责与禁止范围、外部影响、完成条件以及两道自检门。每个非 Validator Task 还声明 `boundary_dimensions`：

- 风险主题与类别；
- 必须覆盖的事实分区；
- 最少独立样例数；
- representative、boundary-pair、adjacent-pair 或 exhaustive-declared 取样策略。

精度和排序维度必须使用相邻值或穷举已声明分区，避免宽泛的“已测试时间排序”掩盖亚毫秒等缺口。

### Artifact

Artifact Catalog 是计划，Artifact Registry 是实际交付。每个实际版本记录生产 Node、attempt、Agent、URI、文件、SHA-256 digest 和验证证据。重试创建新版本；已接受输入变化会使传递依赖者进入 `stale`。

## 4. 批准与调度

规范化 hash 覆盖 Graph、Agent Types、Tasks、Artifact Catalog、范围、外部影响和验证例外。只有用户明确批准完全匹配的 Plan ID、版本和 hash，调度器才能释放 Node。

每次调度计算：

```text
effective_capacity = min(15, runtime_capacity, permission_capacity)
```

容量包含 Coordinator、Worker 和 Validator，不包含 Dashboard。Node 只有在全部前置 Node 与所需 Artifact 已接受、写入面无冲突且容量可用时才进入 `ready`。

## 5. 交付与独立验证

每个 Node 必须提交测试与 lint 的原始证据。测试不适用时只能使用计划中已声明并由用户批准的等价检查。

Validator 第一轮只接收功能点、模块、权威输入、Artifact 引用、一致性步骤和事实型边界维度，不接收实现者总结、已知缺陷或导向性结论。每个边界检查必须记录实际生成样例：

```text
case_id / partition / generated input or fixture reference
expected fact / observed fact / status / evidence reference
```

缺少分区、样例数不足、存在失败样例或 `coverage_gaps` 非空时，Validator Run 不能进入 accepted。

## 6. Dashboard 与生命周期

Dashboard 使用 Node.js 内置 HTTP 模块，固定绑定 `127.0.0.1`，默认端口 `8088`，不提供远程监听配置。它只读取控制面，不启动 Agent，也不修改计划。

页面包含 Graph、Tasks、Artifacts、Runs 和 Events 五个视图。活动 Node 与传递中的 Edge 使用动画状态；SSE 推送新 revision，轮询作为恢复路径。读取到暂时损坏或部分写入的状态时，页面保留最后一个有效 Snapshot 并显示 degraded。

结束顺序如下：

1. 写入最终 Task、Artifact、Registry、Node Run 和事件；
2. 最后写入终态 `state.json` 并递增 revision；
3. Dashboard 发布最终 Snapshot；
4. 等待已连接浏览器确认渲染，或等待5秒兜底；
5. 自动关闭 HTTP 服务；已打开页面保留最终画面。

终态运行可以以后重新启动 Dashboard 进行只读复查，此时不会再次自动退出。

## 7. 平台适配

通用核心不绑定某个模型或推理等级。运行时适配只负责把能力发现、上下文交接、权限、委派和隔离映射到宿主平台：

- Codex：`references/runtime-codex.md`
- Claude Code：`references/runtime-claude-code.md`
- 其他 Agent Skills 运行时：`references/runtime-generic.md`

无法确认并发或隔离能力时，Skill 安全降级为串行协调。

## 8. 验证入口

```bash
npm test
npm run lint
npm run test:browser
bash tests/test_cli.sh
python3 tests/validate_repository.py
```

GitHub Actions 会执行仓库结构、核心契约、CLI、语法和真实 Chromium Dashboard 回归。
