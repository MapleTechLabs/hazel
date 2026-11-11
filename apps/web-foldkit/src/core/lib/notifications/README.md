# Notifications Module

This module centralizes desktop notification behavior for Hazel.

## Invariants

- Every notification event is processed by the orchestrator exactly once per session unless a sink fails.
- Policy decisions (muted/focus/session-start) are computed once in the orchestrator.
- Sinks are execution-only and must not duplicate policy logic.

## Main parts

- `types.ts`: shared contracts for decisions, events, sink outcomes.
- `orchestrator.ts`: queueing, dedupe, decisioning, sink fan-out.
- `sinks/`: the sound and native handlers (in-app notifications are the synced rows themselves).
