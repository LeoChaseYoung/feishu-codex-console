# 全项目验收测试矩阵

这份矩阵把 [全项目正向 SOP](USER_SOP.md) 和 [全项目逆向与恢复 SOP](FAILURE_RECOVERY_SOP.md) 映射到自动化测试、真实飞书验收和发布签字。单元测试通过不等于产品通过；凡是依赖真实飞书权限、系统服务、Codex 账号或远端对象的场景，发布前必须实测。

当前 `beta.10` 实际执行记录见 [2026-07-18 验收记录](ACCEPTANCE_RUN_2026-07-18.md)。

## 1. 自动化覆盖矩阵

| SOP 范围 | 核心能力 | 自动化证据 |
|---|---|---|
| P01～P02 / N01～N05 | 安装探测、身份发现、断点恢复、配置安全与机器验收契约 | `test/capability-probe.test.mjs`、`test/discovery-lib.test.mjs`、`test/install-state.test.mjs`、`test/install-status.test.mjs`、`test/doctor-report.test.ts`、`test/setup-lib.test.mjs`、`test/config-file.test.mjs` |
| P02～P03 / N30～N34 | 服务健康、PID/配置一致性、双消费者状态 | `test/service-health.test.mjs`、`test/health-file.test.ts`、`test/device-health.test.ts`、`test/device-recovery.test.ts` |
| P03 / N55～N61 | 自适应首页、控制台、首次成功和远程就绪 | `test/home-card.test.ts`、`test/device-card.test.ts`、`test/onboarding-card.test.ts`、`test/remote-ready.test.ts` |
| P04 / N35～N40 | 项目发现、排名、收藏、ACL、Git 状态和本地快照 | `test/project-registry.test.ts`、`test/project-card.test.ts`、`test/project-policy.test.ts`、`test/project-status.test.ts`、`test/project-overview.test.ts` |
| P05 / N22、N41～N46 | 工作话题、thread 恢复、桌面接力、本地绑定、来源和成员/会话隔离 | `test/workspace-session.test.ts`、`test/conversation-turn-session.test.ts`、`test/session-naming.test.ts`、`test/desktop-handoff.test.ts`、`test/session-handoff.test.ts`、`test/session-card.test.ts` |
| P06 / N22～N25 | 问答、分析、内容、代码、短回复继承和否定写入 | `test/task-intent.test.ts`、`test/product-response-routing.test.mjs`、`test/codex-runner.test.ts` |
| P07 / N24～N29、N41～N46 | 队列、串行锁、追加、停止、失败和重启对账 | `test/task-queue.test.ts`、`test/task-center-card.test.ts`、`test/task-failure.test.ts`、`test/task-reconciliation.test.ts`、`test/progress.test.ts` |
| P08 / N47～N54 | 模型能力、推理回退、临时权限、仓库策略和额度 | `test/model-capabilities.test.ts`、`test/control-card.test.ts`、`test/permission-lease.test.ts`、`test/project-policy.test.ts`、`test/account-quota.test.ts`、`test/quota-card.test.ts` |
| P09 / N62～N68 | 运行时问题、审批、外部动作确认、一次消费 | `test/runtime-card.test.ts`、`test/confirmation-card.test.ts`、`test/policy.test.ts`、`test/team-policy.test.ts` |
| P10 / N69～N74 | Git 基线、混合归因、测试证据、结果和 Diff 审阅 | `test/task-review.test.ts`、`test/result-card.test.ts`、`test/review-card.test.ts`、`test/task-card.test.ts` |
| P10～P11 / N74～N77 | 敏感内容脱敏、卡片/文本可靠降级 | `test/redaction.test.ts`、`test/response-card.test.ts`、`test/fallback-card-session.test.ts`、`test/card-session-reliability.test.ts` |
| P12 / N06～N13 | 未绑定群安全提示、不可变绑定、绑定工作台 | `test/policy.test.ts`、`test/state-store.test.ts`、`test/project-workspace.test.ts`、`test/project-card.test.ts` |
| P13 / N14～N21 | 自动建群顺序、步骤持久化、补偿和 single-flight | `test/project-chat-service.test.ts`、`test/lark-cli-retry.test.ts`、`test/doctor-capabilities.test.ts` |
| P12～P14 / N78～N80 | schema v3 绑定迁移、唯一性和重启恢复 | `test/state-store.test.ts`、`test/state-migration-backup.test.ts`、`test/state-backup.test.ts` |
| P15 / N81～N86 | 团队目录、交接、ACL、聚合隐私和运行手册 | `test/team-directory.test.ts`、`test/team-card.test.ts`、`test/team-policy.test.ts`、`test/runbooks.test.ts`、`test/runbook-card.test.ts`、`test/runbook-template.test.mjs` |
| P17 / N87～N91 | doctor、诊断包、重试和维护命令 | `test/diagnostics.test.ts`、`test/lark-retry.test.ts`、`test/lark-cli-retry.test.ts`、`test/maintenance.test.ts` |
| P18 / N92～N98 | 备份、迁移回滚、旧安装迁移和安全升级 | `test/state-backup.test.ts`、`test/state-migration-backup.test.ts`、`test/migrate-legacy.test.mjs`、`test/upgrade-lib.test.mjs` |
| P19～P20 / N99～N103 | 版本契约、安装/卸载、真实 tarball 与发布门禁 | `test/version.test.ts`、`test/install-detection.test.mjs`、`npm run test:package`、`npm run release:check` |
| 全范围 | Card 2.0 唯一 ID、布局上限和敏感文本契约 | `test/card-contract.test.ts` 及各 `*-card.test.ts` |

