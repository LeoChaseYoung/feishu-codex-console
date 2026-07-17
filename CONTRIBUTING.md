# Contributing

Thanks for helping make Feishu Codex Bridge safer and easier to self-host.

## Before opening a change

- Search existing issues and pull requests.
- For security vulnerabilities, follow `SECURITY.md` instead of opening a public issue.
- Keep the bridge self-hosted and outbound-only by default. Features that require a public inbound endpoint need an explicit threat model.
- Do not commit Feishu credentials, Codex login data, `.env`, SQLite files, logs, attachments, real open IDs, or absolute personal paths.

## Local development

```bash
npm ci
cp .env.example .env
npm run check
npm test
npm run build
npm run test:package
```

`npm run doctor` and `npm run smoke:codex` use local credentials, so they are optional for contributors who only change pure code or cards.

## Code map

| Area | Main files | Required evidence |
|---|---|---|
| Feishu routing and task lifecycle | `src/index.ts`, `src/task-queue.ts` | ownership, deduplication, queue, and restart tests |
| Card 2.0 presentation | `src/*-card.ts`, `src/response-card.ts` | focused card test plus `test/card-contract.test.ts` |
| Identity and permissions | `src/team-policy.ts`, `src/project-policy.ts`, `src/policy.ts` | allow and deny cases; no real member IDs |
| Persistence and recovery | `src/state-store.ts`, `src/state-backup.ts` | old-state migration, interruption, integrity, and rollback tests |
| Codex integration | `src/app-server-client.ts`, `src/model-capabilities.ts` | normalized fixtures; do not require experimental methods for core flows |
| Installer and service | `scripts/cli.mjs`, `scripts/*d.mjs` | pure helper tests and `npm run test:package` |

Start with [good first issues](docs/GOOD_FIRST_ISSUES.md) if you do not have a live Feishu test tenant. Product decisions and subsystem acceptance criteria live in [the requirements map](docs/PRODUCT_REQUIREMENTS_MAP.md).

## Pull requests

- Keep each pull request focused and explain the user-visible behavior.
- Add or update tests for policy, persistence, app-server normalization, or CardKit contracts.
- Preserve backward migration from earlier persisted state versions.
- New CardKit `element_id` values must start with a letter, contain only letters/numbers/underscores, remain at most 20 characters, and be unique within a card.
- Document new environment variables in `.env.example` and `README.md`.
- Keep documented CLI/config/runbook/policy behavior backward compatible within `1.x`; otherwise propose a migration and version change first.
- Run `npm run check && npm test && npm run build && npm run test:package && npm audit` before requesting review.

Changes to cross-user authorization, external commands, full access, migrations, backup/rollback, redaction, or release workflows are security-sensitive. Describe the threat and failure behavior in the pull request and include both a denied path and a recovery path.

Maintainers additionally run `npm run release:check -- v<version>` and the real macOS/Linux/Feishu checklist. Contributors should not publish packages or create release tags from a pull request.

By contributing, you agree that your contribution is licensed under the MIT License in this repository.
