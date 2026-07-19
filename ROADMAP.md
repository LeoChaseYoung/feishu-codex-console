# Roadmap

Feishu Codex Console stays focused: a local-first, outbound-only control plane for continuing real Codex work from Feishu.

## Now — 1.0 foundation

- Ten-minute guided installation and truthful device readiness.
- Project/thread continuity, live tasks, steering, queueing, stop, native questions and approvals.
- Reviewable diffs/tests, temporary full-access leases, repository policy, recovery and backups.
- Team isolation, explicit task handoff, private aggregate dashboard, and reviewed runbooks.
- Safe package upgrade, compatibility contract, support bundle, bilingual entry docs, and contributor path.

Exit criteria: a new operator installs from npm, completes the demo, upgrades and rolls back without source knowledge, and the release passes macOS/Linux plus real Feishu verification.

## Next — 1.1 operations

- Feishu ↔ Codex desktop handoff: open the same native thread, explicitly bind an existing local thread, and show the latest activity source without mirroring Feishu-only controls into Codex history.
- More actionable doctor checks and a guided support-bundle review.
- Task search/filtering and clearer long-running task checkpoints.
- Runbook authoring validation command and richer parameter controls.
- Measured installation and first-task reliability stored locally; no telemetry by default.
- Accessibility and compact/mobile Card 2.0 QA across all core cards.

## Later — 1.2 multi-device design

- One Feishu-facing hub with outbound-connected device agents.
- Stable device identity, project advertisements, revocation, health, and explicit routing.
- End-to-end task ownership and encrypted transport without public laptop ports.
- A migration path from today’s one-instance/one-device deployments.

Multi-device work starts only after a published threat model and an offline/reconnect protocol are reviewed.

## Later — P2 multi-agent orchestration

Multi-agent execution is intentionally outside the current product mainline. Keep the underlying Codex feature flag available but disabled by default while the single-agent remote workspace is stabilized.

Work starts only after project-group end-to-end reliability, task-intent inheritance, Feishu ↔ Codex desktop handoff, approval routing, and trustworthy usage accounting are complete. The eventual product experience should let users choose automatic, single-agent, or collaborative execution while still managing one task, one approval surface, and one consolidated result.

Before multi-agent execution can be enabled by default, child-agent threads must inherit the root task's project, sandbox, ACL, external-action policy, stop/recovery lifecycle, and token budget. Initial limits should keep one writing agent per workspace, other agents read-only, recursion depth at one, and child-agent concurrency bounded.

## Deliberately not planned for 1.x core

- A generic AI chat or multi-model portal.
- A cloud IDE, code host, or default hosted code relay.
- A large plugin marketplace or unstable public internal-module API.
- Many IM and agent adapters in the main package before the Feishu contract is stable.
- Anonymous telemetry enabled by default.

See [the product requirements map](docs/PRODUCT_REQUIREMENTS_MAP.md) for decisions and [good first issues](docs/GOOD_FIRST_ISSUES.md) for contribution-sized work.