## 2. 真实正向 E2E

| ID | SOP | 操作 | 预期 UI | 权威证据 |
|---|---|---|---|---|
| E2E-P01 | P01～P02 | 非开发者分别按手动路径和“让 Codex 帮我安装”路径全新 `init`，私聊测试消息 | 助手在官方安全确认处暂停；安装成功卡字段真实 | `install-status.ready=true`、`doctor.ok=true`，健康文件 PID/配置正确，双消费者 ready |
| E2E-P02 | P02 | 运行新手引导和第一次只读项目任务 | 引导只在真实成功后完成 | 零文件变化、零写权限租约消费 |
| E2E-P03 | P03 | 打开首页、控制台，断开再恢复事件连接 | 状态和采样时间真实，恢复通知去重 | 健康快照与 UI 一致 |
| E2E-P04 | P04 | 搜索两个同名项目、收藏、切换并读取项目 | 路径可辨识，影响确认正确 | `读取项目` 零模型调用、零文件变化 |
| E2E-P05 | P05 | 新建、继续、压缩和恢复一个 native thread；从飞书在本机打开；本机新增一轮后回飞书继续；显式绑定同项目本地 thread | 两端继续同一会话，来源/时间更新，新会话隔离，控件不进入 Codex 历史 | 打开、继续和绑定前后 thread ID 一致；项目、成员和队列作用域正确 |
| E2E-P06 | P06 | 分别提问、只读分析、写文档、改代码 | 四类回复/卡片与权限匹配 | 只读零写入；写入有真实文件证据 |
| E2E-P07 | P07 | 运行中普通追加、显式排队、停止 | 追加数、队列位置和停止影响清楚 | 同会话/同项目串行，无隐式撤销 |
| E2E-P08 | P08 | 切模型/推理、查看额度、申请和撤销临时完全访问 | 设置只作用下一轮；额度来源真实 | 租约作用域和过期回落正确 |
| E2E-P09 | P09 | 回答普通问题、允许一次审批、处理外部动作确认 | 每张卡只消费一次 | 所有者、项目、有效期和审计一致 |
| E2E-P10 | P10 | 在干净和预先脏工作区各完成代码任务 | 归因、Diff 和最后测试状态正确 | Git/文件/测试命令与卡片一致 |
| E2E-P11 | P11 | 上传支持图片和文本附件完成任务 | 附件可用且不显示缓存路径 | 私有缓存权限和保留策略正确 |
| E2E-P12 | P12 | 管理员在已有群首次绑定 | 绑定卡变工作台并置顶 | v3 唯一绑定和远端置顶存在 |
| E2E-P13 | P13 | 私聊一键创建项目群 | 群、成员、工作台、置顶、入口完成 | 只有一个 chat；三步 setup 成功 |
| E2E-P14 | P14 | 两个项目群、每群两个话题同时任务 | 卡片项目/话题清楚 | thread、权限、队列和写锁隔离 |
| E2E-P15 | P15 | 两名操作者交接、收回、管理员接管并运行安全 runbook | 控制者变化清楚，团队面板无正文 | owner 不变、ACL 复查、审计齐全 |
| E2E-P16 | P16 | 开启/关闭 Remote Ready 并模拟空闲 | 控制台状态真实 | `caffeinate` 生命周期与开关一致 |
| E2E-P17 | P17 | 运行 doctor、doctor --fix 和 support-bundle | 修复范围和输出路径明确 | 不改业务配置/代码，包已脱敏且 0600 |
| E2E-P18 | P18 | 备份、升级预览、执行升级、手动回滚各一次 | 版本、备份 ID 和恢复状态明确 | SQLite 完整、配置/队列保留、双消费者 ready |
| E2E-P19 | P19 | 无活动任务时卸载再重新安装 | 服务停止，数据保留说明明确 | 无残留 Bridge/Remote Ready，旧状态可恢复 |
| E2E-P20 | P20 | 从真实 tarball 干净安装并运行发布检查 | 双 CLI 和文档入口可用 | tarball 无私有数据，版本契约一致 |

