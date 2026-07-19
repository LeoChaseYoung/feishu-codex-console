# 安装 Feishu Codex Bridge

这份文档面向第一次部署的个人和团队维护者。目标是在不开放公网端口的前提下，让本地 Codex 在飞书中可用。

## 前置条件

- macOS 或带 systemd user service 的 Linux。
- Node.js 22 或更高版本。
- 本机安装 Codex，并已运行 `codex login`。
- 一个飞书自建应用，已启用机器人、长连接事件和 CardKit 权限。

部署者不需要手工搜索下面的权限。绑定 Bot 应用后，初始化向导会主动询问是否一键配置；也可以随时运行：

```bash
feishu-codex-bridge configure-feishu
```

该命令使用飞书官方确认页，只申请本产品需要的最小权限并展示差异，不等于“开启全部飞书权限”。以下清单用于安全审查和故障排查。

飞书应用至少需要：

- `im:message:readonly`
- `cardkit:card:write`
- `im.message.receive_v1`
- `card.action.trigger`

项目群自动化另外需要：

- `im:chat:create`
- `im:chat.members:write_only`
- `im:message.pins:write_only`
- `im:message.group_msg` 或 `im:message.group_msg:readonly`

安装器和 `doctor` 会区分“核心能力”和“项目群增强能力”。核心能力失败会阻断安装；项目群 scope 缺失或当前身份无法读取时，向导提供一键配置，用户拒绝后仍可只使用私聊和群内 `@机器人`。首次创建项目群会分别记录成员、工作台、置顶和普通消息实测结果；只有收到一条未 @ 机器人的普通消息后才显示完全就绪。

## 推荐安装

```bash
npx feishu-codex-console@next init
```

向导会依次检查运行环境、选择权限预设、选择项目、自动识别飞书成员和会话、写入私有配置并安装后台服务。服务管理器返回后，向导还会等待消息与卡片事件连接同时就绪，并核对后台进程实际读取的配置文件；任一项不一致都不会显示安装完成。

默认配置位置：

```text
~/.config/feishu-codex-bridge/default.env
```

默认数据位置：

```text
~/.local/share/feishu-codex-bridge/default/
```

配置文件使用 `0600` 权限，数据目录使用 `0700` 权限。

重新运行 `init` 时会识别已有安装、显示上次安全进度、备份旧配置并保留未知高级配置。只有显式使用 `--force-reset` 才会完整重建配置。

## 配置飞书应用身份

如果向导提示 Bot 身份不可用，运行：

```bash
npx lark-cli config init --new
npx lark-cli whoami --as bot
```

已有应用时去掉 `--new`。App Secret 由 `lark-cli` 保存在用户配置目录，不应写进桥接服务的 `.env`。

绑定后推荐立即执行：

```bash
feishu-codex-bridge configure-feishu
```

浏览器会显示将要新增的权限、事件和回调。确认前不会修改应用；确认后若开放平台要求发布新版本，请完成发布。只需要修复“群内必须 @ 才有回复”时运行：

```bash
feishu-codex-bridge configure-feishu --profile ordinary-group
```

## 自动识别 open_id

初始化向导会提示你给机器人发送一条消息，并从只读事件流中自动提取 `sender_id`、`chat_id` 和会话类型。也可以单独运行：

```bash
feishu-codex-bridge discover
```

监听最多接收一个事件，并在两分钟后自动退出。自动识别失败时，向导会回退到手工输入。团队部署仍需分别记录管理员、操作者和只读成员；不要提交包含真实 ID 的输出。

## 权限预设

### 个人安全（推荐）

- 管理员和操作者都是当前用户。
- 最大权限为工作区写入。
- 网络和 Web 搜索默认关闭。

### 团队安全

- 显式区分管理员、操作者和只读成员。
- 群聊首次由管理员选择一次项目，之后群与项目永久绑定；会话、设置和队列仍按成员或话题隔离。
- 最大权限为工作区写入。

### 高级模式

- 服务上限为完全访问。
- 普通操作者仍限制为工作区写入。
- 未绑定群只允许管理员完成首次项目选择，绑定前不会执行任务；成功后自动持久化为可信项目群。
- 初始化时必须再次确认风险。

非交互式安装高级模式必须显式传入 `--allow-full-access`。

默认情况下，私聊身份发现会在服务健康后自动回复一张安装测试卡；群聊需要再次确认。自动化环境可以使用 `--no-test-card` 跳过，或使用 `--send-test-card` 明确允许群聊测试卡。

## 非交互式安装

```bash
npx feishu-codex-console@next init \
  --yes \
  --preset personal \
  --open-id ou_replace_me \
  --workdir /absolute/path/to/project
```

团队示例：

```bash
npx feishu-codex-console@next init \
  --yes \
  --preset team \
  --open-id ou_operator \
  --admin-id ou_admin \
  --viewer-id ou_viewer \
  --workdir /srv/repos/frontend \
  --project-roots /srv/repos
```

团队安装后建议在私有配置中补充卡片友好名称：

```dotenv
FEISHU_MEMBER_LABELS_JSON={"ou_admin":"平台管理员","ou_operator":"前端同学","ou_viewer":"产品同学"}
```

名称只用于飞书卡片；SQLite 与审计仍保留真实身份 ID，数据目录和备份必须保持私有。要启用团队运行手册，在每个项目根目录生成并评审示例（不会覆盖已有文件）：

