# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo with the following structure:

- `apps/web/` - React frontend using Vite, TanStack Router, and TailwindCSS
- `apps/backendv2/` - Backend API using Bun runtime and Effect-TS
- `apps/cluster/` - Effect Cluster service for distributed workflows and background jobs
- `packages/db/` - Shared database package using Drizzle ORM and PostgreSQL
- `packages/domain/` - Shared domain types, RPC contracts, and cluster definitions
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

**CRITICAL**: NEVER start the dev server - it should already be running! Do not run `bun run dev`, `PORT=3000 bun run dev`, or any variant of starting the dev server.

### Root Level

- `bun run dev` - Start all apps in development mode via Turbo (DO NOT USE - already running)
- `bun run build` - Build all apps and run typecheck
- `bun run typecheck` - Run TypeScript typechecking across all packages
- `bun run format` - Format code using Oxc (includes linting and auto-fixes)
- `bun run test` - Run tests in watch mode using Vitest
- `bun run test:once` - Run all tests once
- `bun run test:coverage` - Run tests with coverage report

### Web App (apps/web)

- `bun run dev` - Start Vite dev server on port 3000 (DO NOT USE - already running)
- `bun run build` - Build for production and typecheck
- `bun run typecheck` - TypeScript checking without emitting files

### Backend (apps/backendv2)

- `bun run dev` - Start backend with hot reload using Bun (DO NOT USE - already running)
- `bun run typecheck` - TypeScript checking

### Cluster (apps/cluster)

- `bun run dev` - Start cluster service with hot reload on port 3020 (DO NOT USE - already running)
- `bun run start` - Start cluster service in production mode
- `bun run typecheck` - TypeScript checking

### Database (packages/db)

- `bun run db` - Run Drizzle Kit commands for schema management

## Tech Stack

### Frontend (Web App)

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Routing**: TanStack Router with file-based routing
- **Styling**: TailwindCSS v4 with Radix UI themes
- **UI Components**: React Aria Components + Ariakit
- **State Management**: TanStack Query + React Form
- **Rich Text**: Plate.js editor with AI features
- **Real-time**: Cloudflare Realtimekit
- **Auth**: Clerk (`@clerk/react`)

### Backend

- **Runtime**: Bun
- **Framework**: Effect-TS for functional programming
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Clerk (`@clerk/backend` JWT verification + webhook sync)
- **API**: RPC-style endpoints via Effect Http Api

### Cluster Service

- **Runtime**: Bun
- **Framework**: Effect Cluster + Effect Workflow
- **Purpose**: Distributed workflows and background jobs
- **Storage**: PostgreSQL-backed message persistence
- **Communication**: BunClusterSocket for shard coordination
- **API**: HTTP endpoints for workflow management (port 3020)

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

**`@hazel/domain`** - RPC, HTTP, Cluster contracts, and models:

```typescript
import { Cluster, Rpc, Http } from "@hazel/domain"
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

Uses Drizzle ORM with PostgreSQL. Database schema is defined in `packages/db/src/schema/`. Use `bun run db` commands for migrations and schema management.

## Architecture Notes

- Frontend uses file-based routing with TanStack Router
- Backend follows Effect-TS patterns for error handling and dependency injection
- Real-time features implemented via Cloudflare Realtimekit
- Authentication handled by Clerk; backend verifies Clerk-issued JWTs and syncs users/orgs via webhook
- Shared database package ensures type safety between frontend and backend
- Domain package (`packages/domain/`) contains shared contracts:
    - RPC definitions for client-server communication
    - HTTP API definitions
    - Cluster entity and workflow definitions (importable by both frontend and cluster service)
    - Shared error types and data models

### Electric SQL Proxy — Required When Adding New Collections

**IMPORTANT**: When adding a new Electric-synced collection on the frontend (`apps/web/src/db/collections.ts`), you **must also** update the Electric proxy to allow the table:

1. **Add to `ALLOWED_TABLES`** in `apps/electric-proxy/src/tables/user-tables.ts`
2. **Add a `Match.when` case** in `getWhereClauseForTable` in the same file, using the appropriate WHERE clause builder (e.g., `buildOrgMembershipClause` for org-scoped tables, `buildChannelAccessClause` for channel-scoped tables)

Without both changes, Electric sync requests for the new table will be rejected by the proxy.

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

Use Brandfetch CDN for integration brand logos/icons. See `apps/web/src/routes/_app/$orgSlug/settings/integrations/_data.ts` for the helper function.

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

## Effect Cluster Architecture

The cluster service provides durable, distributed workflow execution:

### Domain Pattern for Cluster

**Definitions (packages/domain/src/cluster/):**

- `entities/` - Entity RPC definitions (client-importable)
- `workflows/` - Workflow type definitions
- `activities/` - Activity payload/result schemas
- `errors.ts` - Cluster-specific error types

**Implementations (apps/cluster/src/):**

- `entities/` - Entity handler implementations
- `workflows/` - Workflow handler implementations
- `index.ts` - Cluster server setup and HTTP API

### Available Workflows

**MessageNotificationWorkflow**: Creates notifications for new messages

- Triggered when a message is created in a channel
- Queries channel members with notifications enabled (`isMuted = false`)
- Excludes the message author from notifications
- Creates notification entries in the `notifications` table
- Increments `notificationCount` for each notified member
- Uses idempotency key (messageId) to process each message only once
- Activities:
    - **GetChannelMembers**: Queries eligible members from `channel_members` table
    - **CreateNotifications**: Batch creates notifications and updates counters

### Workflow Execution

Workflows can be triggered via HTTP API:

```bash
POST http://localhost:3020/workflows/MessageNotificationWorkflow/execute
{
  "id": "msg-uuid-123",
  "messageId": "msg-uuid-123",
  "channelId": "channel-uuid-456",
  "authorId": "user-uuid-789"
}
```

Or from backend code (typically in message creation handler):

```typescript
import { WorkflowClient } from "@hazel/cluster"

