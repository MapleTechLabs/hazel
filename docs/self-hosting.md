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
- A **GitHub OAuth app**, a **Google OAuth client** (Web application), or both: at least one is
  required, since sign-in is on only with one. The customer registers them with the callback URLs
  the installer prints (`https://api.<zone>/auth/{github,google}/callback`). The sign-in page
  shows only the providers the install has (`GET /auth/providers`), plus passkeys.
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
`api.<zone>`, or, for Slack, Linear and the GitHub App, against Hazel's own apps through the
[OAuth broker](#brokered-integrations). Each is off until its keys are set
(`apps/backend/src/worker/env.ts`):

- **GitHub / Google sign-in**: `AUTH_GITHUB_*`, `AUTH_GOOGLE_*` (either or both; each needs its
  client id and secret).
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

### Brokered integrations

Registering a Slack app, a Linear OAuth app and a GitHub App per install is optional: Hazel's own
install (`api.hazel.sh`) runs an **OAuth broker** that lets a registered customer install connect
those three through Hazel's apps. A provider with its own keys in the env file keeps using them;
the broker is used only for a provider without them.

**Trust model.** The customer trusts Hazel with the moment of connection, not with storage:

- The provider redirects to Hazel's broker, which exchanges the code with Hazel's client
  credentials, encrypts the tokens to the instance's own public key (ECDH-ES P-256 + HKDF +
  AES-256-GCM, signed by the broker's ECDSA key) and has the browser POST them to the instance.
  The tokens exist on Hazel's side only in that request's memory; Hazel never stores them, and the
  payload opens only on that instance, within 5 minutes.
- Hazel stores only which instance a Slack team id or GitHub App installation id belongs to
  (`oauth_broker_routes` in its directory D1), to route webhooks and token refreshes.
- Slack events and GitHub webhooks for brokered installations arrive at Hazel's app URL: Hazel
  verifies them with its signing secrets and relays the raw body to the instance, signed by the
  broker (`POST https://api.<zone>/webhooks/<provider>/brokered`), so their content transits Hazel.
- GitHub App installation tokens last an hour and only the app's private key can mint them, so a
  brokered GitHub connection asks the broker for each new one (`POST /oauth-broker/github/refresh`,
  signed by the instance, answered sealed to it). OAuth refresh tokens refresh there too.
- Each side pins the other's key: the broker accepts only instances in its registry (checking the
  instance's signature on its OAuth state), the instance accepts only payloads and relays signed by
  the broker's key it was given.

A customer that does not accept tokens and events transiting Hazel registers its own apps instead.
**Discord cannot be brokered**: a bot token allows one gateway session, so a shared bot cannot
serve several installs; register a Discord app per install.

**Setting it up.**

1. Once, on Hazel's install: `bun run oauth-broker:keys` prints `OAUTH_BROKER_STATE_KEY` and
   `OAUTH_BROKER_SIGNING_KEY` (secrets) and `OAUTH_BROKER_PUBLIC_KEY` (public, for every instance).
   Set the two secrets, `OAUTH_BROKER_ENABLED=true`, and `OAUTH_BROKER_INSTANCES='[]'`. The broker
   reuses Hazel's existing redirect URIs (`https://api.hazel.sh/integrations/<provider>/callback`)
   and webhook URLs: nothing changes in the provider apps.
2. `bun run customer:install` writes the instance's id (`OAUTH_BROKER_INSTANCE_ID`, the install's
   name) and its private key (`OAUTH_BROKER_PRIVATE_KEY`) to its env file, and prints its registry
   entry: `{"id":"acme","apiUrl":"https://api.chat.acme.com","publicKey":{...}}` (public keys only).
3. Hazel appends that entry to `OAUTH_BROKER_INSTANCES` (a JSON array) and deploys.
4. The customer sets `OAUTH_BROKER_URL=https://api.hazel.sh` and `OAUTH_BROKER_PUBLIC_KEY` (from
   step 1) in its env file, leaves `SLACK_*`, `LINEAR_*` and `GITHUB_APP_*` unset, checks
   (`bun run customer:check`) and deploys.

Removing an instance from the registry stops new connections, refreshes and relays for it at once.
A connection made through the broker stays brokered (`metadata.brokered`): switching that provider
to the customer's own app means reconnecting it. Known limits: a GitHub installation is accepted for
an instance only when it is not held by another instance or by an org on Hazel's install, and when
GitHub reports it created or changed during the flow; a GitHub "configure" visit that changes
nothing therefore fails, and connecting again after a change works. A brokered installation that is
uninstalled keeps its route row until Hazel deletes it (it is inert: GitHub stops sending events).

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

- **Native apps** (desktop, iOS) start on Hazel's own install (`app.hazel.sh`). On the sign-in page,
  "Signing in to hazel.sh · Change" takes the install's web address (`chat.acme.com` or
  `https://app.chat.acme.com`; https only, http only for localhost). The app reads
  `https://<address>/.well-known/hazel.json`, then `https://app.<address>/...` when the user typed
  the zone: the web build writes that file from its build inputs (`VITE_APP_URL`,
  `VITE_BACKEND_URL`, `VITE_R2_PUBLIC_URL`, `VITE_LINK_PREVIEW_URL`) and serves it to any origin
  (`apps/web-foldkit/vite.config.ts`), so every install has it with no setup. Changing install signs
  out of the previous one, empties the keychain record and restarts the app on the new one
  (`apps/web-foldkit/src/core/config/server.ts`, `src/platform/server-switch.ts`); "Use Hazel cloud"
  goes back. The desktop app keeps the choice in its own storage and opens the install's
  `/auth/desktop` to sign in; the iOS app keeps it in the shell and loads its page on the install's
  web origin, which the install's API allows as its `FRONTEND_URL` (`apps/backend/src/lib/cors.ts`).
  Both sign in as Hazel's own desktop and native clients, which every install accepts.
- **Connect** (shared channels between organizations) only connects organizations of the same
  install.
- **Data export** covers what an organization owns: a Connect channel's messages are in the host
  organization's export only, and the Customers area's data is not included.
- **Observability**: Hazel sees nothing of a customer install unless the customer sets a
  `MAPLE_API_KEY` (their own Maple org, or one Hazel gives them), which exports the Workers'
  traces, logs and metrics. Monitoring rules are declared for `prd` only.
