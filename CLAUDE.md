# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo with the following structure:

- `apps/web-foldkit/` - Web frontend built with Foldkit (Effect-based Elm architecture), Vite and TailwindCSS. Also the desktop app's webview
- `apps/backend/` - The api Cloudflare Worker (Effect-TS): HTTP API, RPC, and the Durable Objects that hold the data (`src/worker/objects/`: `OrgObject`, `ChannelObject`, `UserObject`) over the directory D1 database
- `apps/bot-gateway/` - Bot gateway Worker and its `BotGateway` Durable Object (one per bot)
- `packages/db/` - Shared database package: effect-orm SQLite table definitions, the per-store table lists (`stores.ts`), the `Database` service, and the generated migrations
- `packages/sync-do/` - Durable Object sync runtime: change triggers, `_changes` log, broadcaster, sockets, outbox and inbox
- `packages/domain/` - Shared domain types, RPC and HTTP contracts, and the sync protocol (`src/sync/`)
- `packages/infra/` - Alchemy stack helpers (stages, Worker props, env, the directory D1); the stack itself is the root `alchemy.run.ts`
- `.context/` - Git Subtrees for context of how to use specific libraries (In this case Effect and Effect Atom)

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Library Documentation (.context/)

**IMPORTANT**: Always check the `.context/` directory for library-specific documentation and example code before implementing features with these libraries.

Available library contexts:

- `.context/effect/` - Effect-TS functional programming patterns and examples
- `.context/effect-atom/` - Effect Atom state management documentation
- `.context/tanstack-db/` - TanStack-DB

When working with Effect, Effect Atom, or TanStack DB, refer to these directories for best practices, API usage, and implementation patterns.

### Best Practices Guides

**Effect Atom**: See `EFFECT_ATOM_BEST_PRACTICES.md` for comprehensive guidance on:

- Creating and managing atoms
- React integration patterns
- Working with Effects and Results
- Integration with localStorage, HttpApi, and TanStack DB
- Performance optimization techniques
- Real-world examples from this codebase

## Development Commands

**CRITICAL**: NEVER start the dev server - it should already be running! Do not run `bun run dev`, `bun run alchemy:dev`, `PORT=3000 bun run dev`, or any variant of starting the dev server.

Local dev is `bun run alchemy:dev` (alias `bun run dev`): it runs every Worker in workerd, the Durable Objects and the directory D1 included (state in `.alchemy/`), plus the web app's Vite server. It reads only `.env.local` (see `.env.local.example`, or `bun run setup`); `docker compose up -d` starts MinIO for uploads. There is no Postgres, Electric or cluster.

### Root Level

- `bun run dev` / `bun run alchemy:dev` - Start the whole stack locally (DO NOT USE - already running)
- `bun run alchemy:typecheck` - Typecheck the alchemy stack (`alchemy.run.ts`, `apps/*/alchemy.run.ts`)
- `bun run setup` - Interactive setup: writes `.env.local` and the bots' `.env` files
- `bun run build` - Build all apps and run typecheck
- `bun run typecheck` - Run TypeScript typechecking across all packages
- `bun run format` - Format code using Oxc (includes linting and auto-fixes)
- `bun run test` - Run tests in watch mode using Vitest
- `bun run test:once` - Run all tests once
- `bun run test:coverage` - Run tests with coverage report

### Web App (apps/web-foldkit)

- `bun run dev` - Start Vite dev server on port 3100 (DO NOT USE - already running)
- `bun run build` - Build for production
- `bun run typecheck` - TypeScript checking without emitting files
- `bun run test` - Run the app's Vitest suite

### Backend (apps/backend)

- `bun run typecheck` - TypeScript checking (shared code, and the Worker graph under `tsconfig.worker.json`)
- `bun run test` - Run the backend's Vitest suite (objects and repositories run on in-memory node SQLite)
- `bun run test:sync` / `bun run test:policies` - Chat-sync, or policy, tests only

### Database (packages/db)

