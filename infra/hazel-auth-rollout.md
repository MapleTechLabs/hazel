# Hazel sign-in rollout (replacing Clerk)

Hazel's own sign-in (`@hazel/auth/server`, on `@yielded/auth`): GitHub, Google and passkeys,
with sessions in Postgres. The backend serves it alongside Clerk and only turns it on when
`AUTH_GITHUB_CLIENT_ID` is set.

## Done in prd (2026-10-11)

- **Schema:** `packages/db/sql/2026-10-11-hazel-auth.sql` applied (the `auth_*` tables plus
  `users."authActive"` / `"securityRevision"`). It was applied by hand, not `drizzle-kit push`:
  prd has tables the Drizzle schema doesn't declare (e.g. `invitations`), and push would treat
  them as renames or drops. Check any future push against a schema-only copy of prd first.
- **Clerk accounts imported:** `apps/backend/src/scripts/migrate-to-hazel-auth/import-clerk-identities.ts --apply`
  linked 116 users' GitHub and Google accounts (83 Google, 33 GitHub), with no conflicts.
  It's safe to re-run; re-run it right before the cutover to pick up new Clerk sign-ups.
- **Secrets in Infisical `prod`:** `AUTH_BINDING_KEY`, `AUTH_TRANSACTION_KEY`,
  `AUTH_ACCESS_TOKEN_KID`, `AUTH_ACCESS_TOKEN_PRIVATE_JWK`.

## Who moves how (prd, 2026-10-11)

| Clerk users          | Count                                                               | On first sign-in                                         |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| GitHub/Google linked | 116 matched (128 in Clerk; 12 have no Hazel user)                   | Straight into their account                              |
| Email only           | 532 (517 never signed in via Clerk; 7 active in 90 days; 362 Gmail) | Matched by provider-verified email, via `/auth/continue` |

Active users in the last 90 days: 60, of whom 53 have GitHub/Google linked.

## Remaining

1. **OAuth apps.** Create these, then put the credentials in Infisical `prod`:
    - GitHub OAuth App: callback `https://api.hazel.sh/auth/github/callback`. Store as
      `AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET`.
    - Google OAuth client (web): redirect URI `https://api.hazel.sh/auth/google/callback`. Store
      as `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`.
    - Setting `AUTH_GITHUB_CLIENT_ID` turns the routes on at the next deploy. Do this only
      once the web app is ready.
2. **Web app (`apps/web-foldkit`).** Build these pages: sign-in (GitHub, Google, passkey),
   `/auth/register` (name form), `/auth/continue?provider=` (restarts sign-in), and passkey
   settings. Then switch the RPC client to cookie credentials, and the Electric and actors
   clients to `POST /auth/token`.
3. **Electric proxy and actors.** Verify the access token against
   `https://api.hazel.sh/.well-known/jwks.json` instead of Clerk.
4. **Preview stage.** Do one real GitHub and Google sign-in through Hyperdrive before prd.
5. **Organizations, invites and profile editing.** Move these off Clerk.
6. **Cutover.** Re-run the import, deploy with `AUTH_GITHUB_CLIENT_ID` set, then switch the web
   app. Keep Clerk read-only for 2–4 weeks, then remove it (middleware fallback, `ClerkSync`,
   webhooks, `CLERK_*`).
