# Feishu Codex Console

Use Feishu to safely continue working with Codex on your own computer—without exposing SSH, an HTTP server, or a webhook port.

The bridge is local-first and outbound-only. It maps a local Codex thread to a durable Feishu workspace session: direct messages continue one context, while a top-level group prompt starts a dedicated reply thread that keeps its own project and Codex context. SQLite preserves executions, queues, approvals, review state, and team ownership behind that conversation.

## Quick start

Requirements: macOS or Linux, Node.js 22+, a local `codex login`, and a Feishu custom app with Bot, long-connection message events, and CardKit enabled.

```bash
npx feishu-codex-console@next init
```

The guided installer validates the environment and Feishu capabilities, discovers your member/chat identity from one test message, writes a private configuration, installs a LaunchAgent or systemd user service, waits for both event consumers, and sends the first product card.

In Feishu, send:

```text
新手引导
```

The onboarding card starts one real, forced-read-only project overview. It completes automatically only after that task succeeds. An ordinary first request is never interrupted by a separate welcome card; onboarding state is recorded silently in the background.

## Core commands

| Feishu message | Purpose |
|---|---|
| `状态` / `首页` / `/home` | Lightweight home for the current device, project, session, permission, and next action |
| `控制台` / `设备` / `/device` | Detailed device, Codex, queue, power, remote-readiness, and connection diagnostics |
| `额度` / `/usage` / `/quota` | Full native account quota windows, reset times, plan, and available resets |
| `项目` / `/projects` | Search, select, favorite, and inspect authorized projects |
| `读取项目` / `/overview` | Build a local Git/package/file snapshot without starting Codex or spending AI tokens |
| `设置` / `/settings` | Model, reasoning effort, sandbox, and temporary full-access leases |
| `会话` / `/sessions` | Resume, compact, or start a native Codex thread |
| `任务` / `/tasks` | Active, queued, interrupted, and recent tasks |
| `团队` / `/team` | Privacy-preserving team workload and outcomes |
| `运行手册` / `/runbooks` | Reviewed repository task templates |
| `追加 <request>` | Steer the current Codex turn |
| `排队 <task>` | Create a separate queued task |
| `停止` | Stop current work without pretending written files were reverted |

Questions and read-only analysis use one editable Feishu Markdown reply that evolves from a compact working state into the final answer. Cards are reserved for controls, approvals, questions, long-running file/code work, and failures; reliable text remains the final delivery fallback.

Ordinary messages are routed locally as answers, read-only analysis, file/content writing, or code work. Questions and analysis cannot consume a write/full-access lease or create fake test/review states; only explicit code work expects test evidence. `读取项目` stays a deterministic local snapshot with zero AI tokens.

## Team and safety model

- An administrator can add the bot to an existing group and choose its project once inside Feishu. The binding is then permanent: neither cards nor text commands can switch that group to another project. Before binding, no Codex task is accepted.
- A direct-message project card can create the project group, invite authorized members, persist the binding, and pin its workspace card without copying a `chat_id` or editing configuration.
- Member sync, workspace delivery, and pinning are persisted as separate recoverable steps. A retry resumes only incomplete work and never creates a second group after the binding exists.
- Group-level controls are isolated per member by default. Inside a Feishu reply thread, all messages resolve to the same workspace session and Codex thread; execution control still requires explicit ownership or handoff.
- Administrators, operators, and viewers have separate capabilities; project ACLs hide unauthorized workspaces.
- Tasks keep an immutable initiator and explicit current controller for audited handoff, reclaim, and admin takeover.
- `danger-full-access` is a ceiling, not a permanent default. Members use temporary leases, while commit, push, release, deployment, and PR mutations still require confirmation.
- Repository policy and runbooks can only lower permissions. Secret questions cannot be answered through Feishu.
- Runtime logs, diagnostics, cards, reviews, and text fallbacks share credential redaction. Code and prompts are not uploaded as telemetry.

## Operations

```bash
feishu-codex-bridge doctor --fix
feishu-codex-bridge support-bundle
feishu-codex-bridge backup
feishu-codex-bridge version
npx feishu-codex-console@next upgrade --config /absolute/path/default.env
```

An upgrade is a read-only preview until `--yes` is added. It blocks live-task replacement, creates a verified database backup, checks the new package, validates service health, and attempts automatic data/service rollback on failure.

## Documentation

- [Full product SOP index](docs/SOP_INDEX.md)
- [Positive user SOP](docs/USER_SOP.md)
- [Negative and recovery SOP](docs/FAILURE_RECOVERY_SOP.md)
- [Acceptance test matrix](docs/ACCEPTANCE_TEST_MATRIX.md)
- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [Compatibility and upgrades](docs/COMPATIBILITY.md)
- [Product demo](docs/DEMO.md)
- [Security](SECURITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [V4 workspace-session interaction model](docs/V4_WORKSPACE_SESSION_FLOW.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

The detailed product documentation is currently Chinese-first; this English entry covers the complete installation, safety, and operations path.

MIT licensed. Security issues should be reported privately through GitHub Security Advisories, not a public issue.