- `bun run db:generate-sqlite --name <name> [--hints <file.json>]` - Diff each store's tables against its snapshot (`snapshots/<store>.json`) and append the next migration (`src/migrations.generated.ts`, plus `migrations/directory/<NNNN>_<name>/migration.sql` for the directory store); writes nothing when no schema changed

## Tech Stack

### Frontend (Web App)

- **Framework**: Foldkit (Model / Message / update / view on Effect) with TypeScript
- **Build Tool**: Vite
- **Routing**: Flat route union in `src/route.ts`
- **Styling**: TailwindCSS v4, `tailwind-variants` styles in `src/core/components/ui/*.styles.ts`
- **UI Components**: `src/ui/` on `@foldkit/ui`
- **Data**: TanStack DB collections synced from the Durable Objects over WebSockets (`src/core/db/collections.ts`, `libs/effect-db-collection`)
- **Rich Text**: ProseMirror composer (`src/editor/`)
- **Auth**: Hazel auth (`@yielded/auth`)

### Backend

- **Runtime**: Cloudflare Workers (the api Worker), deployed and run locally with Alchemy
- **Framework**: Effect-TS for functional programming
- **Data**: SQLite everywhere through effect-orm (`@maple-dev/effect-orm`): each Durable Object's storage, and D1 for the global directory
- **Auth**: Hazel auth (`@hazel/auth`, on `@yielded/auth`): GitHub/Google sign-in, passkeys, cookie sessions; Clerk is only used to verify Maple's OAuth tokens (`services/oauth-bearer-auth.ts`)
- **API**: RPC-style endpoints via Effect Http Api

### Development Tools

- **Package Manager**: Bun with workspaces
- **Monorepo**: Turborepo for task orchestration
- **Linting/Formatting**: OXC (replaces ESLint + Prettier)
- **Testing**: Vitest with React Testing Library
- **TypeScript**: Strict mode enabled across all packages

## Code Style

The project uses OXC for consistent formatting:

- Tab indentation (4 spaces)
- Double quotes for strings
- Trailing commas
- 110 character line width
- Import organization and sorting enabled

Run `bun run format:fix` to apply formatting and fix linting issues automatically.

### Package Import Guide

**`@hazel/schema`** - Branded ID types (foundational, minimal dependencies):

```typescript
import type { OrganizationId, ChannelId, UserId, MessageId } from "@hazel/schema"
```

**`@hazel/domain`** - RPC and HTTP contracts, the sync protocol, and models:

```typescript
import { Rpc, Http, Sync } from "@hazel/domain"
import { Message, Channel, User } from "@hazel/domain/models"
```

### Branded Types for IDs

**ALWAYS** use the branded ID types from `@hazel/schema` instead of plain strings or `as any` casts. This ensures type safety across the codebase.

```typescript
// ✅ CORRECT - Use branded types from @hazel/schema
import type { OrganizationId, ChannelId, UserId } from "@hazel/schema"

function getChannel(channelId: ChannelId) { ... }
function listDomains(organizationId: OrganizationId) { ... }
```

```typescript
// ❌ WRONG - Don't use plain strings or `as any`
function getChannel(channelId: string) { ... }
payload: { id: organizationId as any }  // Never do this!
```

Available branded types in `@hazel/schema`: `OrganizationId`, `ChannelId`, `UserId`, `MessageId`, `BotId`, `InvitationId`, `ChannelMemberId`, `OrganizationMemberId`, `TransactionId`, and many more. See `packages/schema/src/ids.ts` for the full list.

## Database

There is no central database. Data lives in SQLite stores (`infra/durable-object-sync-plan.md` §1), each with the table list in `packages/db/src/stores.ts`:

