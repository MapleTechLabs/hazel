# AI panel

A panel on the right of every org page where a member talks to an agent about what they are looking
at: a customer, a channel, a setting. The agent looks things up and recommends; it never applies
anything. The member decides and acts.

## Hazel owns the tools

Hazel's read-only tools live in one registry (`apps/backend/src/tools/hazel-read-tools.ts`): each
has a name, an LLM-facing description, its input as JSON Schema, an output schema and a handler.
The handlers act as one member through `MemberAccess` (`tools/member-access.ts`): the same object
calls and HazelRpc methods the app uses, so exactly that member's permissions apply (a channel they
cannot see is refused by its `ChannelObject`, a Customers read by the `CustomersObject`). It has two
implementations: through `ObjectStubs` (the api Worker, for the MCP route) and inside an object
(the org object runs its own calls and RPCs in process, the rest through stubs).

Engines consume the registry: the MCP server (`routes/mcp.ts`) lists the read tools from it beside
its write tools, and `toAiToolkit` turns it into an `effect/ai` toolkit for the hosted engines.

## Engines

A thread names the engine that runs it (`assistant_threads.engine`); a member's preferred engine
(`assistant_preferences`) starts new chats, and a thread keeps its own engine for every follow-up.
There are two kinds.

### Hosted: `anthropic`, `openai`

Hazel runs the agent loop itself (`worker/objects/org/assistant-hosted.ts`) with the member's own
API key: `effect/ai`'s `LanguageModel` (`@effect/ai-anthropic`, `@effect/ai-openai`) and the
registry's toolkit, acting as the thread's owner. Models: Anthropic `claude-sonnet-5-5`, OpenAI
`gpt-5.5` (`HOSTED_MODELS` in `org/assistant-keys.ts`).

- **Keys**: a key is the member's user-level integration connection (provider `anthropic` or
  `openai`) with the key as its encrypted token, as a T3 Code link holds its credential.
  `assistant.saveKey` checks it with the provider first (its model list: no tokens spent), then
  stores it and makes that engine the preferred one. The key is never returned, synced or logged;
  the connection row (provider and status) syncs to its owner only. `assistant.removeKey` forgets it.
- **Enforced read-only**: the model gets the read toolkit and nothing else. There is no write tool
  to call.
- **Durable**: `assistant.start`/`send` record the member's item and arm the follower; the org
  object's alarm runs the turn (`assistantTick` → `runHostedTurn`), so a queued turn survives an
  eviction. While a turn runs its follower carries `turnStartedAt`; the next instance that finds a
  turn marked with no fiber of its own running it marks it cut off (the thread in error, its open
  items failed). A message sent during a turn is answered by the next turn.
- **Streaming**: text deltas are written to the reply's item at most every 300 ms, and each write
  is flushed to the sync sockets while the alarm is still running: the runtime binds
  `AssistantHost.flush` to the sync runtime's `flush` (`worker/objects/runtime.ts`), which
  broadcasts what was committed without waiting for the end of the alarm (the outbox and the alarm
  rearm still happen after it). A new item, a tool call and a tool result are flushed at once.
  Summarized thinking becomes `reasoning` items; each tool call a `tool` item (running, then
  completed or failed, with its one-line input and its output). The panel re-renders only the item
  that changed.
- **Guards**: at most 10 model calls a turn, 60 s without a part fails a call, 3 min per call,
  8 min per turn, and a reply repeating itself is stopped. A failure shows Hazel's own message,
  never the provider's text (the thread may be shared). `assistant.stop` ends the turn where it is.
- **Spans**: `Assistant.hostedTurn` (provider, model, token usage, outcome), `Assistant.modelCall`
  per call (usage, finish reason), `Assistant.toolCall` per tool (its name).

### External agents: `t3code`

The member's own linked T3 Code environment (Settings → Integrations → T3 Code). Hazel starts a
scratch thread there over T3 Code's MCP server (`t3_thread_launch` with `scratch: true`) and
follows it. The agent runs with the member's own provider and their own tools. The thread also
shows in T3 Code, where approvals are given.

What it still lacks: **Hazel's workspace tools**. T3 Code's agent only has Hazel's tools if the
member added Hazel's MCP server to T3 Code themselves. Giving it a per-chat, scoped MCP endpoint
(the registry's read tools, as the member, for this chat only) needs `t3_thread_launch` to accept
`mcpServers`, an upstream change in T3 Code. Until then, read-only is an instruction there, not a
sandbox.

### Order of work

1. One registry of read-only tools, served by MCP (done).
2. Hosted engines with the member's own key, on the alarm, streaming (done).
3. A per-chat scoped MCP endpoint over the registry, handed to T3 Code once `t3_thread_launch`
   accepts `mcpServers` (upstream).
4. Other local agents over ACP, consuming the same endpoint.

## Data

In the `OrgObject` (`packages/db/src/tables/assistant.ts`):

- `assistant_threads`: one per conversation. `visibility` is `private` (default) or `organization`.
  `status` is `idle`, `running`, `waiting` (a question or an approval) or `error`. `context` is the
  page the latest message was sent from. `externalThreadId`/`externalLink` point at the engine's
  thread.
- `assistant_items`: the timeline. `kind` is `user`, `assistant`, `reasoning`, `tool`,
  `question`, `approval` or `notice`. Items repeat the thread's `ownerId` and `visibility`, so the
  sync condition needs no join and sharing is one `UPDATE`.
- `assistant_followers` (not synced): where the engine has read up to, the open question, when
  the alarm steps the thread next, and (hosted) when the turn in progress started.
- `assistant_preferences` (not synced): each member's engine for new chats.

Both synced tables are visible to members (never Connect guests) when they own the row or it is
shared with the organization (`sources/org-source.ts`, `byOwnerOrShared`).

## Flow (T3 Code)

The hosted engines share steps 1 and 4 (without the T3 Code calls); their turns are described above.

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

The agent is told to only read and to recommend. Hazel never applies its suggestions. With a hosted
engine that is enforced: the model has read tools only. With the `t3code` engine it is a request,
not a sandbox: the agent runs with the member's tools on their
machine. For Hazel's own data, give its Hazel MCP connection read scopes only (`messages:read`,
`customers:read`), and the server refuses every write.
