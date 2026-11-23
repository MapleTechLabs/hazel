# Installing Hazel in a customer's Cloudflare account

A customer install is the whole Hazel stack (`infra/README.md`) deployed into the customer's own
Cloudflare account, on a zone they own, as the alchemy stage `customer-<name>`. It is a production
stage: custom domains, production env, and none of the dev-only routes (`/internal/dev/sign-in`
and the like refuse, whatever secrets are set).

## What the customer needs

- A Cloudflare account on the **Workers Paid** plan (Durable Objects with SQLite storage, a cron
  every minute, Worker CPU time), with **D1**, **R2** and **KV** enabled.
- A **zone** in that account for the install, e.g. `chat.acme.com` (`HAZEL_ZONE`). The stack puts
  every host under it:

    | Host                  | What                                                        |
    | --------------------- | ----------------------------------------------------------- |
    | `app.<zone>`          | the web app                                                 |
    | `api.<zone>`          | the api Worker (RPC, sync sockets, OAuth callbacks)         |
    | `cdn.<zone>`          | uploads (an R2 bucket the stack creates, with its own CORS) |
    | `link-preview.<zone>` | the link-preview Worker (URL unfurls)                       |
    | `bot-gateway.<zone>`  | the bot gateway                                             |
    | `mail.<zone>`         | sender of invitation and support emails                     |
    | `inbound.<zone>`      | support mailboxes (Customers area), optional                |

- An **API token** for the deploy, on that account: Workers Scripts, Workers KV, D1, R2,
  Workers Routes / Custom Domains and DNS on the zone, Account API Tokens (the stack mints a token
  scoped to the uploads bucket for presigned uploads), and the Durable Objects permissions.
- A **GitHub OAuth app** (required: sign-in is on only with one) and optionally a **Google OAuth
  client**, registered by the customer, with the callback URLs the installer prints
  (`https://api.<zone>/auth/{github,google}/callback`).
- **Email Sending** onboarded for `mail.<zone>` (dashboard, once: the deploy token has no Email
  Sending permission). Without it invitations only reach verified addresses. For support
  mailboxes, Email Routing on `inbound.<zone>` with a catch-all to the api Worker.

## Install

```bash
bun install
bun run customer:install            # asks for the name, zone, account, token, OAuth apps
```

The installer (`packages/setup`, `setup customer`) generates the install's secrets (the auth
signing and encryption keys, the integration encryption key), writes them with the answers to
`.env.customer-<name>` (gitignored), prints the OAuth callback URLs and DNS/email prerequisites,
and the deploy command. Pass `--deploy` to deploy right away. Every prompt has a flag, so it also
runs non-interactively (`bun run customer:install --help`).

**Keep `.env.customer-<name>` safe and never regenerate its secrets.** The auth keys sign every
session and the integration key encrypts every stored integration token: replacing them signs
everyone out and breaks every connected integration. The installer refuses to overwrite them
without `--force`. Store the file in the customer's secret manager.

Deploy (and every upgrade) is:

```bash
bun run customer:deploy <name>       # checks .env.customer-<name>, then deploys with it
```

`bun run customer:check <name>` validates the env file on its own (and, unless `--offline`, that
the token works and the zone is active in the account).

Alchemy keeps its state in the customer's account (`Cloudflare.state()`), so any machine with the
env file and the token can run the next deploy. `GET https://api.<zone>/version` reports the
commit and stage the install runs; `GET /health` answers `OK`.

## Access

By default anyone who can sign in with the configured provider can use the install and create
organizations. Three optional keys narrow that:

| Key                     | Effect                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `ALLOWED_EMAIL_DOMAINS` | comma-separated domains (`acme.com,acme.io`): sign-in is refused for any other address |
| `INSTANCE_ADMIN_EMAILS` | comma-separated emails of the install's admins                                         |
| `ORG_CREATION`          | `anyone` (default) or `admins`: only instance admins may create organizations          |

Invited users still join existing organizations. Bots are unaffected. The rules also apply to
existing users: setting `ALLOWED_EMAIL_DOMAINS` stops anyone outside it from signing in again.

## Integrations

Every integration authenticates against an app **the customer registers**, pointed at their
`api.<zone>`. Each is off until its keys are set (`apps/backend/src/worker/env.ts`):

- **GitHub / Google sign-in**: `AUTH_GITHUB_*`, `AUTH_GOOGLE_*`.
- **Slack**: `bun run slack:manifest --api-url https://api.<zone>` prints the app manifest for
  their Slack app; then `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
- **Linear**, **Discord**, **GitHub App**: their `*_CLIENT_ID` / secrets, with redirect URIs under
  `https://api.<zone>/integrations/<provider>/callback`. Discord allows one gateway session per bot
  token: a Discord bot must not be shared with another install.
- **Thread naming** (`OPENROUTER_API_KEY`), **GIFs** (`KLIPY_API_KEY`), **company enrichment**
  (`CONTEXT_DEV_API_KEY`): optional, off when unset.
- **iOS push** (`APNS_*`): only with the customer's own build of the iOS app (below).

