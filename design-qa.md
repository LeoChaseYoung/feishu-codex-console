# Design QA — Feishu Codex Bridge V5

## Design sources

The V5 control surface keeps the existing Feishu Card 2.0 visual language and adopts interaction patterns from:

- [Codex Console](https://github.com/InDreamer/telegram-codex-bridge): project-aware sessions, runtime controls, interruption and app-server execution.
- [agents-to-im](https://github.com/francize/agents-to-im): Feishu session bindings, persisted state and CardKit fallbacks.
- [ccgram](https://github.com/jsayubi/ccgram): explicit permission decisions, structured questions and compact status summaries.
- [claude-code-slack-channel](https://github.com/jeremylongshore/claude-code-slack-channel): guarded external actions and scoped approvals.

The projects were used as product references, not as visual templates. V5 uses native Feishu components throughout, including dedicated control, session, and task centers.

## Visual system

| Token | Decision |
|---|---|
| Card width | Feishu default width for desktop and mobile compatibility. |
| Body spacing | 12 px outer padding and 8–12 px vertical rhythm. |
| Primary color | Feishu blue for active, navigational and in-progress states. |
| Status color | Green success, orange confirmation, red failure, grey inactive/terminal. |
| Information density | One dominant panel, one three-metric row, no more than four short buttons per row. |
| Dynamic content | Plain-text headers and escaped Markdown fields prevent accidental mentions or injected card markup. |
| Destructive actions | Native confirmation dialog before new-session, stop, external action and long-lived permission decisions. |

## Component review

| Surface | Result | Notes |
|---|---|---|
| First-run onboarding | Passed | Three progressive steps expose only the decision needed now, preserve the original first request, and branch to read-only destinations for viewers. |
| Device console | Passed | Remote Ready is the dominant state; engine, task and listener health are scannable in one row. |
| Project workspace | Passed | Current project is visually distinct; the selector and project counts remain separate from task execution. |
| Control center | Passed | Model, reasoning and sandbox selectors are grouped as three clear settings; viewers receive a non-interactive read-only variant. |
| Session center | Passed | Recent owned threads, current selection, compaction and navigation fit one mobile-safe card. |
| Task center | Passed | Running, queued and recent work is summarized without exposing another operator's tasks. |
| Team dashboard | Passed structurally | Native KPI row, member status and project load panels expose only aggregate metadata; no prompts, results or raw member IDs. |
| Team handoff | Passed structurally | Task cards show initiator/current controller, use friendly member labels, require native confirmation and keep takeover explicit. |
| Runbook center | Passed structurally | Reviewed templates use compact preview panels, safe one-click defaults, explicit command usage for required parameters and failure-closed invalid states. |
| Running task | Passed | Blue progress surface, task ID, compact metadata and one chronological execution stream. |
| Completed task | Passed structurally | The conclusion comes first; long answers and validation replace the original card in place, expose a return path, and hide validation when no evidence exists. |
| Runtime approval | Passed | Allow once, allow for session and deny are explicit, bounded to one row and expire safely. |
| Runtime question | Passed | Up to three answers become buttons; larger sets become a selector; free text continues through the next message. |
| External action gate | Passed | High-impact action, project and original instruction stay visible before confirmation. |
| Ordinary response | Passed structurally | Information, success, warning, failure and neutral-stop states use one Card 2.0 shell with a status header, tinted content panel and consistent next-step hint; text is only the reliability fallback. |
| Dark mode | Passed structurally | Only native Card 2.0 colors, text tags, icons and background styles are used. |

## Accessibility and edge cases

- Status is communicated with text as well as color.
- Button labels remain short and actionable.
- Long device, project, command and answer text is truncated or escaped.
- Secret questions warn that Feishu retains message history.
- Remote Ready explains battery cost and the lid-close limitation before activation.
- Stale device cards recreate a fresh control card instead of silently failing.
- CardKit failure falls back to a redacted, durable text status or result; terminal task updates explicitly report failure to the caller so the fallback cannot be skipped.
- Completed and dismissed onboarding states remain manually recoverable without appearing again automatically.
- Local absolute-path links are downgraded to file labels, preventing broken remote navigation and directory disclosure.

## Automated verification

- Card payloads use schema 2.0 and unique `element_id` values.
- Every control row contains at most four columns.
- Onboarding, device, project, task, team, runbook, confirmation, runtime approval, runtime question and ordinary response states have structural tests.
- Dynamic markup neutralization has regression coverage.
- Ordinary response tests cover four semantic tones, unique CardKit IDs, credential redaction and mention neutralization.
- Result-flow tests cover summary truncation, same-card detail/restore sequencing, conditional validation, embedded review return, duplicate-notification defaults and local-link sanitization.
- Team task fixtures now exercise the collaboration panel under the live CardKit 20-character `element_id` contract; fallback-session tests prove queued and terminal states reuse one message.

## Result-flow alignment update

- Source visual truth: the three Feishu desktop dark-mode screenshots supplied on 2026-07-16 showing a completed task, an empty review card and a duplicated full reply.
- Primary correction: one task now owns one canonical card across running, result summary, full result and validation states.
- Hierarchy correction: the result appears before environment metadata; the long success body uses a neutral panel instead of a full green slab.
- Action correction: pure analysis tasks do not expose an empty review destination; evidence-bearing tasks use “查看验证”.
- Reliability correction: a successful terminal card update suppresses the second full reply, while update failure still uses the durable fallback.
- Accessibility: status still combines text and color, and shorter cards reduce mobile reading cost. Keyboard focus, screen-reader order and real-client touch targets still require a fresh live Feishu capture for release sign-off.

## Reasoning-label alignment update

- Source visual truth: a user-provided Feishu desktop screenshot of the Codex reasoning selector.
- Viewport and state: Feishu desktop dark mode, reasoning selector with `ultra` selected.
- Copy: visible values now match Codex: `最低 / 轻度 / 中 / 高 / 极高 / 最高`; protocol enums stay in hidden option values.
- Typography, spacing, colors, and assets: unchanged because the implementation continues to use native CardKit controls.
- Automated evidence: TypeScript check and the full CardKit contract suite pass.
- Visual evidence: the implementation stays on native CardKit tokens and the existing dark-mode surface; a fresh live-card capture is required only for release sign-off, not for structural acceptance.

final result: passed structurally

## Global reply presentation gate

- All ordinary message branches route through the shared semantic response card; direct `lark.reply` calls are limited to that renderer’s durable fallback and outbox replay.
- Success, information, warning, permission, failure, stop and recovery outcomes each retain text labels in addition to color.
- Release demo evidence must include at least one ordinary response and one forced card-delivery fallback; a raw text response during healthy CardKit operation fails product QA.