- **directory** (D1 `DIRECTORY_DB`, global): users, `auth_*`, bots, bot commands, invitations, and the routing indexes (`org_index`, `membership_index`, `channel_index`, ...)
- **org** (`OrgObject`, one per organization): organizations, members, channels, channel members, sections, `channel_access`, integrations, webhooks, Connect; plus read-only projections (`users`, presence, bots)
- **channel** (`ChannelObject`, one per channel, threads too): messages, reactions, pins, attachments, typing; projections `channel_viewers`, `channel_bots`
- **user** (`UserObject`, one per user): notifications, presence, `user_organizations`

Uses effect-orm (`@maple-dev/effect-orm`, source in `~/Documents/GitHub/effect-clickhouse`). Tables are `SQLite.table` definitions in `packages/db/src/tables/`.

```typescript
import { Database, SQLite, schema } from "@hazel/db"

const db = yield * Database.Database
const channel =
	yield *
	db.first(
		SQLite.from(schema.channelsTable)
			.select()
			.where(($) => [$.id.eq(channelId), $.deletedAt.isNull()]),
	)
```

- Inside an object, `Database` is the object's own SQLite; on the api Worker it is D1. A handler touches only its own store and sends everything else through the outbox (`apps/backend/src/worker/objects/effects/`); a projection is written only by its owner's outbox deliveries.
- `db.transaction(effect)` works on Durable Object SQLite; **D1 has no transactions** (it refuses), so directory writes are single statements or batches, and idempotent.
- Schema changes (every store is live with production data, so migrations are append-only; never edit a committed one, `0001_initial` included):
    1. Edit `src/tables` (and `src/tables/extra-indexes.ts` for partial/expression indexes, `src/stores.ts` for a new table).
    2. `cd packages/db && bun run db:generate-sqlite --name <snake_case_name>`. For each store whose tables differ from `snapshots/<store>.json` it appends `<NNNN>_<name>` (effect-orm's SQLite diff: `ADD COLUMN`, `CREATE TABLE`/`INDEX`, or a table rebuild) to `src/migrations.generated.ts`, rewrites the snapshot, and for the directory store writes `migrations/directory/<NNNN>_<name>/migration.sql`. A drop or rename stops with the hints it needs (`confirm_data_loss` / `confirm_rename`, see effect-orm's `docs/migrations.md#sqlite`); put them in a JSON array and pass `--hints <file>`.
    3. Commit the generated files and snapshots together. `schema-ddl.test.ts` fails while a store's tables differ from its snapshot.
- Applying: object stores (org, channel, user) migrate **lazily**: each Durable Object instance runs its pending `storeMigrations` when it activates (`makeObjectRuntime` → `applyMigrations`, ledger in `_migrations`), so an object idle since the deploy keeps the old schema until its next request. Code must not assume every object has migrated, and a new column must be nullable or have a default. Alchemy applies the D1 migrations in `migrations/directory/` on deploy and under `alchemy dev`.

## Architecture Notes

- Backend follows Effect-TS patterns for error handling and dependency injection
- Real-time sync: each object streams its tables to the client over a WebSocket (`GET /sync/:kind/:id`, `apps/backend/src/worker/sync-route.ts`); change triggers feed a `_changes` log, and RPC results carry a `transactionId` the client awaits (`packages/sync-do`)
- RPCs: the api Worker authenticates and routes each RPC to its object (`org`, `channel`, `user`) or runs it against D1 (`apps/backend/src/rpc/routing.ts`); the handlers in `apps/backend/src/rpc/handlers` run inside the objects, and authorization runs there too
- Background work runs in the objects: outbox deliveries, alarms (RSS polling, typing expiry, upload cleanup, presence), thread naming
- Authentication handled by Hazel auth (`packages/auth`); the RPC and HttpApi middlewares resolve the session cookie, a session bearer credential (native clients) or a bot token to `CurrentUser`
- Shared database package ensures type safety between frontend and backend
- Domain package (`packages/domain/`) contains shared contracts:
    - RPC definitions for client-server communication
    - HTTP API definitions
    - The sync protocol frames (`src/sync/`)
    - Shared error types and data models

### Adding a Synced Table

A table the client syncs needs all of:

