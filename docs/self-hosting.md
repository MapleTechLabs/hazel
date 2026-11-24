# Customer installs: the Hazel side

A customer install is the whole Hazel stack (`infra/README.md`) deployed into the customer's own
Cloudflare account, on a zone they own, as the alchemy stage `customer-<name>`. It is a production
stage: custom domains, production env, and none of the dev-only routes.

**The customer-facing guide is the docs site's Self-hosting section**
(`apps/docs/content/docs/self-hosting/`, docs.hazel.sh/self-hosting): prerequisites, the token's
permissions, sign-in apps, install, configuration, integrations, upgrades, backups and
troubleshooting. Keep it the one place those are written down; this file covers what Hazel itself
does for installs.

## Commands

All in `packages/setup` (`src/commands/customer.ts`; pure logic and tests in `src/customer/`):

| Command                           | What                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run customer:install`        | Asks for (or takes as flags) the settings, generates secrets, writes `.env.customer-<n>` |
| `bun run customer:check <name>`   | Checks the env file, the token's permissions, the zone and the workers.dev subdomain     |
| `bun run customer:deploy <name>`  | Checks, then deploys the checkout as `customer-<name>`                                   |
| `bun run customer:upgrade <name>` | Moves the checkout to the newest release (or `--to`), then deploys it in a new process   |
| `bun run customer:destroy <name>` | `alchemy destroy` of the stage, after typing its name                                    |

The token check (`src/customer/token.ts`) lists every permission the deploy needs and why. When the
stack starts calling a new Cloudflare API, add its permission there **and** to the guide's table
(`prepare-cloudflare.mdx`). An account-owned token is checked against its policies; a user token
can only be probed with read-only calls.

## Releases

Customers deploy **server releases**: git tags `server-vYYYY.MM.DD[.N]`
(`src/customer/releases.ts`), never `v*` (those are the desktop app's, `tauri-release.yml`).

Cut one with the **Server release** workflow (`.github/workflows/server-release.yml`, run by hand).
By default it releases the commit `api.hazel.sh/version` reports, so every release has served
Hazel's production first. It refuses a commit that is not on main, is already released, or does
not contain the previous release. It creates a GitHub release with generated notes, **never marked
latest**: the desktop updater reads `releases/latest` (`apps/desktop/src-tauri/tauri.conf.json`).

Compatibility a release must keep (the same rules as for prd):

- Migrations are append-only (`scripts/check-migrations-append-only.ts` in CI). D1 migrates on
  deploy; each Durable Object migrates when it next wakes, so code must work with objects still on
  an older schema.
- A deploy must keep accepting the previous build's RPCs and sync frames: open clients keep the
  build they loaded.
- Installs may skip releases, so any release must upgrade from any earlier one.

## Smoke test

`.github/workflows/customer-install-smoke.yml` (weekly, and by hand) installs the newest release
into a spare Cloudflare account exactly as a customer would, upgrades it to the commit under test
with `customer:upgrade`, checks it (`scripts/customer-smoke-verify.ts`: health, `/version`,
sign-in providers, the web shell, `/.well-known/hazel.json`) and destroys it.

It is off until this exists:

1. A spare Cloudflare account on Workers Paid, with a zone and a workers.dev subdomain, and an
   account-owned token with the guide's permissions.
2. A GitHub OAuth app with the callback `https://api.<zone>/auth/github/callback`.
3. An Infisical environment `customer-smoke` with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `HAZEL_ZONE`, `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET`, and a machine identity
   with OIDC auth bound to `repo:MapleTechLabs@282671153/hazel@972339714:environment:customer-smoke`.
4. A GitHub environment `customer-smoke` whose `INFISICAL_IDENTITY_ID` variable is that identity,
   and the repository variable `CUSTOMER_SMOKE_ENABLED=true`.

Run it before cutting a release with migrations in it.

## Brokered integrations

Customers can connect Slack, Linear and the GitHub App through Hazel's own apps. The trust model
(what transits Hazel, what is stored, how each side pins the other's key) is written for customers
in the guide's "Through Hazel's broker" (`apps/docs/content/docs/self-hosting/integrations.mdx`).
On Hazel's side:

1. Once: `bun run oauth-broker:keys` prints `OAUTH_BROKER_STATE_KEY` and
   `OAUTH_BROKER_SIGNING_KEY` (secrets) and `OAUTH_BROKER_PUBLIC_KEY` (public, for every
   instance). Set the two secrets, `OAUTH_BROKER_ENABLED=true` and `OAUTH_BROKER_INSTANCES='[]'` in
   Infisical `prod`. The broker reuses Hazel's redirect URIs
   (`https://api.hazel.sh/integrations/<provider>/callback`) and webhook URLs.
2. Per install: the customer sends the registry entry their installer printed
   (`{"id":"acme","apiUrl":"https://api.chat.acme.com","publicKey":{...}}`, public keys only).
   Append it to `OAUTH_BROKER_INSTANCES` (a JSON array) and deploy prd.
3. Send them `OAUTH_BROKER_URL=https://api.hazel.sh` and `OAUTH_BROKER_PUBLIC_KEY`.

Removing an entry stops new connections, refreshes and relays for that install at once.

Known limits: a GitHub installation is accepted for an instance only when no other instance or org
on Hazel's install holds it, and when GitHub reports it created or changed during the flow (a
"configure" visit that changes nothing fails; connecting again after a change works). A brokered
installation that is uninstalled keeps its route row (`oauth_broker_routes`) until Hazel deletes
it; it is inert. Discord cannot be brokered (one gateway session per bot token).

## Known limits of installs

- **Connect** (shared channels between organizations) only connects organizations of the same
  install.
- **Data export** covers what an organization owns: a Connect channel's messages are in the host
  organization's export only, and the Customers area's data is not included.
- **Observability**: Hazel sees nothing of an install unless the customer sets a `MAPLE_API_KEY`.
  Monitoring rules are declared for `prd` only.
- **Uploads**: a customer stage declares its own R2 bucket and mints its S3 credentials; Hazel's
  own stages still bring theirs through the `S3_*` keys.
