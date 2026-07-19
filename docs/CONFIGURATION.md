# Configuration reference

The recommended path is `feishu-codex-console init`. It writes a private `0600` env file and preserves unknown advanced keys when rerun. Start every managed file with `BRIDGE_CONFIG_VERSION=1`; a newer unknown contract fails closed instead of being guessed.

## Identity and team access

| Key | Default | Purpose |
|---|---|---|
| `ALLOWED_FEISHU_OPEN_IDS` | required | Comma-separated operators allowed to start Codex work |
| `FEISHU_ADMIN_OPEN_IDS` | operators | Administrators; configure explicitly for a team |
| `FEISHU_VIEWER_OPEN_IDS` | empty | Read-only dashboard and status members |
| `FEISHU_MEMBER_LABELS_JSON` | empty | Product-facing labels; missing labels become anonymous member codes |
| `ALLOWED_FEISHU_CHAT_IDS` | empty | Optional bootstrap allowlist for legacy groups; first project binding now persists trust automatically |
| `FEISHU_GROUP_SESSION_SCOPE` | `member` | `member` isolates each group member; `chat` deliberately shares context |
| `FEISHU_PROJECT_ACL_JSON` | empty | Project selector to member-ID arrays; admins bypass ACLs |
| `FEISHU_BOT_MENTION_NAMES` | empty | Names stripped from leading group mentions |

## Projects and Codex

| Key | Default | Purpose |
|---|---|---|
| `CODEX_WORKDIR` | required by installer | Default authorized project |
| `CODEX_PROJECT_ROOTS` | default project | Additional roots recursively scanned for Git repositories |
| `CODEX_PROJECT_SCAN_DEPTH` | `8` | Maximum discovery depth |
| `MAX_CODEX_PROJECTS` | `200` | Discovery result cap |
| `CODEX_SYNC_SAVED_PROJECTS` | `true` in generated config | Include projects saved by the local Codex app |
| `CODEX_PROJECT_STATE_FILE` | Codex home default | Optional saved-project state override |
| `CODEX_CLI_PATH` | bundled binary | Optional Codex executable override |
| `CODEX_MODEL` | native default | Deployment-level model default |
| `CODEX_REASONING_EFFORT` | native default | Deployment-level reasoning default |
| `CODEX_MULTI_AGENT_ENABLED` | `false` | Enable Codex subagent tools; keep off for predictable token use |
| `CODEX_TIMEOUT_MS` | `1200000` | Turn timeout |
| `CODEX_SKIP_GIT_REPO_CHECK` | `false` | Permit an authorized non-Git project |

## Permission ceiling

| Key | Default | Purpose |
|---|---|---|
| `CODEX_SANDBOX_MODE` | `workspace-write` | Service/admin maximum |
| `CODEX_OPERATOR_SANDBOX_MODE` | safe service maximum | Ordinary operator maximum |
| `CODEX_NETWORK_ACCESS` | `false` | Network access passed to Codex |
| `CODEX_WEB_SEARCH_MODE` | `disabled` | `disabled`, `cached`, or `live` |
| `CODEX_ALLOWED_ENV_VARS` | empty | Explicit project variables copied into Codex’s minimized environment |
| `EXTERNAL_CONFIRMATION_TTL_MINUTES` | `10` | Commit/push/deploy/publish/PR confirmation lifetime |

`danger-full-access` is only a ceiling. A member still needs a temporary lease in the settings card, and external actions still require confirmation. A repository policy can reduce these limits further.

`CODEX_MULTI_AGENT_ENABLED=false` is the cost-safe default. Ultra reasoning can proactively delegate work, and every subagent has its own model/tool loop. When enabled, the bridge still asks Codex to delegate only after an explicit user request.

## Capacity, files, and retention

| Key | Default | Purpose |
|---|---|---|
| `MAX_CONCURRENT_TASKS` | `2` | Global task concurrency |
| `MAX_QUEUED_PER_CONVERSATION` | `5` | Per-member conversation queue cap |
| `MAX_ATTACHMENT_BYTES` | `20971520` | Attachment download cap |
| `MAX_TEXT_ATTACHMENT_BYTES` | `131072` | Text decoded into a prompt |
| `ATTACHMENT_RETENTION_HOURS` | `72` | Local attachment retention |
| `MAX_REPLY_CHARS` | `12000` | Reliable text fallback cap |
| `MAX_SEEN_EVENTS` | `2000` | Event deduplication retention bound |
| `MAX_LOG_BYTES` | `10485760` | Per-log rotation threshold |
| `LOG_MESSAGE_CONTENT` | `false` | Content logging; keep disabled outside local debugging |

## Instance and local data

| Key | Default | Purpose |
|---|---|---|
| `BRIDGE_INSTANCE_ID` | `default` | Stable service and data instance name |
| `BRIDGE_DATA_DIR` | package `var` or installer user-data path | SQLite, health, logs, attachments, and backups |
| `BRIDGE_DATABASE_FILE` | `<data>/state.sqlite` | Advanced database override |
| `BRIDGE_STATE_FILE` | `<data>/state.json` | One-time legacy JSON migration source |
| `FEISHU_COMPLETION_NOTIFICATIONS` | `false` | Optional compact completion notice after the original task card updates; failures always get a fallback |
| `FEISHU_AUTO_ONBOARDING` | `true` | One-time member onboarding card |

Do not place App Secret in this file. `lark-cli` owns the Bot identity in its user configuration. Do not commit the managed env file, runtime data, support bundles, or real member/chat IDs.

## Repository-controlled files

- `.feishu-codex-policy.json`: schema v1 permission and external-action policy; can only tighten host limits.
- `.feishu-codex-runbooks.json`: schema v1 reviewed team prompts; cannot request full access or pre-authorize external mutations.

Create a safe runbook starter in any project with:

```bash
feishu-codex-bridge init-runbooks --project /absolute/path/to/project
```

The command never overwrites an existing catalog.
