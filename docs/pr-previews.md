# PR previews

A PR with the `preview` label gets its own Alchemy stage, `pr-<n>`
(`.github/workflows/deploy-pr-preview.yml`):

- web: `https://app-pr-<n>.hazel.sh`, api: `https://api-pr-<n>.hazel.sh`
- its own directory D1, Durable Objects (org, channel, user), KV and html-renders bucket
- uploads go to the shared `hazel-previews` R2 bucket, never the prod bucket
- telemetry reports to Maple with `deployment.environment = pr-<n>`

Each push to the PR redeploys it, and the bot comments the URLs on the PR. Only branches of this
repo deploy: the job does not run for forks.

## Secrets

Every deploy secret lives in Infisical (project `Hazel`, `.infisical.yaml`). Previews read the
`preview` environment, prd reads `prod`. GitHub holds no deploy secrets.

The job signs in to Infisical with its GitHub OIDC token (`Infisical/secrets-action`) as the
machine identity `hazel-gh-pr-preview`, whose OIDC subject is bound to the `pr-preview` GitHub
Environment. Its id is that environment's `INFISICAL_IDENTITY_ID` variable. The action exports every
key of `preview` to the job, and alchemy reads them through `Config` (`apps/backend/src/worker/env.ts`,
`apps/*/alchemy.run.ts`).

The identity has the project's `viewer` role. Infisical's plan has no custom roles, so it could
read `prod` too: the workflow file is what limits it to `preview`.

What `preview` holds, and how it differs from `prod`:

| Key                                             | Preview value                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | same as prod (the stages share the account and the `hazel.sh` zone)      |
| `S3_*`                                          | the `hazel-previews` bucket, with an R2 token scoped to that bucket only |
| `S3_PUBLIC_URL`, `VITE_R2_PUBLIC_URL`           | the bucket's public `r2.dev` URL                                         |
| `INTEGRATION_ENCRYPTION_KEY`                    | its own key (previews never read prod ciphertexts)                       |
| `DEV_SIGNIN_SECRET`                             | its own secret; turns on dev sign-in (never passed to prd)               |
| `MAPLE_API_KEY`                                 | same as prod: the deploy binds Maple's ingest key onto the Workers       |
| `AUTH_BINDING_KEY`, `AUTH_TRANSACTION_KEY`      | their own keys (`bun run --cwd packages/auth generate-keys`)             |
| `AUTH_ACCESS_TOKEN_KID`, `…_PRIVATE_JWK`        | their own ES256 key; without it `/auth/token` is off and the app hangs   |

Left unset on purpose: `COOKIE_DOMAIN` (prd's `.hazel.sh` would share the integration OAuth
cookies with prod; the session cookie is host-only `__Host-` anyway), the OAuth apps (`AUTH_GITHUB_*`, `AUTH_GOOGLE_*`: their callback URLs cannot cover every
preview), `CLERK_SECRET_KEY` (API v1 answers 503) and the integrations.

### Adding a secret

1. Read it in code through `Config` (`apps/backend/src/worker/env.ts` for the api Worker).
2. Set it in Infisical, in `prod` and, if previews need it, `preview`:
   `infisical secrets set --env preview KEY=value` (or the Infisical UI).
3. Don't add it to the workflow: an `env:` entry there would shadow the Infisical value.

A value derived from another one (a generated key) never needs to appear on screen:
`infisical secrets set --env preview "KEY=$(openssl rand -base64 32)"`.

## Deploying and tearing down

- Deploy: `gh pr edit <n> --add-label preview`. Every later push redeploys.
- Tear down: remove the label (`gh pr edit <n> --remove-label preview`) or close the PR. The job
  runs `alchemy destroy --stage pr-<n>`, which deletes the stage's Workers, D1, KV and html-renders
  bucket. Uploads in `hazel-previews` stay.
- Redeploy from scratch: remove the label, wait for the teardown, add it again.

## Signing in to a preview

Previews have no OAuth app. Sign in with `POST /internal/dev/sign-in`
(`apps/backend/src/routes/dev-sign-in.http.ts`), which finds or creates a user by email:

```bash
infisical run --env preview -- bun run --cwd apps/backend dev:sign-in \
    --api https://api-pr-<n>.hazel.sh --email you@example.com
```

It prints the session cookie's name and value, and never the secret.

- In a browser, set the cookie on `api-pr-<n>.hazel.sh`, then open `https://app-pr-<n>.hazel.sh`.
- For RPC, `/sync` or curl, send the value as `Authorization: Bearer <value>`.

## Troubleshooting

- `SchemaError(Expected string at ["S3_BUCKET"])` while planning: the Infisical step loaded nothing.
  Check the `Load secrets from Infisical` step and that `preview` still holds the key.
- Infisical rejects the OIDC login: the job must run in the `pr-preview` environment, and
  `INFISICAL_IDENTITY_ID` must be set on it.
- `dev:sign-in` answers 404: `DEV_SIGNIN_SECRET` is not on the Worker, or yours does not match the
  one in `preview`.
