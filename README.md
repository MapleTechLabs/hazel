# Hazel Chat

A modern, real-time collaborative chat platform built with Effect-TS, Foldkit, TanStack DB and Cloudflare Durable Objects.

## Overview

Hazel Chat is a full-stack chat application featuring:

- **Effect-TS** for type-safe, functional backend programming
- **Foldkit** for an Elm-style frontend on Effect
- **Type-safe RPC** for seamless client-server communication
- **Real-time sync** from Durable Objects (one per organization, channel and user) into TanStack DB
- **Background work** (notifications, RSS, webhooks, thread naming) inside those objects

## Features

- **Real-time Messaging** - Channels and direct messages with instant delivery
- **User Presence** - Live online/offline status and typing indicators
- **Message Reactions** - React to messages with emoji
- **Pinned Messages** - Save important messages for quick access
- **File Attachments** - Share files with Cloudflare R2 storage
- **Notifications** - Configurable notification system with muting
- **Team Management** - Organizations with member roles and invitations
- **Rich Text Editor** - ProseMirror powered editor with formatting
- **Bot Integration** - Create and manage bots with a simple API

## Tech Stack

### Frontend

- **Foldkit** (Model / Message / update / view on Effect) with TypeScript
- **Vite** for fast development and builds
- **Routing** with a flat route union in `src/route.ts`
- **TanStack DB** collections
- **TailwindCSS v4** with `tailwind-variants`
- **`@foldkit/ui`** components
- **ProseMirror** for the message composer
- **Durable Object sync** over WebSockets (`libs/effect-db-collection`)

### Backend

- **Cloudflare Workers** and **Durable Objects**, deployed and run locally with **Alchemy**
- **Effect-TS** functional programming framework
- **Effect RPC** for type-safe APIs
- **effect-orm** (`@maple-dev/effect-orm`) on SQLite: Durable Object storage and D1
- **Hazel auth** (`@hazel/auth`) for sign-in and sessions

### Development Tools

- **Turborepo** for monorepo orchestration
- **OXC** for linting and formatting
- **Vitest** for testing

## Project Structure

```
├── apps/
│   ├── web-foldkit/         # Foldkit frontend (port 3100)
│   ├── backend/             # api Worker: HTTP API, RPC and the Durable Objects holding the data
│   ├── bot-gateway/         # Bot gateway Worker and its per-bot Durable Object
│   └── link-preview-worker/ # Link preview generation
├── packages/
│   ├── db/                  # effect-orm SQLite tables, per-store table lists, migrations
│   ├── sync-do/             # Durable Object sync runtime
│   ├── domain/              # Shared types, RPC contracts, sync protocol
│   ├── backend-core/        # Reusable backend services and repositories
│   ├── schema/              # Shared schema definitions
│   └── ...
└── .context/                # Library documentation (Effect, Effect Atom, TanStack DB)
```

## Prerequisites

- [Bun](https://bun.sh/) **v1.2.14 or later** (required for [workspace catalogs](https://bun.sh/blog/release-notes/bun-v1.2.14))
- [Docker](https://docker.com/) (MinIO, the local S3 for uploads)
- [Clerk](https://clerk.com/) account (for authentication)

## Getting Started

1. **Clone the repository**

    ```bash
    git clone <repository-url>
    cd app
    ```

2. **Install dependencies**

    ```bash
    bun install
    ```

3. **Run the setup wizard**

    ```bash
    bun run setup
    ```

    This interactive CLI will:
    - Start Docker services (MinIO)
    - Validate your environment
    - Generate secrets
    - Write `.env.local` (what `bun run alchemy:dev` reads; see `.env.local.example`)

4. **Start development**

    ```bash
    bun run dev
    ```

    This runs `bun run alchemy:dev`: every Worker (the api with its Durable Objects and the
    directory D1, the bot gateway, link preview, actors) runs locally in workerd, plus the web
    app's dev server. Local state lives in `.alchemy/`.

    The first-party bots (`bots/*`) run as Workers too: set `HAZEL_BOT_TOKEN` and/or
    `LINEAR_BOT_TOKEN` in `.env.local` and `alchemy:dev` starts them.

## Clerk Configuration

This project uses [Clerk](https://clerk.com/) for authentication. After creating a Clerk application, grab your **Publishable key** and **Secret key** from the dashboard and provide them to `bun run setup` (or set `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` in the generated `.env` files).

### Organizations

Enable **Organizations** in your Clerk dashboard (Organizations → Settings). Hazel uses Clerk organizations for multi-tenant workspaces, with members synced to our database via webhooks.

### Webhook endpoint

Add a webhook in the Clerk dashboard pointing at `http://<backend-host>/webhooks/clerk` (e.g. `http://localhost:3003/webhooks/clerk` for local dev, exposed via a tunnel). Subscribe to at least:

- `user.created`, `user.updated`, `user.deleted`
- `organization.created`, `organization.updated`, `organization.deleted`
- `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`

Copy the signing secret into `CLERK_WEBHOOK_SECRET`.

## Development Commands

| Command                 | Description                                 |
| ----------------------- | ------------------------------------------- |
| `bun run dev`           | Start the whole stack (`alchemy:dev`)       |
| `bun run build`         | Build all apps and packages                 |
| `bun run typecheck`     | Run TypeScript checking across all packages |
| `bun run format`        | Format and lint code with OXC               |
| `bun run test`          | Run tests in watch mode                     |
| `bun run test:once`     | Run all tests once                          |
| `bun run test:coverage` | Run tests with coverage report              |

## Architecture

### Effect-TS Patterns

The backend uses Effect-TS for:

- **Dependency injection** via layers and services
- **Error handling** with typed errors
- **Resource management** with scoped resources
- **Concurrency** with fibers and streams

### RPC System

Type-safe client-server communication using Effect RPC:

- Contracts defined in `packages/domain`
- Full type inference across the boundary
- Automatic serialization/deserialization

### Real-time Sync

Each organization, channel and user is a Durable Object with its own SQLite
(`infra/durable-object-sync-plan.md`):

- Clients open a WebSocket per object and receive their visible rows, then live changes
- Writes return a `transactionId` the client awaits before dropping its optimistic state
- Side effects between objects go through a transactional outbox, retried by alarms

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Detailed architecture and development guidelines
- **[packages/db/README.md](./packages/db/README.md)** - Database schema documentation
- **[.context/](./.context/)** - Library-specific guides for Effect, Effect Atom, and TanStack DB

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

See [LICENSE](./LICENSE) for details.
