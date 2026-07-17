# 发布检查清单

这份清单用于预发布版本和稳定版本。Git 标签必须与 `package.json` 版本完全一致。

## 自动门禁

- [ ] Ubuntu 和 macOS 均通过 `npm ci`。
- [ ] Ubuntu 和 macOS 均通过类型检查和全部单元测试。
- [ ] Ubuntu 和 macOS 均完成生产构建。
- [ ] 真实 npm tarball 能在干净目录安装，两个 CLI 名称都可执行。
- [ ] tarball 演练包含一次安装中断和断点恢复。
- [ ] tarball 能初始化运行手册且绝不覆盖已有目录，并完成一次不带 `--yes` 的只读升级预览。
- [ ] `version --json` 与兼容矩阵中的 Codex、lark-cli、配置、状态和 SQLite 版本一致。
- [ ] `npm run release:check -- v<version>` 通过。
- [ ] npm 发布通过 GitHub OIDC Trusted Publisher 生成 provenance，仓库和 Environment 中不存在长期 `NPM_TOKEN`，预发布版本进入 `next` dist-tag。

这些门禁由 CI 和 Release workflow 执行；任一平台失败都不会进入 npm publish。

## macOS 实机

- [ ] 使用非开发者的测试账号完成一次全新 `init`。
- [ ] LaunchAgent 重装后只有一个消息消费者和一个卡片消费者。
- [ ] `bridge-health.json` 报告正确 PID、实例和配置路径。
- [ ] 私聊测试卡、新手引导、项目切换和安全首次任务可用。
- [ ] 服务重启后会话、队列和 SQLite 状态可恢复。
- [ ] 已启动任务在重启后中断而非重放，任务记录与卡片冲突可以保守对账。
- [ ] 结构迁移前生成备份；模拟迁移失败后自动恢复旧数据库。
- [ ] `doctor --fix` 和脱敏诊断包在自定义 `BRIDGE_DATA_DIR` 下可用。
- [ ] Remote Ready 可以开启和关闭，卸载服务后不残留 `caffeinate`。
- [ ] 从旧仓库 `.env` 迁移一次，旧数据可读且旧文件未删除。
- [ ] 从上一 npm 版本执行升级：活动任务被拒绝、排队任务保留、备份 ID 可见、新服务版本和双消费者验证通过。
- [ ] 模拟新服务健康失败，数据和仍可用的旧包被自动恢复并验证。

## Linux 实机

- [ ] 使用带 systemd user service 的干净账号完成一次全新 `init`。
- [ ] unit 使用指定 `DOTENV_CONFIG_PATH`，重启和登录后自动恢复。
- [ ] `journalctl --user` 没有凭据、消息正文或未脱敏标识泄漏。
- [ ] 私聊测试卡、新手引导、项目切换和安全首次任务可用。
- [ ] 停止、重新安装和卸载不会删除用户配置与运行数据。
- [ ] `backup`、`backups`、`stop` 和 `rollback` 流程在 systemd user service 上通过。
- [ ] 从上一 npm 版本执行一次升级和一次显式允许的降级演练。

## 飞书端到端

- [ ] Bot、消息事件、卡片事件和 CardKit 探测全部通过。
- [ ] 私聊自动发送测试卡；群聊未确认时不会自动发送。
- [ ] 管理员、操作者、只读成员和项目 ACL 使用三个测试账号验证。
- [ ] 两名操作者在群聊完成任务转交、发起人收回和管理员接管；私聊不展示交接控件。
- [ ] 团队工作台不展示提示词、结果、路径、附件或原始 open_id。
- [ ] 运行手册固定任务、默认参数一键任务、显式参数命令和无效配置失败关闭均通过。
- [ ] 运行手册不能提升 sandbox，含提交、推送、部署或 PR 的模板和参数均被拒绝。
- [ ] 普通操作者无法超过 `CODEX_OPERATOR_SANDBOX_MODE`。
- [ ] 完全访问模式下，未加入白名单的群聊仍被拒绝。
- [ ] 提交、推送、发布、部署和 PR/MR 操作仍要求短期确认。
- [ ] 普通回复四种状态、CardKit 失败文本兜底和终态任务卡失败通知均通过。

## 发布内容

- [ ] `CHANGELOG.md` 包含用户可见变化、迁移影响和已知限制。
- [ ] README、安装、排错和安全文档与当前 CLI 参数一致。
- [ ] tarball 不包含 `.env`、SQLite、日志、附件、真实 ID 或个人路径。
- [ ] GitHub Release notes 清楚标记 prerelease/stable，并给出升级与回滚方法。
- [ ] 中英文入口、配置参考、兼容矩阵、演示、Roadmap 和 Good First Issue 入口与当前版本一致。
- [ ] 发布后从 npm 注册表重新安装一次，并核对 CLI 版本和 dist-tag。