1. **The store**: add the table to its store's list in `packages/db/src/stores.ts` (and a projection's to each store it is copied into), then run `bun run db:generate-sqlite --name <name>`.
2. **The sync source**: add a `SyncTableSpec` (the table, its per-principal `visible` condition, `dependsOn`) to the object's source in `apps/backend/src/worker/objects/sources/` (`org-source.ts`, `channel-source.ts`, `user-source.ts`). A table that is not listed there is never streamed.
3. **The collection**: add it in `apps/web-foldkit/src/core/db/collections.ts` (`orgCollection`, `channelCollectionOf`, or a `userSources` collection).

## Effect-TS Best Practices

> **Skill Available**: Run `/effect-best-practices` for comprehensive Effect-TS patterns. The skill auto-activates when writing Context.Service, Schema.TaggedError, Layer composition, or effect-atom code.

> **Version note**: The repo is on Effect `4.0.1` stable. Former `effect/unstable/*` modules import from `effect/*` (e.g. `effect/http`, `effect/rpc`, `effect/workflow`), and `effect/unstable/httpapi` is now `effect/http-api`. Constructors are PascalCase (`Config.String`, `Schema.TaggedError`, `Flag.Boolean`).

> **Naming note**: As of `effect@4.0.0-beta.57` the `ServiceMap` module was renamed back to `Context`. The v3 `Context.Tag` API is gone — `Context.Service` (with a `make` option) is the v4 way to declare services. Older code may still reference `ServiceMap`; treat any new `ServiceMap` import as a mistake.

### Always Use `Context.Service` for Services

**ALWAYS** prefer `Context.Service` (from `effect`) for defining services. `Context.Service` with a `make` option stores the constructor effect on the class. You must define the layer explicitly using `Layer.effect`.

```typescript
// ✅ CORRECT - Use Context.Service with make and explicit layer
import { Context, Effect, Layer } from "effect"

export class MyService extends Context.Service<MyService>()("MyService", {
	make: Effect.gen(function* () {
		// ... implementation
		return {
			/* methods */
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

// Usage: MyService.layer, yield* MyService
```

```typescript
// ❌ WRONG - Don't use the legacy ServiceMap name
import { ServiceMap } from "effect" // <- no longer exported in beta.57+
```

```typescript
// ❌ WRONG - Don't use v3 Effect.Service pattern
export class MyService extends Effect.Service<MyService>()("MyService", {
	accessors: true,
	effect: Effect.gen(function* () {
		/* ... */
	}),
}) {}
```

### Wire Dependencies with `Layer.provide`

Wire service dependencies using `Layer.provide` on the layer. The v3 `dependencies` array no longer exists.

```typescript
// ✅ CORRECT - Dependencies wired via Layer.provide on the layer
export class MyService extends Context.Service<MyService>()("MyService", {
	make: Effect.gen(function* () {
		const db = yield* DatabaseService
		const cache = yield* CacheService
		// ... implementation
		return {
			/* methods */
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DatabaseService.layer),
		Layer.provide(CacheService.layer),
	)
}

// Usage is simple - MyService.layer includes all dependencies
const MainLive = Layer.mergeAll(MyService.layer, OtherService.layer)
```

```typescript
// ❌ WRONG - v3 dependencies array no longer exists
export class MyService extends Effect.Service<MyService>()("MyService", {
	dependencies: [DatabaseService.Default, CacheService.Default],
	effect: Effect.gen(function* () {
		/* ... */
	}),
}) {}
```

**When it's acceptable to omit `Layer.provide`:**

- Infrastructure layers that are globally provided (e.g., Redis, Database) may be intentionally "leaked" to be provided once at the application root
- When a dependency is explicitly meant to be provided by the consumer

### Use Descriptive Errors Instead of `catchAll`

**ALWAYS** prefer `catchTag` or `catchTags` over `catchAll` when handling errors. This preserves error type information and allows for proper error handling throughout the stack.

