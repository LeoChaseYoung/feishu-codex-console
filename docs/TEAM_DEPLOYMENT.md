# Team deployment

Start with one dedicated Mac or Linux account that owns the approved workspaces and Codex login. Use one Feishu application per bridge instance.

1. Add administrators, operators, viewers, and trusted chat IDs to `.env`.
2. Keep `FEISHU_GROUP_SESSION_SCOPE=member` unless the group intentionally shares one Codex context.
3. Set `CODEX_SANDBOX_MODE` to the administrator ceiling and `CODEX_OPERATOR_SANDBOX_MODE` to the lower everyday ceiling.
4. Define `FEISHU_PROJECT_ACL_JSON` before inviting members if projects contain data with different access rules.
5. Add `FEISHU_MEMBER_LABELS_JSON` so handoff and team dashboards use recognizable names instead of anonymous member codes.
6. Review repository runbooks before copying them to `.feishu-codex-runbooks.json`; templates cannot grant full access or pre-authorize external actions.
7. Move runtime data outside the checkout with `BRIDGE_DATA_DIR`, run `npm run doctor`, and install the service.
8. Test with one viewer, two operators, and one administrator before broad rollout, including handoff and access revocation.

Automatic onboarding is enabled by default. Each member sees one adaptive welcome card and can reopen it with `新手引导`. The card exposes only the next useful action for that member and keeps deployment identifiers out of the experience. Team usage is introduced as an optional convention: one project per group, new work as a new top-level message, and follow-ups in replies. Set `FEISHU_AUTO_ONBOARDING=false` only when your organization provides a separate onboarding flow.

Operators see only thread history the bridge has associated with their own Feishu identity. Administrators can inspect all Codex threads in an authorized project. A group task can be handed to another operator with project access, but the initiator and execution policy remain unchanged. Queued tasks are re-authorized after every restart; revoked controllers lose control and stale work cannot resume under removed permissions.

Example:

```dotenv
BRIDGE_INSTANCE_ID=engineering
BRIDGE_DATA_DIR=/Users/codex-bridge/Library/Application Support/feishu-codex-bridge
ALLOWED_FEISHU_OPEN_IDS=ou_frontend,ou_backend
FEISHU_ADMIN_OPEN_IDS=ou_platform_admin
FEISHU_VIEWER_OPEN_IDS=ou_product
FEISHU_MEMBER_LABELS_JSON={"ou_platform_admin":"Platform Admin","ou_frontend":"Frontend","ou_backend":"Backend","ou_product":"Product"}
ALLOWED_FEISHU_CHAT_IDS=oc_engineering
FEISHU_GROUP_SESSION_SCOPE=member
FEISHU_AUTO_ONBOARDING=true
CODEX_SANDBOX_MODE=danger-full-access
CODEX_OPERATOR_SANDBOX_MODE=workspace-write
FEISHU_PROJECT_ACL_JSON={"frontend":["ou_frontend","ou_product"],"backend":["ou_backend"]}
```

The bridge is an execution gateway, not a replacement for operating-system account separation. For mutually untrusted teams, run separate instances under separate system accounts and expose different project roots.