The first-party bots (`bots/*`) deploy on a customer stage once their token is set: create the
bot in the install, put its token (`HAZEL_BOT_TOKEN`, ...) in the env file, and deploy again.

## Upgrades

- Upgrade by deploying a newer commit. Releases can be skipped: migrations are append-only (CI
  refuses a change to a committed one, `scripts/check-migrations-append-only.ts`), D1 migrations
  apply on deploy, and every Durable Object runs its pending migrations the next time it wakes.
  An organization idle since the deploy keeps its old schema until then; that is expected.
- Open web clients keep the build they loaded until they reload, so a deploy must keep accepting
  the previous build's RPCs and sync frames for a while (the same rule as for `prd`).
- Check `GET /version` after a deploy.

## Backups and restore

Every store keeps 30 days of point-in-time history; restores go through
`bun run operator:restore` (`scripts/operator-restore.ts`). `--dry-run` only looks the point up;
a restore asks you to type the object id (or database name) unless `--yes`.

- **Directory (D1)**: Time Travel restores the database to any minute of the last 30 days. The
  database is `hazel-directory-<name>`; the script runs `wrangler d1 time-travel` with the
  Cloudflare credentials in your env (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, from the
  install's env file):

    ```bash
    bun run operator:restore --kind directory --customer <name> --at 2026-11-20T09:00:00Z --dry-run   # info
    bun run operator:restore --kind directory --customer <name> --at 2026-11-20T09:00:00Z             # restore
    ```

- **Organizations, channels, users, Customers (Durable Objects)**: each SQLite-backed object keeps
  30 days of point-in-time recovery, restored one object at a time through the api's operator
  endpoints. They are on only when the install has an `OPERATOR_TOKEN` (the installer generates
  one; any random string works, and it can be rotated with a redeploy); without it they answer 404.

    ```bash
    export OPERATOR_TOKEN=...   # from .env.customer-<name>
    bun run operator:restore --api https://api.<zone> --kind org --id <organizationId> --at 2026-11-20T09:00:00Z --dry-run
    bun run operator:restore --api https://api.<zone> --kind org --id <organizationId> --at 2026-11-20T09:00:00Z
    ```

    `--kind` is `org` (id: the organization id), `channel` (a channel or thread id), `user` (a
    user id) or `customers` (the organization id). The endpoints are
    `GET /internal/operator/bookmark?kind&id&timestamp` (dry run) and
    `POST /internal/operator/restore` `{ kind, id, timestamp }`, with
    `Authorization: Bearer <OPERATOR_TOKEN>`. A restore arms the object's bookmark for that time
    (`ctx.storage.getBookmarkForTime` / `onNextSessionRestoreBookmark`) and restarts it; the answer
    carries the bookmark and the object's state before the restore (`current`). To undo, restore
    the same object to a time just before you ran it.

    A restore rolls back one object only. What it wrote to other stores since then stays: rows it
    projected into the directory or other objects (members, channel indexes, notifications) keep
    their newer values until the next write updates them, and clients resync the object from scratch.
    Restore the matching objects together (an org and its channels) when the incident spans them.

- **Uploads (R2)**: the `hazel-uploads-<name>` bucket; replicate it with R2's own tooling if the
  customer needs off-account copies.
- **Organization exports**: owners and admins can download a copy of their organization's data
  themselves (below); it is a copy for them, not a restore source.

## Data export

An organization's owners and admins export its data from **Settings → General → Export data**.
The organization's object builds the file in the background, a bounded step per alarm, reading
each channel and thread from its own object in pages, so it works for organizations of any size;
the page shows its progress live. The result is one NDJSON file (one `{ "table", "row" }` per
line, a header line first and an `end` line with the row count last) with the organization,
members, the members' public profiles (names, avatars, time zones; no emails), sections,
channels, threads, channel members, custom emojis, connected integrations (provider and account
name only), incoming webhooks (no tokens), and every channel's messages, reactions, pins and
attachment metadata with each file's public URL. Secrets are never read: integration tokens,
webhook tokens, auth data, bot tokens. Deleted messages are left out.

Files live in the install's private `hazel-org-exports-<name>` bucket and are downloaded through
a link the api signs for 15 minutes. An export can be downloaded for 7 days; the bucket deletes it
a day later. One export per organization runs at a time.

## Known limits

- **Native apps** point at Hazel's own install (`app.hazel.sh`): the iOS app's origin is built in
  (`apps/ios-hybrid`), and the desktop app's URLs are build inputs (`VITE_APP_URL`,
  `VITE_BACKEND_URL`, `apps/web-foldkit/scripts/production-env.sh`). A customer install is used from
  the browser, or from desktop/iOS builds made for it.
- **Connect** (shared channels between organizations) only connects organizations of the same
  install.
- **Data export** covers what an organization owns: a Connect channel's messages are in the host
  organization's export only, and the Customers area's data is not included.
- **Observability**: Hazel sees nothing of a customer install unless the customer sets a
  `MAPLE_API_KEY` (their own Maple org, or one Hazel gives them), which exports the Workers'
  traces, logs and metrics. Monitoring rules are declared for `prd` only.
