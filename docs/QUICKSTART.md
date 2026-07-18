# 10 分钟快速上手

这份文档只讲一件事：让一台已经能运行 Codex 的 Mac 或 Linux 电脑，在飞书里收到第一条任务。

> 当前仍是公开测试版，请使用 `@next` 安装。管理员只需在运行 Codex 的电脑上部署一次，其他团队成员不需要安装 Node.js、Codex 或本项目。

## 先理解它怎么工作

```text
飞书消息 → 飞书长连接 → 你电脑上的 Bridge → 本机 Codex → 原飞书会话
```

- 不需要公网 IP、域名、Webhook 或开放 SSH/HTTP 端口。
- 电脑必须开机、联网，Codex 和 Bridge 服务必须在线。
- 任务实际读取和修改的是这台电脑上明确授权的项目目录。

## 1. 准备本机

需要：

- macOS，或支持 systemd user service 的 Linux。
- Node.js 22 或更高版本。
- 本机 Codex 已登录。
- 至少一个准备授权给机器人的本地项目目录。

先检查：

```bash
node --version
codex --version
codex login
```

## 2. 准备飞书自建应用

在飞书开放平台创建一个企业自建应用，然后完成下面四项：

1. 启用“机器人”能力。
2. 添加权限 `im:message:readonly` 和 `cardkit:card:write`。
3. 在“事件与回调”中选择长连接，并订阅：
   - `im.message.receive_v1`
   - `card.action.trigger`
4. 创建并发布一个应用版本，让权限和事件订阅真正生效。

如果要在群聊使用，还需要把机器人加入目标群。权限或事件后来有变化时，要再次发布应用版本。

## 3. 在本机绑定飞书应用

运行：

```bash
npx lark-cli config init --new
npx lark-cli whoami --as bot
```

按提示填写飞书应用的 App ID 和 App Secret。Secret 由 `lark-cli` 保存在用户配置目录，不要写入项目 `.env`，也不要提交到 Git。

已有 `lark-cli` 应用配置时，第一条命令去掉 `--new`。

## 4. 运行安装向导

```bash
npx feishu-codex-console@next init
```

第一次使用建议：

- 选择“个人安全”预设。
- 选择一个真实的 Git 项目作为默认项目。
- 保持 `workspace-write`，不要一开始就开启完全访问。
- 向导提示监听消息时，在飞书私聊机器人发送“连接测试”。

向导会自动识别你的 `open_id` 和当前会话、写入私有配置，并安装 macOS LaunchAgent 或 Linux systemd user service。

安装完成后检查：

```bash
npx feishu-codex-console@next status
npx feishu-codex-console@next doctor
```

默认配置文件：

```text
~/.config/feishu-codex-bridge/default.env
```

## 5. 在飞书发送第一组消息

按顺序发送：

```text
新手引导
控制台
项目
读取项目
这个项目是做什么的？
```

前三条用于确认设备、Codex 和项目都正确；`读取项目` 只做本地快照，不调用模型。最后一条才会进入真实 Codex 会话。

之后可以直接自然表达，不需要先选任务类型：

```text
分析登录模块为什么容易出错，不修改文件
```

```text
在 docs 目录写一份部署说明
```

```text
修复失败测试，运行验证并告诉我改了哪些文件
```

问题和只读分析使用简洁文字回复；写文件和改代码才显示任务进度、文件变化和测试结果卡。

## 6. 群聊、多项目和会话规则

推荐团队约定：**一个项目对应一个群聊。**

- 群里新发一条顶层消息：开始一件新事情，创建独立 Codex 会话。
- 在机器人回复串中继续说：延续同一件事情和同一个 Codex thread。
- 另一个项目：进入它自己的群，或先发送“项目”切换并确认路径。
- 同时处理多个项目：分别在对应项目群或不同回复串中发起，任务卡始终显示项目名。

私聊适合个人连续使用；团队协作优先使用项目群和回复串，避免上下文混在一起。

## 7. 最常用的飞书命令

| 发送内容 | 作用 |
|---|---|
| `新手引导` | 重新打开使用引导 |
| `控制台` / `状态` | 查看设备、Codex、项目、队列与远程就绪 |
| `项目` | 选择或切换项目 |
| `读取项目` | 生成 0 AI token 的项目快照 |
| `模型` / `设置` | 切换模型、推理强度和后续任务权限 |
| `额度` | 查看 Codex 账户额度与重置时间 |
| `会话` | 恢复历史 Codex 会话或新建会话 |
| `任务` | 查看运行中、排队和最近任务 |
| `追加 <要求>` | 给正在运行的任务补充要求 |
| `排队 <任务>` | 明确创建下一项独立任务 |
| `停止` | 停止当前任务并清理本会话队列 |
| `帮助` | 查看完整命令帮助 |

## 8. 在外使用前检查

在飞书发送“控制台”，确认：

- 飞书连接在线。
- Codex 引擎在线。
- 当前项目正确。
- 权限符合预期。
- Mac 已接通电源，并按需开启“远程就绪”。

远程就绪只能防止空闲睡眠，不能让关机、断网或不满足合盖运行条件的 Mac 保持在线。

## 9. 常见问题

### 给机器人发消息没有回复

依次检查：

1. 飞书应用版本是否已经发布。
2. 机器人是否已加入当前群聊。
3. 权限和两个事件是否已启用。
4. 本机运行：

```bash
npx feishu-codex-console@next status
npx feishu-codex-console@next doctor
```

### 项目列表没有目标项目

重新运行安装向导添加扫描根目录，或在私有配置中设置 `CODEX_PROJECT_ROOTS`，然后重启服务。

### 群聊被拒绝

完全访问模式下，群聊必须加入 `ALLOWED_FEISHU_CHAT_IDS`。运行：

```bash
npx feishu-codex-console@next discover
```

在目标群发送一条消息，取得 `chat_id` 后重新运行向导或更新私有配置。

### 需要升级

先预览，不会修改服务：

```bash
npx feishu-codex-console@next upgrade --config ~/.config/feishu-codex-bridge/default.env
```

确认后执行：

```bash
npx feishu-codex-console@next upgrade --config ~/.config/feishu-codex-bridge/default.env --yes
```

更多问题见 [安装指南](INSTALLATION.md)、[配置参考](CONFIGURATION.md)和[故障排查](TROUBLESHOOTING.md)。
