# 让 Codex 帮你安装

这是一条面向非开发者测试者的正式安装路径：把下面的提示词交给本机 Codex，让它完成环境检查、运行向导和本地验收；账号登录、飞书权限差异、应用发布等高风险步骤仍由你在官方页面确认。

## 先判断你是否需要安装

| 你的情况 | 应该怎么做 |
|---|---|
| 只想加入团队已经部署好的项目 | **不要安装。** 让团队管理员把你加入对应项目群并分配角色；Node.js、Codex 和 Bridge 只装在团队主机上。 |
| 想用自己的电脑和本地项目独立体验 | 在自己的 Mac/Linux 上按本文安装，并使用自己有权管理的飞书自建应用。 |
| 团队要共用一台固定主机 | 只由管理员安装一次；成员通过飞书项目群使用，不共享主机凭据或 App Secret。 |

不同组织或互不信任的测试者不要共用同一份飞书 App Secret。多个本地 Bridge 也不要同时消费同一个应用的长连接事件；每个独立部署使用自己的飞书应用，或由团队明确指定唯一主机。

## 复制给 Codex

把下面整段原样发送给你电脑上的 Codex：

```text
请帮我在这台电脑安装并验证 Feishu Codex Console。严格遵守以下规则：

1. 先检查 `node --version`、`codex --version` 和 `codex login status`。Node.js 必须 >= 22；Codex 未登录时暂停，让我在本机完成官方登录。
2. 不克隆源码，不修改我现有项目的代码。
3. 先用 `npx lark-cli whoami --as bot` 检查飞书 Bot。若未绑定，只指导我运行 `npx lark-cli config init --new`；需要 App Secret 时让我本人在本机隐藏输入框或官方页面填写，不要让我发到聊天里。
4. Bot 可用后，使用交互式终端运行 `npx feishu-codex-console@next init`。遇到账号登录、飞书权限差异、应用版本发布或系统权限确认时暂停，说明我该在官方页面确认什么，等我确认后再继续。
5. 不索要、不复述、不保存 App Secret、密码、验证码、恢复码、Token 或私钥。不要把这些内容放进命令参数、日志、项目文件或 Git。
6. 只申请产品所需的最小飞书权限。不要声称开启了全部权限；只有官方页面确认并按要求发布应用版本后，才继续验证。
7. 同一认证或验证码路径失败一次后立即停止，报告失败点和安全的下一步；不要重复登录、重复等待邮件或切换到另一种认证猜测。
8. 安装后运行：
   `npx feishu-codex-console@next install-status --json`
   `npx feishu-codex-console@next doctor --json`
   只有 install-status 的 `ready` 为 true、doctor 的 `ok` 为 true，才能说明“本地服务已就绪”。warning 要如实告诉我，不能改写成通过。
9. 最后让我在飞书私聊机器人发送“状态”。只有我确认收到了机器人回复，才能说明“端到端验证通过”。若本地已就绪但飞书没有回复，不要重装，先检查应用版本、事件权限和机器人会话。
10. 完成后只给我四项结果：本地服务、飞书端到端、默认项目、仍需人工处理的事项。不要展示秘密或完整本机路径。
```

## Codex 可以做什么

- 检查 Node.js、Codex CLI 和登录状态。
- 运行公开 npm 包的交互式 `init`，不需要克隆仓库。
- 根据向导提示检查本地项目、安装后台服务并读取机器状态。
- 打开飞书官方权限确认链接，等待你确认。
- 用 JSON 契约判断本地服务是否真正就绪，而不是从一行“完成”文字猜测。

## 你必须亲自完成什么

- 登录 Codex 或飞书等官方账号。
- 创建或选择自己有权管理的飞书自建应用。
- 在本机隐藏输入框中填写 App Secret；不要把它发给 Codex。
- 核对飞书权限差异并发布待发布的应用版本。
- 最后在飞书发送“状态”，确认机器人真实回复。

Codex 应在这些节点停下来等你，而不是代替你点击安全确认或尝试读取验证码。

## 成功标准

本机先运行：

```bash
npx feishu-codex-console@next install-status --json
npx feishu-codex-console@next doctor --json
```

必须同时满足：

- `install-status` 返回 `ready: true`，健康文件与实际 PID、实例、配置路径及两个事件消费者一致。
- `doctor` 返回 `ok: true`；`warning` 可以表示可选的项目群增强能力尚未验证，但不能存在 `failed`。
- 在飞书发送“状态”后收到当前设备和项目的真实回复。
- 安装过程中没有把秘密写入聊天、项目或 Git。

`testCardDelivered: false` 不等于本地安装失败。它表示还需要在飞书完成最后一次真实消息验证；此时不要重装服务。

## 失败时怎么继续

再次运行：

```bash
npx feishu-codex-console@next install-status --json
```

按 `nextAction.code` 处理：

| code | 含义 | 安全动作 |
|---|---|---|
| `run_init` | 尚未开始 | 运行一次交互式 `init`。 |
| `resume_init` | 向导中断但安全检查点已保存 | 重新运行 `init`，不要删除配置或使用 `--force-reset`。 |
| `repair_service` | 配置存在但服务未健康 | 先运行 `doctor --json`，只修复失败项，再运行 `install`。 |
| `verify_feishu` | 本地已就绪，尚待飞书验证 | 在飞书发送“状态”；无回复时先查应用版本和事件，不重装。 |
| `repair_unsafe_config` | 配置或运行数据路径不安全 | 停止自动操作，由用户在本机修复普通文件、目录或符号链接问题。 |
| `repair_install_state` | 私有安装检查点损坏或路径不安全 | 停止自动恢复，由用户在本机检查状态文件；不使用 `--force-reset` 猜测。 |
| `ready` | 本地与安装测试均已通过 | 进入飞书运行“新手引导”。 |

完整手动路径见 [10 分钟快速上手](QUICKSTART.md)，全部安装选项见 [安装指南](INSTALLATION.md)，异常恢复见 [全项目逆向与故障恢复 SOP](FAILURE_RECOVERY_SOP.md)。
