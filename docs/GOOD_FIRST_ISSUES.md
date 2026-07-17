# Good first issues

Starter issues should teach one product boundary without requiring a contributor to run a real Feishu tenant or expose local credentials. Maintainers can copy one of the following into a GitHub issue and add the `good first issue` label.

## Ready-to-scope candidates

| Candidate | Primary files | Done when |
|---|---|---|
| Add another redaction fixture | `src/redaction.ts`, `test/redaction.test.ts` | A realistic secret shape is hidden without corrupting ordinary text |
| Improve one doctor remediation | `src/doctor.ts`, `test/diagnostics.test.ts` | A failed check prints one safe, executable next step |
| Add one Card 2.0 contract fixture | one card module, `test/card-contract.test.ts` | Element IDs and supported component shape pass the contract suite |
| Clarify one Linux troubleshooting path | `docs/TROUBLESHOOTING.md` | A clean systemd user install can follow the steps without source knowledge |
| Add a safe sample runbook | `.feishu-codex-runbooks.example.json`, runbook tests | The template parses, cannot elevate permissions, and contains no external action |

## Maintainer checklist

- Explain the user-visible problem, not just the desired code change.
- Keep the expected change within one subsystem and avoid authentication or approval redesigns.
- List exact acceptance checks and a likely test file.
- State which credentials or live services are not required.
- Reserve cross-user authorization, migration, arbitrary command policy, and production release changes for experienced contributors.

Use the repository’s “Good first issue proposal” form for new candidates. The label means the issue is scoped and maintainer-approved; it does not mean unreviewed code can bypass security or migration checks.