// After creating a message, enqueue an outbox event and let the backend dispatcher trigger workflows
yield *
	WorkflowClient.pipe(
		Effect.flatMap((client) =>
			client.workflows.MessageNotificationWorkflow.execute({
				id: message.id, // Execution ID (use message ID for idempotency)
				messageId: message.id,
				channelId: message.channelId,
				authorId: message.authorId,
			}),
		),
	)
```

### Adding New Workflows

1. **Define in domain** (`packages/domain/src/cluster/workflows/`):

    ```typescript
    import { Workflow } from "@effect/cluster"
    import { Schema } from "effect"

    export const MyWorkflow = Workflow.make({
    	name: "MyWorkflow",
    	payload: {
    		id: Schema.String,
    		// ... other payload fields
    	},
    	idempotencyKey: ({ id }) => id,
    })
    ```

2. **Define activity schemas** (`packages/domain/src/cluster/activities/`):

    ```typescript
    export const MyActivityResult = Schema.Struct({
    	resultField: Schema.String,
    })

    export class MyActivityError extends Schema.TaggedError<MyActivityError>()("MyActivityError", {
    	message: Schema.String,
    }) {}
    ```

3. **Implement in cluster** (`apps/cluster/src/workflows/`):

    ```typescript
    import { Activity } from "@effect/workflow"
    import { Cluster } from "@hazel/domain"
    import { Effect } from "effect"

    export const MyWorkflowLayer = Cluster.MyWorkflow.toLayer(
    	Effect.fn(function* (payload) {
    		// Use activities with proper schemas
    		const result = yield* Activity.make({
    			name: "MyActivity",
    			success: Cluster.MyActivityResult, // REQUIRED
    			error: Cluster.MyActivityError, // REQUIRED
    			execute: Effect.gen(function* () {
    				// Activity implementation
    				return { resultField: "value" }
    			}),
    		})

    		// Use result (properly typed)
    		yield* Effect.log(result.resultField)
    	}),
    )
    ```

4. **Register** in `apps/cluster/src/index.ts`:

    ```typescript
    import { MyWorkflowLayer } from "./workflows/index.ts"

    const workflows = [Cluster.MyWorkflow, ...] as const
    const AllWorkflows = Layer.mergeAll(MyWorkflowLayer, ...)
    ```

### Important Workflow Patterns

**Always include success/error schemas in Activity.make**:

```typescript
// ❌ WRONG - Missing schemas
yield* Activity.make({
  name: "SendEmail",
  execute: Effect.gen(...)
})

// ✅ CORRECT - Includes schemas
yield* Activity.make({
  name: "SendEmail",
  success: EmailSentResult,
  error: EmailSendError,
  execute: Effect.gen(...)
})
```

**Database access in workflows**:

```typescript
import { PgClient } from "@effect/sql-pg"

yield *
	Activity.make({
		name: "QueryDatabase",
		success: QueryResult,
		error: DatabaseError,
		execute: Effect.gen(function* () {
			const sql = yield* PgClient.PgClient
			const rows = yield* sql`SELECT * FROM table WHERE id = ${id}`.pipe(Effect.orDie)
			return rows
		}),
	})
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

- Theme tokens: `apps/web/src/styles/theme.css`
- Tailwind config & animations: `apps/web/src/styles/styles.css`
- Theme presets: `apps/web/src/lib/theme/presets.ts`
- Component library: `apps/web/src/components/ui/`

### Design Principles

1. **Clarity over cleverness** — Every element should have a clear purpose. Prefer obvious UI patterns over novel ones. Information hierarchy should be immediately readable.
2. **Quiet confidence** — Use restraint with color, motion, and decoration. Let whitespace, typography, and alignment do the heavy lifting. The interface should feel calm, not sterile.
3. **Speed is a feature** — Perceived and actual performance matter equally. Transitions should be fast (100-200ms). Keyboard shortcuts for power users. No unnecessary loading states or animations.
4. **Consistency compounds** — Use the existing design token system (`theme.css`, `tailwind-variants`). Reuse component patterns from `components/ui/`. Match spacing, radius, and color scales across features.
5. **Accessible by default** — Follow React Aria patterns. Respect `prefers-reduced-motion`. Ensure keyboard navigability. WCAG AA contrast minimums. Touch targets at 44x44px minimum.
