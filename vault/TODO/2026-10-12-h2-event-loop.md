---
status: open
project: agent-automation
kind: epic
wave: 3
harness: h2-event-loop
pattern: event-driven
trends: T14 T1 T5
---

# H2 event-loop: Cursor Automations as the unattended loop

Proves unattended loops need no coordinator process if each run re-checks its gate. This is SDLC-SPDD U4, live.

## Owns these Agent Queue lines

H2.1 through H2.5. H2.4 is `#manual` (dashboard), H2.5 is `#live`.

## Behavior

Three separate automations on `pool-fixture`; nothing self-chains.

| Automation | Trigger | Prompt does | Exit |
| --- | --- | --- | --- |
| `ready` | issue label `ready` added | claim the Work ID, `sdlc.sh gate code`, implement one T##, run validation commands, open a PR | gate fail → comment and stop; never `--force` |
| `ci-fail` | **CI completed** on PR with failure | read the failing log, fix once, push | second identical failure → comment `shelf`, add label `shelved`, stop |
| `shelved` | PR label `shelved` added | write the pitfall to the ledger and the vault, close nothing | always stops |

Use *CI completed*, not *workflow run completed* (that trigger fires only for push-started runs). Filter by workflow file name.

## Files

`harnesses/h2-event-loop/prompts/ready.md`, `ci-fail.md`, `shelved.md`, `webhook-post.ts`, `lint-prompts.test.ts`, `README.md` (dashboard runbook with screenshots).

## Offline mode

Prompt lint asserts each prompt contains the four Kasana exit bullets and the repeat-stop rule. A replay test feeds recorded GitHub payloads to the `.cursor/hooks.json` stop gate.

## Done when

The three automations exist (runbook has the dashboard steps), one labeled issue produced a PR, one forced CI failure produced exactly one fix attempt and then a shelf label, and the ledger has the pitfall.
