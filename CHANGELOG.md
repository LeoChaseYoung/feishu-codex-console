# Changelog

All notable changes are recorded here. Versions follow Semantic Versioning while the public API stabilizes.

## 1.0.0-beta.7 - 2026-07-17

### Changed

- npm releases now use GitHub OIDC trusted publishing with job-scoped permissions and no long-lived repository token; prerelease tags create correctly marked GitHub prereleases.

## 1.0.0-beta.6 - 2026-07-17

### Fixed

- Task-review baselines now serialize index-backed Git reads, disable optional index locks, and bypass the untracked cache so freshly created pre-existing files are captured consistently on Linux.

## 1.0.0-beta.5 - 2026-07-17

### Fixed

- Task-review baselines now use streamed SHA-256 content fingerprints instead of filesystem timestamps, preventing unchanged pre-existing files from being attributed to a Codex task on Linux or after metadata-only timestamp changes.
- Added cross-platform regression coverage for dirty-worktree attribution before publishing.

## 1.0.0-beta.4 - 2026-07-17

### Added

- Native Codex account quota summaries in the device and model control centers, plus a dedicated detail card for independent limit buckets, remaining percentage, reset time, plan, and available reset count; `额度`, `/usage`, and `/quota` open the live view.
- Local task-intent routing for answers, read-only analysis, content/file writing, and code changes, with mode-specific cards, retry copy, validation states, and sandbox clamping.
- Zero-token local project overview for `读取项目` / `/overview`, with bounded Git, README, package, language, and directory inspection.
- Accurate per-task token accounting across every model call, split into new input, cached input, output, and model-call count.
- Cost-safe subagent defaults: multi-agent tools are disabled unless a deployment explicitly sets `CODEX_MULTI_AGENT_ENABLED=true`.
- Public `feishu-codex-console` package with `feishu-codex-console` and backward-compatible `feishu-codex-bridge` CLIs.
- Read-only Feishu message discovery that automatically captures the installer operator and conversation IDs.
- Resumable non-sensitive installation state; existing config, service, runtime-data, and health detection; atomic configuration updates; private backups; and preservation of unknown advanced settings.
- Feishu Bot/message/card-event capability probes with concrete remediation, plus an end-to-end installation success card.
- Private service health heartbeats that verify the live PID, both Feishu event consumers, instance identity, and the exact loaded configuration before installation can complete.
- A non-destructive `migrate --from <source>` flow for old repository-local `.env` installs that preserves advanced settings and reuses legacy runtime data.
- Personal-safe, team-safe, and power-user setup presets with explicit full-access confirmation.
- Private per-user configuration and data directories that work with macOS LaunchAgent and Linux systemd.
- Installation guide and open-source product roadmap.
- Clean tarball installation smoke test plus protected npm provenance and GitHub Release workflow.
- Package-level recovery coverage that interrupts initialization before configuration write and verifies a second run resumes from the saved safe checkpoint.
- Ubuntu/macOS CI and release preflight matrices, plus maintainer release and operator troubleshooting guides.
- Truthful device availability states with status sampling time, per-member last-success time, hidden controls when callbacks are unavailable, and an explicit Codex reconnect action.
- Persisted device-console card references that refresh in place after restart, plus rate-limited recovery notices after a meaningful unexpected outage.
- Per-member project favorites and recent usage, consistent ranked numeric selection, searchable path-aware project choices, and current Git branch/dirty/ahead/behind status.
- Impact-aware project switching with native card confirmation and explicit text confirmation whenever tasks, queues, or saved Codex context would be interrupted.
- Automatic names for newly created native Codex threads based on the first task.
- Live queue-position updates, task-card model/reasoning/thread context, and visible steering counts for follow-up messages.
- A per-task stop control in the task center, accurate member/admin task scopes, and read-only cards without false mutation controls.
- Actionable timeout, policy, permission, connection, and queue failure guidance, plus explicit file-impact copy for stopped work.
- Safe restart semantics that recover untouched queued work but mark previously running work interrupted instead of replaying potentially destructive commands.
- Capability-aware model controls with a semantic native-default option, per-model reasoning choices, task-time fallback for removed capabilities, and a read-only compatibility mode when the Codex catalog is unavailable.
- One-shot audited runtime approvals and questions with explicit scope/expiry copy, stale-card recovery guidance, cancellation, and ownership enforcement.
- End-to-end secret-question protection that removes remote answer controls, blocks text/card forwarding, and redacts message-content logging.
- Run-start Git baselines with dirty-worktree attribution, file fingerprints, additions/deletions, post-task staleness detection, and safe fallback for legacy or non-Git work.
- A read-only CardKit review center with paginated files and per-file diffs, task-card/task-center entry points, and explicit mixed-worktree guidance.
- Structured test evidence from actual commands and exit codes; the latest rerun wins, missing tests stay visible, and a completed turn with failing tests is no longer styled as success.
- Sensitive review-path blocking plus token, password, bearer credential, and private-key redaction for Diff and test excerpts.
- Time-bounded full-access leases for the next task, 30 minutes, or the current Codex thread, bound to the member, conversation, project, and session with automatic safe fallback.
- Repository-local `.feishu-codex-policy.json` controls that can lower the sandbox ceiling, allowlist external actions, or deny them, with validation at confirmation, enqueue, and execution time.
- Shared credential redaction across runtime logs, doctor output, durable text replies, audit summaries, task/approval/confirmation cards, test excerpts, and review diffs.
- A unified Card 2.0 response shell for controls, approvals, runtime questions, long-running work, and exceptional recovery states, with reliable text fallback.
- Feishu API timeout, `Retry-After`, transient-error retry, backoff, and outbound API health reporting.
- `doctor --fix` for safe local runtime repairs and private redacted JSON diagnostic bundles.
- Verified SQLite runtime backups, backup listing, service stop/restart, and guarded rollback commands.
- Automatic pre-migration SQLite snapshots, explicit schema versions, integrity checks, and rollback when schema or state conversion fails.
- Conservative startup reconciliation across persisted task status, CardKit phase, start time, and Codex thread evidence.
- Terminal-result fallback when a task card cannot be updated, even when proactive completion notifications are disabled.
- Explicit task initiator/current-controller state with friendly member labels, group handoff, initiator reclaim, administrator takeover, ACL revalidation, restart recovery, and audited control changes.
- A privacy-preserving team dashboard for member status, project load, task outcomes and token usage without prompts, results, paths or raw open IDs.
- Repository-local `.feishu-codex-runbooks.json` templates with parameters, defaults, model/reasoning hints, permission lowering, safe one-click execution, and failure-closed external-action validation.
- Explicit config/version compatibility metadata, a safe package upgrade preview/execution path, verified service rollback, and a private support-bundle command.
- An installed-package `init-runbooks` command that creates a reviewed starter without overwriting team-owned catalogs.
- English onboarding, configuration/compatibility/demo references, a public Roadmap, scoped Good First Issue guidance, and release-contract verification.