## 3. 真实逆向 E2E

### 3.1 安装、连接、项目与会话

| ID | 故障注入 | 对应 N | 必须看到 | 必须确认没有发生 |
|---|---|---|---|---|
| E2E-N01 | 使用无效 Bot 身份、移除消息事件或让同一认证路径失败一次 | N01～N02 | 安装阻断、精确修复动作；助手停止等待用户 | 虚假安装成功、不可用服务启动、重复 OTP/登录、索要秘密 |
| E2E-N02 | 移除项目群增强 scope | N03～N04 | 私聊可用、增强能力缺失/未知 | 把未知显示为已验证 |
| E2E-N03 | 断开一个/两个事件消费者 | N30～N32 | 降级/离线和采样时间 | 离线仍接受或承诺执行任务 |
| E2E-N04 | 破坏 PID 或配置路径一致性 | N34 | install/status 失败关闭 | 在错误实例上显示健康 |
| E2E-N05 | 移动当前项目目录 | N39 | 项目不可用、绑定保留 | 静默切换到同名目录 |
| E2E-N06 | 恢复不存在/跨项目 thread；运行中尝试打开或改绑；模拟桌面端不可用；本机另开 thread | N41、N43、N46 | 明确拒绝或显示未打开，并给出同 thread 降级命令 | 假装恢复/打开、取消现有任务、静默改绑或创建替代 thread |

### 3.2 任务、模型、权限与交互

| ID | 故障注入 | 对应 N | 必须看到 | 必须确认没有发生 |
|---|---|---|---|---|
| E2E-N07 | 无上下文发送“继续”，再发送“不要改文件但分析修改点” | N22～N23 | 两次均为只读 | 文件变化或完全访问租约消费 |
| E2E-N08 | 同项目两个写任务并发 | N24、N43 | 后一项排队 | 同项目同时写入 |
| E2E-N09 | 排队后撤销 ACL/收紧仓库策略 | N25、N68 | 启动前失败关闭 | 读取项目或执行命令 |
| E2E-N10 | 运行任务时终止 Bridge | N26、N46 | 任务中断并保留审阅 | 自动再执行一次 |
| E2E-N11 | 重放同一消息和 callback | N27、N63 | 只处理一次 | 重复任务、审批或外部动作 |
| E2E-N12 | 移除已保存模型/推理档位 | N48～N49 | 明确安全回退 | 崩溃或静默覆盖永久设置 |
| E2E-N13 | 让额度接口失败 | N53 | 显示不可用 | 伪造百分比或预计重置时间 |
| E2E-N14 | 使租约过期、切项目和切 thread | N51 | 自动回落安全默认 | 租约跨作用域复用 |
| E2E-N15 | 构造无效/符号链接仓库策略 | N52 | 任务失败关闭 | 忽略策略继续执行 |
| E2E-N16 | 非控制者点击问题/审批 | N64 | 越权拒绝 | 恢复 Codex turn |
| E2E-N17 | Codex 发起 secret question | N65 | 无远程回答入口 | 秘密进入卡片、日志或提示词 |
| E2E-N18 | 外部动作确认后改变动作/策略 | N67～N68 | 旧确认失效 | 沿用旧授权执行新动作 |

### 3.3 结果、附件与可靠回复

| ID | 故障注入 | 对应 N | 必须看到 | 必须确认没有发生 |
|---|---|---|---|---|
| E2E-N19 | 任务前脏文件被/未被任务触碰 | N70 | 仅触碰文件标记混合 | 未触碰脏文件被归因给任务 |
| E2E-N20 | 同一测试先失败后通过，再让最后一次失败 | N71～N72 | 最后一次真实状态决定视觉 | turn 完成被当成测试通过 |
| E2E-N21 | 任务后继续修改被审阅文件 | N73 | Diff 过期提示 | 把旧快照展示为当前事实 |
| E2E-N22 | Diff、测试和附件包含测试秘密 | N74、N77 | 统一脱敏/受限展示 | 飞书、outbox、支持包泄漏明文 |
| E2E-N23 | 上传超限/过期附件 | N75～N76 | 精确限制或重新上传提示 | 空文件进入 Codex、删除飞书原件 |
| E2E-N24 | 强制 CardKit 创建/更新失败 | N28、N90 | 可靠文本/outbox 兜底 | 终态结果丢失或重复执行任务 |

