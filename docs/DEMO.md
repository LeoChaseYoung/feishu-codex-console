# Product demo

This is the repeatable five-minute demo for a release candidate. Use a disposable repository without customer data and a private Feishu chat.

## Setup

1. Install with the personal-safe preset and keep `workspace-write`, network off, and Web search disabled.
2. Open a small Git repository with one intentionally failing test.
3. In Feishu, send `新手引导`; verify the welcome card shows one clear primary action for the current device/project/role state.

## Demo story

| Moment | Action | Product proof |
|---|---|---|
| 0:00 | Send `控制台` or `额度` | Device, consumers, Codex, independent native quota windows, reset times, project, queue, permission, and sampled time are clear |
| 0:30 | Send `项目` and select the demo repo | Path/branch/dirty state prevent wrong-project execution |
| 1:00 | Ask Codex to diagnose the failing test | A single live task card shows context, progress, model, reasoning, and permission |
| 2:00 | Send a follow-up requirement | The same turn records steering instead of silently creating a second task |
| 2:30 | Answer a non-secret question or one-shot approval | Native interaction resumes the same Codex task and expires safely |
| 3:15 | Open `查看验证`, inspect a Diff, then `返回结果` | The original task card switches surfaces without adding messages; tests, attribution, and paged diff remain visible |
| 4:00 | Send `任务`, then `团队` | Task history and privacy-preserving team aggregate use consistent product cards |
| 4:30 | Send `运行手册` | A reviewed repository task can run without raising the member’s permission |

## Failure proof

Repeat one short task, then stop the bridge process while it is running. After the service restarts:

- the task is marked interrupted rather than replayed;
- already-written file changes remain reviewable;
- the card or reliable fallback gives a recovery action;
- a never-started queued task can resume safely.

## Release evidence

Capture the same desktop width and Feishu theme for each release. Redact names, project paths, member IDs, tokens, prompts containing private code, and attachments. Keep these seven frames:

1. installation success;
2. device console;
3. project selector;
4. live task;
5. question or approval;
6. result review;
7. recovery state.

The demo passes only when controls are usable, text is not clipped, every ordinary response uses the shared Card 2.0 shell, and no card claims success before the underlying state is verified.
