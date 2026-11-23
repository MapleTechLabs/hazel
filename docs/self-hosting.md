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
`api.<zone>`, or, for Slack, Linear and the GitHub App, against Hazel's own apps through the
[OAuth broker](#brokered-integrations). Each is off until its keys are set
(`apps/backend/src/worker/env.ts`):

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

- **Directory (D1)**: Time Travel restores the database to any minute of the last 30 days
  (`wrangler d1 time-travel restore <db> --timestamp ...`). The database is
  `hazel-directory-<name>`.
- **Organizations, channels, users (Durable Objects)**: SQLite-backed objects keep 30 days of
  point-in-time recovery per object (`ctx.storage.getBookmarkForTime` /
  `onNextSessionRestoreBookmark`). There is no tooling around it yet: a restore is a per-object
  operation run by Hazel.
- **Uploads (R2)**: the `hazel-uploads-<name>` bucket; replicate it with R2's own tooling if the
  customer needs off-account copies.

## Known limits

- **Native apps** point at Hazel's own install (`app.hazel.sh`): the iOS app's origin is built in
  (`apps/ios-hybrid`), and the desktop app's URLs are build inputs (`VITE_APP_URL`,
  `VITE_BACKEND_URL`, `apps/web-foldkit/scripts/production-env.sh`). A customer install is used from
  the browser, or from desktop/iOS builds made for it.
- **Connect** (shared channels between organizations) only connects organizations of the same
  install.
- **Data export**: there is no self-serve export of an organization's data yet.
- **Observability**: Hazel sees nothing of a customer install unless the customer sets a
  `MAPLE_API_KEY` (their own Maple org, or one Hazel gives them), which exports the Workers'
  traces, logs and metrics. Monitoring rules are declared for `prd` only.
