# 故障排查

先使用安装时的同一份配置运行：

```bash
feishu-codex-bridge doctor --config /absolute/path/to/default.env
feishu-codex-bridge status --config /absolute/path/to/default.env
```

低风险问题可让 doctor 自动修复，并生成一份不覆盖已有文件的脱敏诊断包：

```bash
feishu-codex-bridge doctor --fix --config /absolute/path/to/default.env
feishu-codex-bridge doctor \
  --diagnostics /private/path/feishu-codex-diagnostic.json \
  --config /absolute/path/to/default.env
```

诊断包仍可能包含项目名称、时间和错误上下文，提交 Issue 前请人工检查。

也可以让 CLI 自动选择私有文件名：

```bash
feishu-codex-bridge support-bundle --config /absolute/path/to/default.env
```

它不会上传文件。复制给维护者前仍需人工复核。

不要在 issue、截图或日志中公开真实 `open_id`、`chat_id`、App Secret、Token、提示词、附件路径或个人目录。

## Bot 身份不可用

```bash
npx lark-cli config init --new
npx lark-cli whoami --as bot
```

已有飞书应用时可以不带 `--new` 重新绑定。桥接服务使用 Bot 身份，不需要把 App Secret 写入 `.env`。

## 消息或卡片事件不可用

确认飞书应用已启用机器人，并通过长连接订阅：

- `im.message.receive_v1`
- `card.action.trigger`

同时确认应用具有 `im:message:readonly` 和 `cardkit:card:write`。修改权限或事件后，按飞书后台要求发布新应用版本，再重新运行 `init`。

如果检查显示“已有运行中的事件消费者”，说明当前服务已经占用该应用的长连接，这本身不是权限错误。重新安装服务时，安装器会停止旧实例并等待新实例接管。

## 服务启动但安装一直等待

安装器只有在以下条件同时满足时才显示成功：

- 后台 PID 仍存活。
- 消息和卡片两个事件消费者都已就绪。
- 实例名称与本次安装一致。
- 后台进程读取了本次指定的配置文件。
- 健康心跳没有过期。

慢速机器可先延长等待：

```bash
feishu-codex-bridge install --config /absolute/path/to/default.env --health-timeout 60s
```

macOS 日志位于实例数据目录的 `log/bridge.log` 和 `log/bridge.error.log`。Linux 使用：

```bash
journalctl --user -u feishu-codex-bridge-default -n 200 --no-pager
```

“读取了另一份配置”通常表示服务曾用不同的 `--config` 安装。使用正确路径重新运行 `install`，不要直接修改 LaunchAgent plist 或 systemd unit。

## 飞书里显示离线

检查电脑是否开机、联网和保持唤醒。在 macOS 飞书控制台中开启“远程就绪”只能防止空闲睡眠，不能绕过合盖睡眠、断电、系统更新或网络中断。

如果健康文件存在但心跳过期，先查看错误日志，再重新安装服务。不要仅修改 `bridge-health.json`；它是运行时只读证据，不是配置入口。

## 数据升级或状态异常

先确认实际版本契约：

```bash
feishu-codex-bridge version --json
```

`upgrade` 不带 `--yes` 只展示计划。如果提示仍有运行任务，请在飞书等待完成或显式停止，不要强杀服务绕过检查。升级失败信息会保留升级前备份 ID；自动恢复也失败时，按下方手工流程恢复。

查看已有备份：

```bash
feishu-codex-bridge backups --config /absolute/path/to/default.env
```

数据库迁移前会自动生成一致性快照；迁移任一步失败会恢复旧快照并拒绝启动。需要手工回滚时：

```bash
feishu-codex-bridge stop --config /absolute/path/to/default.env
feishu-codex-bridge rollback \
  --backup <backup-id> \
  --yes \
  --config /absolute/path/to/default.env
feishu-codex-bridge install --config /absolute/path/to/default.env
```

回滚前还会创建 `before-rollback` 安全备份。不要在服务仍运行时复制或替换 `state.sqlite`、`-wal`、`-shm` 文件。

## 重跑安装器发现旧数据

这是保护行为。`init` 会展示已有配置、服务、数据和最近健康状态，并在更新配置前创建 `0600` 备份。未知高级配置默认保留；只有明确使用 `--force-reset` 才完整重建。

旧源码安装使用：

```bash
npx feishu-codex-console@next migrate --from /absolute/path/to/old/source
```

迁移不会删除旧 `.env` 或数据。新服务通过验证后再手工归档旧目录。

## 完全访问模式问题

`danger-full-access` 只是服务权限上限，不会自动允许普通成员获得同等权限，也不会取消提交、推送、发布、部署等外部动作的确认。团队部署应检查：

- 管理员、操作者、只读成员是否明确分开。
- `CODEX_OPERATOR_SANDBOX_MODE` 是否仍为 `workspace-write`。
- 群聊是否加入 `ALLOWED_FEISHU_CHAT_IDS`。
- 项目根目录和 ACL 是否只覆盖必要仓库。
- 网络、Web 搜索和额外环境变量是否保持最小开放。