### 3.4 项目群与团队协作

| ID | 故障注入 | 对应 N | 必须看到 | 必须确认没有发生 |
|---|---|---|---|---|
| E2E-N25 | 非管理员在未绑定全访问群发消息/点击绑定 | N06～N07 | 联系管理员提示 | allowlist、binding、task 新增 |
| E2E-N26 | 选择已绑定其他群的项目 | N09 | 冲突群提示 | 当前项目和可信列表变化 |
| E2E-N27 | 让 SQLite 绑定写入失败 | N10 | 绑定失败 | 群被信任或开始任务 |
| E2E-N28 | 分别注入成员、工作台和置顶失败 | N16～N19 | 准确待修复步骤 | 重复建群或重发成功工作台 |
| E2E-N29 | 连点创建并重放 callback | N21 | 同一群入口 | 项目群数量增加超过 1 |
| E2E-N30 | 工作台已保存、置顶前杀进程 | N18 | 重启后置顶原消息 | 出现第二张工作台 |
| E2E-N31 | 删除远端群或移除机器人 | N78 | 绑定保留、远端异常 | 静默创建第二群 |
| E2E-N32 | 群内请求切换项目 | N80 | 指向正确项目群 | 当前绑定改变 |
| E2E-N33 | 转交给 viewer/无 ACL 成员 | N81 | 拒绝转交 | controllerId 或权限改变 |
| E2E-N34 | 运行手册参数生成外部动作 | N85～N86 | 整体失败关闭 | 静默 push/deploy/PR |

### 3.5 数据、升级、卸载与发布

| ID | 故障注入 | 对应 N | 必须看到 | 必须确认没有发生 |
|---|---|---|---|---|
| E2E-N35 | 模拟迁移失败或数据库完整性失败 | N92～N94 | 拒绝启动/自动恢复快照 | schema 半升级、原库被覆盖 |
| E2E-N36 | 有活动任务时执行升级 | N95 | 升级拒绝 | 任务被静默停止 |
| E2E-N37 | 新服务健康验证失败 | N96～N97 | 数据恢复和可用旧服务回退结果 | UI 宣称升级成功 |
| E2E-N38 | 服务运行中执行 rollback | N98 | 明确拒绝 | 在线替换 SQLite |
| E2E-N39 | 有活动任务时卸载 | N99～N100 | 先处理任务/残留提示 | 无说明中断或残留 Remote Ready |
| E2E-N40 | 将测试凭据/路径放入构建上下文 | N101～N103 | package/release 门禁失败 | 私有数据进入 tarball/Release |

## 4. 重启与幂等专项

下列边界必须分别在“动作前”“远端成功后本地保存前”“本地保存后下一步前”“终态卡片更新前”终止进程：

- 自动建群；
- 工作台发送和置顶；
- 任务入队和启动；
- 运行时问题/审批消费；
- 外部动作确认；
- SQLite schema 迁移；
- 包升级和旧服务回退。

每个边界恢复后验证：对象数量不增加、状态不倒退、已启动副作用不重放、权限重新校验、审计只记录一次有效操作。

## 5. 发布判定

### PR 门禁

```bash
npm run check
npm test
npm run build
npm run test:package
npm run release:check -- v<package-version>
```

### 预发布

- E2E-P01～P20 至少在支持的主平台各完成对应平台部分。
- E2E-N01～N40 在 macOS 完整跑一轮；Linux 服务、升级、回滚和卸载另跑一轮。
- 安装、新手引导和首个任务必须使用非开发者账号。

### 稳定版

- 全部正向、逆向、重启幂等和三角色 ACL 场景通过。
- 从上一稳定版完成升级与降级/回滚演练。
- README、SOP、配置、兼容、Roadmap、Changelog 和发布物版本一致。

### P0 阻断条件

- UI 显示成功但 SQLite、本机或飞书远端失败；
- 重复建群、重复工作台、重复任务或重复外部动作；
- 成员、项目、thread、附件或权限串线；
- secret、真实身份、私有路径或用户内容泄漏；
- 已启动任务在恢复时自动重放；
- 升级/迁移无可验证备份或失败后原数据不可读。

## 6. 实测签字模板

```text
版本 / commit：
平台 / Node / Codex / lark-cli：
飞书租户 / 测试应用（不要粘贴密钥）：
测试角色：管理员 / 操作者 / 只读成员
正向范围：E2E-P__ ～ E2E-P__
逆向范围：E2E-N__ ～ E2E-N__
备份 ID（如有）：
发现问题与 Issue：
无重复执行：是 / 否
无权限扩大：是 / 否
无敏感信息泄漏：是 / 否
验收人 / 日期：
```
