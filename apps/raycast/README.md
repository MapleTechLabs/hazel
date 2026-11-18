# Hazel for Raycast

Search your organization's customers from Raycast: health, MRR, open risks and billing at a glance,
then jump to the customer's channel, their page in Hazel, or their record in Clerk, Stripe, Autumn or
Maple.

- **Search Customers**: the customer list, synced live from Hazel (`/sync/customers/:org`) and
  cached, so it opens instantly. Pick the organization in the dropdown. `↵` shows a customer's
  details (`customers.account.detail`); `⌘O` opens their channel, `⌘⇧O` their Hazel page,
  `⌘⌥C` / `⌘⌥S` / `⌘⌥A` / `⌘⌥M` their Clerk / Stripe / Autumn / Maple record.
- **Sync Customers**: refreshes every organization's list in the background every 10 minutes
  (enable it once in Raycast).

## Sign-in

The first command opens Hazel's consent page (OAuth with PKCE, the server Hazel's MCP clients use).
The extension registers itself with `POST /oauth/register` and asks for `customers:read` only:
the Customers read RPCs and the customers sync stream. It cannot read messages or change anything.
The grant shows under **My settings → Agents** in Hazel, where it can be revoked.

## Develop

```bash
cd apps/raycast
bun run dev        # ray develop: loads the extension into Raycast
bunx vitest run    # protocol tests
bunx tsc --noEmit
```

For a local or preview stage, set the extension's **API URL** and **App URL** preferences.
