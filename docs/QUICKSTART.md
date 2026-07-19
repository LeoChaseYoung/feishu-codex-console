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

## 2. 创建并绑定飞书自建应用

在飞书开放平台创建一个企业自建应用并启用“机器人”能力，然后在本机绑定：

```bash
npx lark-cli config init --new
npx lark-cli whoami --as bot
```

App Secret 只交给 `lark-cli` 保存，不要写入项目 `.env` 或提交到 Git。已有 `lark-cli` 应用配置时，第一条命令去掉 `--new`。

## 3. 一键配置本产品权限

不需要逐个查找 scope，运行：

```bash
npx feishu-codex-console@next configure-feishu
```

浏览器只会列出本产品需要的最小权限、`im.message.receive_v1` 事件和 `card.action.trigger` 回调；不会开启通讯录、日历、云文档等无关权限。核对差异并确认，如果飞书提示待发布版本，再由应用管理员完成发布。

只修复“群内普通消息必须 @ 机器人才有回复”时运行：

```bash
npx feishu-codex-console@next configure-feishu --profile ordinary-group
```

项目群创建后，再发送一条不 `@机器人` 的普通消息完成真实验证；收到回复才算配置完成。如果暂时失败，群内 `@机器人` 和私聊仍然可用。

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

能力检查分两层：Bot、消息事件和卡片事件失败会阻断安装；自动建群、邀请成员和置顶权限会显示为“已验证 / 缺失 / 当前无法确认”，不会阻断只使用私聊。第一次创建项目群时，Bridge 会按步骤再次验证，并把具体失败项显示在卡片上。

默认配置文件：

```text
~/.config/feishu-codex-bridge/default.env
```

## 5. 在飞书发送第一组消息

第一次使用只需要发送：

```text
新手引导
```

确认卡片上的项目后，点击“了解当前项目（只读）”。这会启动第一次真实 Codex 任务，但强制只读，不修改文件，也不运行测试或构建。任务成功后引导会自动完成。

之后发送 `状态` 打开轻量首页；只有排查连接、电源或远程就绪时才发送 `控制台`。首条自然语言任务也可以直接发送，不会被欢迎卡打断。

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

- 已有群：管理员把机器人拉进群，在群里发送任意一句或“项目”，然后在卡片中选择一次项目。
- 自动建群：在机器人私聊的“状态”或“项目”卡中点击“一键创建项目群”。机器人会自动建群、邀请已授权成员、绑定项目并置顶工作区卡。
- 如果邀请、工作台或置顶只有部分成功，卡片会明确显示待修复步骤；再次点击“打开项目群”只补失败步骤，不会重复建群。
- 项目一旦绑定就永久锁定在该群，卡片和文字命令都不能切换；另一个项目使用另一个群。
- 群里新发一条顶层消息：开始一件新事情，创建独立 Codex 会话。
- 在机器人回复串中继续说：延续同一件事情和同一个 Codex thread。
- 另一个项目：进入它自己的群。
- 同时处理多个项目：分别在对应项目群或不同回复串中发起，任务卡始终显示项目名。

私聊适合个人连续使用；团队协作优先使用项目群和回复串，避免上下文混在一起。

## 7. 最常用的飞书命令

| 发送内容 | 作用 |
|---|---|
| `新手引导` | 重新打开使用引导 |
| `状态` / `首页` | 打开当前项目、会话、权限和任务入口 |
| `控制台` / `设备` | 查看设备、Codex、队列与远程就绪详情 |
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

确认首条消息由 `FEISHU_ADMIN_OPEN_IDS` 中的管理员发送。未绑定群在完全访问模式下只会开放“首次选择项目”卡，不会执行 Codex 任务；选择完成后群 ID 与项目会安全写入 SQLite，不需要复制 `chat_id`、编辑 `ALLOWED_FEISHU_CHAT_IDS` 或重启服务。

如果卡片提示缺少权限，请在飞书开放平台补齐本页第 2 步的项目群权限并重新发布应用版本。

### 需要升级

先预览，不会修改服务：

```bash
npx feishu-codex-console@next upgrade --config ~/.config/feishu-codex-bridge/default.env
```

确认后执行：

```bash
npx feishu-codex-console@next upgrade --config ~/.config/feishu-codex-bridge/default.env --yes
```

安装、日常任务、项目群、团队协作、升级和卸载的总入口见 [全项目 SOP 总览](SOP_INDEX.md)。完整正常流程见 [全项目正向 SOP](USER_SOP.md)，失败与恢复见 [全项目逆向与故障恢复 SOP](FAILURE_RECOVERY_SOP.md)，发布验收见 [验收测试矩阵](ACCEPTANCE_TEST_MATRIX.md)。更多问题见 [安装指南](INSTALLATION.md)、[配置参考](CONFIGURATION.md)和[故障排查](TROUBLESHOOTING.md)。
