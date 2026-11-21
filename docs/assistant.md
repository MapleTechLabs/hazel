# AI panel

A panel on the right of every org page where a member talks to an agent about what they are looking
at: a customer, a channel, a setting. The agent looks things up and recommends; it never applies
anything. The member decides and acts.

## Engines

A thread names the engine that runs it (`assistant_threads.engine`). Today there is one:

- **`t3code`**: the member's own linked T3 Code environment (Settings → Integrations → T3 Code).
  Hazel starts a scratch thread there over T3 Code's MCP server (`t3_thread_launch` with
  `scratch: true`) and follows it. The agent runs with the member's own Claude (or other provider)
  and their own tools, including Hazel's MCP server if they added it. The thread also shows in T3
  Code, where approvals are given.

A hosted engine (the Claude Agent SDK, or a tool loop over the Anthropic API, run by Hazel with
read-only tools) is the next one. It adds a value to `engine` and its own follower; the tables, RPCs
and the panel stay as they are.

## Data

In the `OrgObject` (`packages/db/src/tables/assistant.ts`):

- `assistant_threads`: one per conversation. `visibility` is `private` (default) or `organization`.
  `status` is `idle`, `running`, `waiting` (a question or an approval) or `error`. `context` is the
  page the latest message was sent from. `externalThreadId`/`externalLink` point at the engine's
  thread.
- `assistant_items`: the timeline. `kind` is `user`, `assistant`, `reasoning`, `tool`,
  `question`, `approval` or `notice`. Items repeat the thread's `ownerId` and `visibility`, so the
  sync condition needs no join and sharing is one `UPDATE`.
- `assistant_followers` (not synced): where the engine has read up to, the open question, and when
  the alarm steps the thread next.

Both synced tables are visible to members (never Connect guests) when they own the row or it is
shared with the organization (`sources/org-source.ts`, `byOwnerOrShared`).

## Flow

1. `assistant.start` (a client-made thread id, the message, the page context) launches the T3 Code
   thread with Hazel's instructions and the context, then records the thread, the member's item and
   a follower due now. A retried start with the same id launches once (`clientRequestId`).
2. The object's alarm (`assistantTick`, `worker/objects/org/assistant.ts`) steps each due thread:
   one `t3_thread_wait` of at most 20 s, an activity read from the follower's cursor, and the new or
   changed items written in one transaction. Unchanged items are not rewritten, so nothing syncs
   for them. The reply's text grows step by step: it streams in chunks, not tokens.
3. When T3 Code waits on a question, a `question` item carries it; `assistant.answer` responds over
   MCP. An approval cannot be given over MCP: the `approval` item links to T3 Code.
4. When the run ends with nothing queued, the thread goes `idle` (or `error`) and the follower stops.
   `assistant.send` queues a follow-up and starts following again; the context is repeated only
   when the member moved to another page.
5. An unreachable environment is retried with backoff (15 s doubling, up to 5 min, 20 tries); a
   refused credential marks the T3 Code link expired, and the thread shows why.

Only a thread's owner writes to it. `assistant.update` renames it or changes its visibility;
`assistant.delete` removes it for everyone (a run in progress finishes in T3 Code, unfollowed).

## Read-only, and how far it goes

The agent is told to only read and to recommend. Hazel never applies its suggestions. With the
`t3code` engine that is a request, not a sandbox: the agent runs with the member's tools on their
machine. For Hazel's own data, give its Hazel MCP connection read scopes only (`messages:read`,
`customers:read`), and the server refuses every write.
