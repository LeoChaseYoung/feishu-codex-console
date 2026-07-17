# Security model

Feishu Codex Bridge connects an authorized chat identity to a local Codex process. Treat the machine account, Feishu application and selected project directories as one security boundary.

## Safer defaults

- Prefer `workspace-write`; use `danger-full-access` only when the workflow genuinely needs it.
- `danger-full-access` is a capability ceiling, not a persistent member default. Full access requires a self-granted next-task, 30-minute, or current-thread lease and automatically falls back after consumption, expiry, revocation, project change, or thread change.
- Keep `CODEX_NETWORK_ACCESS=false` and `CODEX_WEB_SEARCH_MODE=disabled` unless a task requires them.
- Configure a short `ALLOWED_FEISHU_OPEN_IDS` list. In full-access mode, unlisted group chats are rejected; configure `ALLOWED_FEISHU_CHAT_IDS` before enabling a group.
- Configure `FEISHU_ADMIN_OPEN_IDS` explicitly for a team. When it is empty, every operator becomes an administrator for backward compatibility.
- Keep group isolation at `member`, cap ordinary operators with `CODEX_OPERATOR_SANDBOX_MODE`, and use `FEISHU_PROJECT_ACL_JSON` when projects have different audiences.
- Ordinary card actions are checked against the card owner. Group tasks additionally track an explicit current controller: only that controller may mutate the task, while the initiator may explicitly reclaim it and an administrator may explicitly take over. Handoff targets must be operators with current project access.
- Codex receives a minimized environment. Add variables to `CODEX_ALLOWED_ENV_VARS` only when a confirmed workflow cannot use local credential stores.
- Commit, push, deployment, publishing, release and PR mutations require a short-lived confirmation. Actual shell commands are checked again at runtime.
- Queued work is re-authorized after every service restart; tasks are not resumed when the owner, project ACL, or sandbox ceiling has been revoked.
- Credential changes, outbound comments/contact and external-data deletion are blocked by policy.
- Codex questions marked secret never expose answer controls in Feishu. Text or forged card answers are rejected, message-content logging is redacted, and only non-sensitive interaction metadata enters the audit log.
- Review cards never render known credential paths such as `.env`, private-key, certificate, SSH, or credentials files. Diff and test excerpts redact common secret assignments, bearer credentials, and private-key blocks before leaving the machine.
- Add `.feishu-codex-policy.json` to a repository when it needs a lower sandbox ceiling or stricter external-action rules. Repository policy can only tighten the host and role limits; deny rules are rechecked when confirming, enqueueing, and starting work.
- Treat `.feishu-codex-runbooks.json` as reviewed code. The bridge validates the entire catalog before use, rejects full-access and external-action templates, reapplies member/project policy when enqueueing, and rechecks substituted parameters. Invalid catalogs fail closed.
- Runtime logs, doctor output, durable text outbox, audit summaries, task cards, runtime approvals, external confirmations, test excerpts and diffs share the same credential-redaction implementation. Redaction is defense in depth and is not a substitute for keeping secrets out of prompts.

## Important limitation

The runtime command checker is defense in depth, not an operating-system sandbox. A full-access agent can use programs or invocation forms the checker does not recognize. For stronger isolation, run the bridge under a dedicated macOS account or container and expose only the required project directories.

## Local data

- `.env`, `var/state.sqlite*`, legacy `var/state.json`, logs and downloaded attachments are ignored by Git.
- State and downloaded files use owner-only permissions.
- SQLite uses WAL and `FULL` synchronous durability. Only never-started queued tasks can resume automatically; running or otherwise started tasks become interrupted to prevent duplicate side effects.
- Schema migrations create private, checksummed SQLite snapshots and roll back automatically on failure. Manual rollback refuses to run while the bridge PID is alive and first creates a safety backup of the current state.
- Package upgrades are read-only previews until `--yes`, refuse to replace a live-task service, back up before stopping, and verify the new or restored service. A missing old package directory can limit binary rollback even when data rollback succeeds, so retain the reported backup ID.
- The bounded audit log stores Feishu open IDs and action metadata. Protect backups as identity data.
- Team dashboards never render raw open IDs, prompts, results, diffs, attachments or file paths. Friendly labels are configuration-only presentation; SQLite and audit records still contain identity IDs and must remain private.
- Text attachment bodies are not copied into persistent state.
- Attachments and logs have configurable retention/size limits.
- Remote Ready only holds a macOS idle-sleep assertion while the bridge is alive; it does not bypass lid-close sleep, power loss or network loss.

Run `npm run doctor`, `npm test` and `npm audit` after configuration or dependency changes.

`support-bundle` writes a redacted local diagnostic file and never uploads it. Redaction is best effort: inspect project labels, timestamps and error context before sharing it privately.

## Supported versions

Security fixes are applied to the latest release or prerelease on the default branch. Older snapshots may not receive backports.

## Reporting a vulnerability

Use the repository's private GitHub security advisory flow. Do not open a public issue for authentication bypasses, command-policy escapes, credential exposure, cross-user card control, arbitrary project-path access, or other vulnerabilities.

Include the affected version, platform, configuration shape with all identifiers redacted, reproduction steps, impact, and any suggested mitigation. Maintainers should acknowledge a complete report within seven days and coordinate disclosure after a fix is available.