### Changed

- First-run onboarding is now one adaptive welcome card instead of a four-step wizard. It exposes one primary action for offline, missing-project, viewer, or ready states; realistic prompt examples and a short optional team convention replace configuration-heavy setup screens.
- Conversational replies now promote concise lead conclusions into native Feishu rich-text titles, keep loading states visually quiet, and avoid leaking leading Markdown syntax into the chat-list preview.
- Questions and read-only analysis now use one editable Feishu Markdown reply instead of a full success task card; the final answer hides task, model, permission, thread, and token metadata.
- Top-level group prompts now start isolated reply-thread sessions. Later replies use Feishu `root_id`/`thread_id` context to resume the same Codex thread, while new topics inherit project and preferences without inheriting old Codex context or temporary permission leases.
- Routine acknowledgements now use native Markdown. Card 2.0 is reserved for controls, approvals, questions, file/code execution, and exceptional states.
- Questions and analysis no longer create Git baselines, consume temporary full-access leases, show missing-test warnings, or expose empty review actions; content and code tasks retain file-aware verification.
- Completed tasks now keep one canonical card: a compact result summary opens the full answer or validation in place, irrelevant review actions stay hidden, and successful card updates no longer produce duplicate result messages by default.
- Local absolute-path Markdown links are rendered as safe file labels in Feishu while external links remain clickable.
- Reasoning-effort labels now match the Codex interface and hide internal enum values from visible controls.
- Package metadata now includes a publishable binary, runtime file allowlist, and prepack build.
- A conversation can explicitly return to the native Codex default even when the deployment pins a global model.
- `CODEX_SANDBOX_MODE=danger-full-access` is now a service/role ceiling; persistent conversation settings are clamped to workspace write and require an explicit temporary lease for each elevated scope.
- Task control is now distinct from task ownership; existing task records automatically assign control to their original initiator.
- Ordinary acknowledgements and validation feedback now stay on the lightweight native message surface; consequential controls and exceptional recovery states use the semantic Card 2.0 shell.

### Fixed

- Native conversational replies now edit rich-text messages through the Feishu `PUT` message API instead of the card-only `PATCH` API. Progressive updates respect Feishu's 20-edit limit and reserve capacity for the terminal answer.
- Team task cards now use CardKit-compliant element IDs in every collaboration state; contract coverage includes the dynamic team panel.
- If a full task card is unavailable, its lightweight fallback card now updates in place from queued to running to terminal state instead of posting separate accepted and completed messages.

## 1.0.0-beta.2 - 2026-07-16

### Added

- Native three-step Feishu Card 2.0 onboarding for connection, workspace/model setup, and the first task.
- Automatic first-run onboarding with per-member SQLite progress, completion, dismissal, and manual restart.
- Direct onboarding shortcuts to the device console, project workspace, model settings, sessions, and task center.
- A viewer-specific read-only onboarding path and `FEISHU_AUTO_ONBOARDING` deployment control.

### Fixed

- macOS service reinstalls no longer force-start a second bridge process while the new LaunchAgent is registering its Feishu event consumers.

## 1.0.0-beta.1 - 2026-07-16

### Added

- Codex-native model catalog, model selection, reasoning-effort selection, and per-conversation sandbox profiles.
- Historical session browser, thread resume, context compaction, and task center.
- Team roles: administrator, operator, and viewer.
- Per-member group isolation, task/card/thread ownership, project ACLs, and a bounded SQLite audit log.
- Automatic steering for follow-up messages and explicit `/queue` for independent work.
- Proactive completion notifications backed by the durable text outbox.
- Configurable instance/data paths plus macOS LaunchAgent and Linux systemd user services.
- Bundled `@larksuite/cli`, MIT license, contribution guide, conduct policy, architecture docs, and GitHub templates.

### Changed

- Persisted state schema upgraded from version 5 to 6 with automatic migration.
- Non-admin operators default to `workspace-write` when the service maximum is `danger-full-access`.
- Group chats default to one Codex context per member.

## 0.8.0 - 2026-07-15

- Persistent Codex app-server, native approvals and questions, SQLite recovery, CardKit 2.0 task/device cards, and macOS Remote Ready.
