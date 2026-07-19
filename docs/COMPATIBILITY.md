# Compatibility and version policy

This page is the release contract for operators and package maintainers. The npm package pins its two runtime integrations so a published bridge does not silently change behavior underneath an installation.

## Current release line

| Component | Supported contract |
|---|---|
| Node.js | `>=22` on current macOS or Linux |
| Codex runtime | @openai/codex `0.144.4` |
| Feishu runtime | @larksuite/cli `1.0.70` |
| Configuration | `BRIDGE_CONFIG_VERSION=1` |
| Persisted bridge state | persisted state v6, migrated on load |
| SQLite | SQLite schema v3, backed up before migration; immutable project-chat binding plus recoverable member/workspace/pin steps |
| Background service | macOS LaunchAgent or Linux systemd user service |

Run `feishu-codex-bridge version` or `feishu-codex-bridge version --json` to print the exact contract installed on a machine.

## Semantic Versioning

- Patch releases fix defects without intentionally changing configuration or persisted-state meaning.
- Minor releases may add optional settings, cards, commands, and additive stored fields. Existing configuration remains valid.
- Major releases may remove or redefine a public CLI/configuration contract and must include an explicit migration guide.
- Prereleases can evolve faster, but never bypass data backup, role checks, or external-action confirmation.

The stable `1.x` promise covers documented CLI commands, configuration keys, runbook schema v1, policy schema v1, and automatic persisted-state migration. Internal TypeScript modules and CardKit payload shapes are not a public plugin API.

## Upgrade and rollback

Preview an upgrade first:

```bash
npx feishu-codex-console@next upgrade --config /absolute/path/default.env
```

The preview is read-only. When no task is actively running, repeat with `--yes`. The command creates a verified SQLite backup, runs the new package’s doctor, stops the old service, installs the new service, and waits for both Feishu consumers to become healthy. Failure triggers a data rollback and, when the previous package location is still available, reinstalls and verifies the previous service.

```bash
npx feishu-codex-console@next upgrade \
  --config /absolute/path/default.env \
  --yes
```

Downgrades require `--allow-downgrade`; compatibility is not guaranteed across a major version. Keep the reported backup ID until the new version has handled a real task successfully.

## Dependency updates

Changing either pinned runtime dependency requires:

1. capability-aware unit tests and a clean tarball installation test;
2. macOS and Linux CI;
3. a real Feishu message, card callback, Codex task, question, approval, and review pass;
4. a changelog entry describing any visible model, reasoning, event, or card behavior change.

Experimental Codex capabilities must be feature-detected and cannot be required for the core task loop.
