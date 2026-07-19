# npm 发布与认证运行手册

这份运行手册约束维护者和自动化 Agent 如何发布 npm 包、判断发布是否成功，以及认证失败时何时必须停止。它的目标不是让发布“想办法继续”，而是防止把 GitHub OIDC、npm 网页登录、CLI 登录和 dist-tag 混成同一件事。

## 1. 唯一发布通道

正式发布只走公开仓库的 `.github/workflows/release.yml`：

```text
受保护的 main
  → PR 与 Ubuntu/macOS CI 通过
  → package.json、Changelog 和 tag 一致
  → 推送 v<version> tag
  → GitHub Actions 通过 OIDC 执行 npm publish
  → 创建 GitHub Release
  → 从公开 npm Registry 验证版本、dist-tag 和干净安装
```

仓库和 GitHub Environment 不保存长期 `NPM_TOKEN`。本机 `npm login`、`npm whoami` 和 npm 网页登录都不是正常发布步骤。

## 2. 版本通道是产品契约

`scripts/release-dist-tag.mjs` 是通道选择的机器可执行来源：

| `package.json` 版本 | 发布 tag | 用户安装入口 |
|---|---|---|
| 含预发布段，例如 `1.0.0-beta.10` | `next` | `npx feishu-codex-console@next init` |
| 稳定版，例如 `1.0.0` | `latest` | `npx feishu-codex-console init` |

因此，公开 Beta 的 `next` 比 `latest` 新是正常状态，不是发布故障。不得为了让两个 tag 看起来一致而手工提升预发布版本，也不得只为移动 tag 发布一个空版本。

## 3. OIDC 与账号登录的边界

- GitHub Trusted Publisher 的短期 OIDC 身份只在受信任 workflow 内用于 `npm publish`；它不会把维护者的电脑登录到 npm。
- `npm whoami` 返回 `E401` 不能证明 OIDC 发布失败。发布结果以 GitHub Actions、公开 Registry 和 provenance 为准。
- npm 网页已经登录，不代表 `npm login --auth-type=web` 的 CLI 授权已完成。
- 发布后的 `npm dist-tag add` 属于账号写操作，需要单独的交互式 npm 认证；Trusted Publisher 不能替代它。
- 验证码、恢复码、安全密钥响应和 Token 永远不得发到聊天、Issue、日志或诊断包。

边界依据见 [npm Trusted publishing](https://docs.npmjs.com/trusted-publishers/) 和 [npm dist-tag](https://docs.npmjs.com/cli/dist-tag/) 官方文档。

## 4. 正向发布 SOP

### 4.1 发布前

1. 从最新公开 `main` 建发布分支。
2. 更新 `package.json`、`package-lock.json`、`CHANGELOG.md`、兼容矩阵和必要的用户文档。
3. 运行：

```bash
npm ci
npm run check
npm test
npm run build
npm run test:package
npm run release:check -- v$(node -p "require('./package.json').version")
```

4. 通过 PR 合并；不得绕过 `main` 的 Ubuntu/macOS 必需检查。
5. 从合并后的 `main` 创建与版本完全一致的 `v<version>` tag。

### 4.2 发布后

只做只读验证，不执行本机登录：

```bash
gh run list --repo LeoChaseYoung/feishu-codex-console --workflow Release --limit 3
npm view feishu-codex-console dist-tags --json
npm view feishu-codex-console versions --json
```

预发布完成定义：目标版本存在、`next` 指向目标版本、GitHub Release 标记为 prerelease、Registry 干净安装通过。`latest` 可以继续指向旧稳定版或旧默认版。

稳定版完成定义：目标版本存在、`latest` 指向目标版本、GitHub Release 为稳定版、Registry 干净安装通过。

## 5. 认证失败的停止规则

出现下列任一情况，立即停止当前认证尝试：

- CLI 登录跳到邮箱 OTP，但邮件未到达；
- 页面显示 `Invalid OTP`；
- 已配置安全密钥，但 CLI 授权仍只提供邮箱 OTP；
- 同一个登录 URL 或同一种验证码路径已经失败一次；
- 浏览器控制对同一 npm 页面连续两次无响应；
- 操作继续需要用户提供验证码、恢复码、Token 或账户秘密。

停止动作：

1. 在等待中的 `npm login` 进程发送 `Ctrl-C`。
2. 不再刷新、重开或换浏览器重复同一路径。
3. 不读取邮箱、不索要或转述任何验证码/恢复码。
4. 用公开 Registry 重新判断真实状态。
5. 如果预发布版本已经存在且 `next` 正确，记录“发布成功，无需处理 `latest`”并结束。
6. 只有稳定版的 `latest` 错误才阻断稳定发布；此时记录为需要 npm 账号所有者恢复交互认证的外部阻塞，不得绕过认证。

## 6. 常见误判决策表

| 现象 | 正确判断 | 必须避免 |
|---|---|---|
| GitHub OIDC 发布成功，但本机 `npm whoami` 为 401 | 正常；两种身份互不相同 | 反复执行 `npm login` |
| Beta 的 `next` 是新版本，`latest` 较旧 | 正常；Beta 正式入口是 `@next` | 把 `latest` 当作发布阻断 |
| npm 网页已登录，CLI 仍要求 OTP | 网页会话不等于 CLI 授权 | 声称“已经登录所以应当能改 tag” |
| OTP 邮件不到或页面提示无效 | 外部认证链路不可用 | 让用户重复查邮箱或提交验证码 |
| Trusted Publisher 可正常发布 | 只证明 workflow 能执行 `npm publish` | 假设它也能执行 `dist-tag`、`access` 或 `whoami` |
| 只想修正文档或移动 tag | 走正常 PR；tag 按版本契约处理 | 发布空版本来规避认证 |

## 7. 2026-07-19 经验记录

`1.0.0-beta.10` 已通过公开 GitHub Actions 和 OIDC 成功发布，`next` 正确指向该版本。后续把较旧的 `latest` 误判为发布故障，并重复进入不可用的邮箱 OTP 登录路径。根因是忽略了“预发布只进入 `next`”的既有产品契约。

最终处置：终止本机登录，保留 `@next` 作为公开 Beta 的正式安装入口，不要求用户继续处理 npm 认证。以后遇到相同状态直接按本手册第 5、6 节结束，不再重复尝试。