```bash
feishu-codex-bridge init-runbooks --project /absolute/path/to/project
```

完整交接、团队面板和模板安全规则见 [D9 团队协作](requirements/D9_TEAM_COLLABORATION.md)。

## 诊断和服务管理

```bash
feishu-codex-bridge doctor
feishu-codex-bridge doctor --fix
feishu-codex-bridge doctor --diagnostics /private/path/diagnostic.json
feishu-codex-bridge support-bundle
feishu-codex-bridge version
feishu-codex-bridge status
feishu-codex-bridge backup
feishu-codex-bridge uninstall
```

`doctor --fix` 只修复运行目录/文件权限、失效健康标记和超限日志，不会修改成员、项目 ACL、sandbox 或用户代码。诊断包包含有界健康、数据库和日志摘要并统一脱敏，分享前仍应人工检查。

升级前可以手动创建和列出 SQLite 一致性备份：

```bash
feishu-codex-bridge backup --config /absolute/path/team.env
feishu-codex-bridge backups --config /absolute/path/team.env
```

数据库结构迁移也会自动备份并在失败时回滚。手动恢复需要先停止服务，运行 `rollback --backup <id> --yes`，再重新 `install`。

更新 npm 包时先预览；没有 `--yes` 不会修改服务或数据：

```bash
npx feishu-codex-console@next upgrade --config /absolute/path/default.env
npx feishu-codex-console@next upgrade --config /absolute/path/default.env --yes
```

升级会拒绝活动任务，创建一致性备份，用目标包自检，替换服务并验证产品版本、PID、配置路径、心跳和两个事件消费者。失败时会尝试恢复数据，并在旧包位置仍存在时恢复和验证旧服务。完整承诺见 [兼容与版本策略](COMPATIBILITY.md)。

单独运行 `install` 也会执行同一套服务健康和配置一致性检查。慢速机器可以调整等待时间：

```bash
feishu-codex-bridge install --health-timeout 60s
```

运行时健康信息保存在实例数据目录的 `bridge-health.json`，仅包含实例、PID、配置路径、事件消费者状态和时间戳，不包含飞书凭据或消息正文。

使用非默认实例或自定义配置文件时：

```bash
feishu-codex-bridge status --config /absolute/path/team.env
```

自检失败时不会安装后台服务。修复飞书 Bot、Codex 登录或项目目录后，再运行 `doctor` 和 `install`。

## 从旧源码安装迁移

如果以前通过克隆仓库、编辑仓库根目录 `.env` 并安装 LaunchAgent 的方式运行，可以迁移到用户级配置：

```bash
npx feishu-codex-console@next migrate --from /absolute/path/to/old/feishu-codex-bridge
```

迁移器会复制并规范化旧配置，把相对路径转换为以旧源码目录为基准的绝对路径，继续使用原来的 SQLite/JSON 数据，然后运行 doctor。确认切换后，新服务必须通过健康和配置一致性检查才算迁移完成；旧 `.env` 和数据不会自动删除。非交互迁移使用 `--yes`，目标配置已存在时需显式添加 `--force`，迁移器会先备份再合并。

## 安装完成

在飞书中发送：

```text
新手引导
```

欢迎卡会根据当前状态直接给出下一步：设备离线时查看连接、没有项目时选择授权项目、准备完成时直接开始使用。卡片不会要求成员理解安装参数；团队或多项目并行时，只需记住一个项目建一个群，新事情发新消息，继续同一件事就在回复里说。之后可以直接提问、分析、写文件或执行一个安全的首次代码任务。

## 维护者发布

每次推送 `v<package version>` 标签时，Release workflow 会重新运行类型检查、测试、生产构建和 tarball 干净安装测试，然后通过 GitHub OIDC 可信发布生成 npm provenance，并创建 GitHub Release。

仓库需要配置：

- GitHub Environment：`npm`，建议要求维护者审批。
- npm 包的 Trusted Publisher：GitHub Actions、仓库 `LeoChaseYoung/feishu-codex-console`、工作流 `release.yml`、Environment `npm`，仅允许 `npm publish`。
- npm 账号开启双因素认证；仓库和 Environment 不保存长期 `NPM_TOKEN`。

标签必须与 `package.json` 完全一致，例如 `1.0.0-beta.4` 对应 `v1.0.0-beta.4`。

预发布版本只进入 npm `next`，稳定版才进入 `latest`。GitHub OIDC 发布成功不等于本机 npm CLI 已登录，`npm whoami` 的 401 也不能反推发布失败；正常发布不需要运行 `npm login`。认证或 dist-tag 出现异常时必须按 [npm 发布与认证运行手册](NPM_RELEASE_AUTH_RUNBOOK.md) 的停止条件处理，不得反复进入邮箱 OTP 或索要验证码。

Ubuntu 与 macOS 的自动门禁、两端实机验证和飞书团队权限验收见 [发布检查清单](RELEASE_CHECKLIST.md)。安装异常见 [故障排查](TROUBLESHOOTING.md)，所有环境变量见 [配置参考](CONFIGURATION.md)。

面向使用者和测试人员的完整流程：

- [全项目 SOP 总览](SOP_INDEX.md)
- [全项目正向 SOP](USER_SOP.md)
- [全项目逆向与故障恢复 SOP](FAILURE_RECOVERY_SOP.md)
- [验收测试矩阵](ACCEPTANCE_TEST_MATRIX.md)