```typescript
// ❌ WRONG - catchAll loses error type information
yield *
	someEffect.pipe(
		Effect.catchAll((err) => Effect.fail(new InternalServerError({ message: "Something failed" }))),
	)

// ✅ CORRECT - catchTag preserves error types and provides specific handling
yield *
	someEffect.pipe(
		Effect.catchTag("RequestError", (err) =>
			Effect.fail(
				new WorkflowServiceUnavailableError({ message: "Service unreachable", cause: String(err) }),
			),
		),
		Effect.catchTag("ResponseError", (err) =>
			Effect.fail(new InternalServerError({ message: err.reason, cause: String(err) })),
		),
	)
```

**Why this matters:**

- Preserves error type information for downstream handlers
- Enables proper error handling on frontend (specific messages per error type)
- Makes debugging easier with clear error categorization
- Allows type-safe error handling with `Effect.catchTags`

## Brand Icons

Use Brandfetch CDN for integration brand logos/icons. See `apps/web-foldkit/src/core/lib/integrations/__data.ts` for the helper function.

**URL Pattern**: `https://cdn.brandfetch.io/{domain}/w/{size}/h/{size}/theme/{theme}/{type}`

- `domain`: The company's domain (e.g., `linear.app`, `github.com`, `figma.com`)
- `size`: Image dimensions in pixels (e.g., 64, 512)
- `theme`: `light` or `dark`
- `type`: `icon` (small inline logos) or `symbol` (larger brand marks)

**Example**:

```typescript
// For small inline icons, use type="icon"
<img src="https://cdn.brandfetch.io/linear.app/w/64/h/64/theme/dark/icon" alt="Linear" className="size-4" />
```

## Design Context

### Users

Hazel Chat serves startup teams, developer teams, and enterprise teams who need focused, reliable team communication. Users are technical and design-conscious — they expect a fast, well-crafted tool that stays out of their way and lets them focus on work.

### Brand Personality

**Calm, polished, reliable.** The interface should feel like a precision instrument — confident and trustworthy without being cold. Every interaction should reinforce that this is a tool built with care.

**Emotional goals:** Confidence & clarity (users always know where they are), calm & focus (a quiet space for conversations), speed & efficiency (everything feels instant).

### Aesthetic Direction

**Reference:** Linear / Raycast — clean, fast, keyboard-first with a refined developer-tools aesthetic. Crisp typography, restrained color, purposeful motion.

**Anti-references:** Discord (too noisy/gaming), Microsoft Teams (too corporate/cluttered), old-school Slack (too colorful/dated). Avoid visual noise, excessive color variety, and playful/whimsical elements.

**Theme:** Light and dark mode supported. Default brand purple (`#6938EF`) with customizable presets. Inter font family. OKLch-based color system with neutral gray defaults.

**Key design files:**

- Theme tokens: `apps/web-foldkit/src/core/styles/theme.css`
- Tailwind config & animations: `apps/web-foldkit/src/core/styles/styles.css`
- Theme presets: `apps/web-foldkit/src/core/lib/theme/presets.ts`
- Component library: `apps/web-foldkit/src/ui/`

### Design Principles

1. **Clarity over cleverness** — Every element should have a clear purpose. Prefer obvious UI patterns over novel ones. Information hierarchy should be immediately readable.
2. **Quiet confidence** — Use restraint with color, motion, and decoration. Let whitespace, typography, and alignment do the heavy lifting. The interface should feel calm, not sterile.
3. **Speed is a feature** — Perceived and actual performance matter equally. Transitions should be fast (100-200ms). Keyboard shortcuts for power users. No unnecessary loading states or animations.
4. **Consistency compounds** — Use the existing design token system (`theme.css`, `tailwind-variants`). Reuse component patterns from `components/ui/`. Match spacing, radius, and color scales across features.
5. **Accessible by default** — Follow React Aria patterns. Respect `prefers-reduced-motion`. Ensure keyboard navigability. WCAG AA contrast minimums. Touch targets at 44x44px minimum.
