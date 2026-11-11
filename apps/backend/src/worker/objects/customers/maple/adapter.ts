/**
 * The Maple data source (`docs/customers/tech-design.md` §5), the **usage source**: Maple's product
 * events become the daily activity behind active users, usage trends and the `usage_drop`,
 * `inactive`, `onboarding_stalled` and `champion_inactive` signals, plus a per-account daily count
 * of each event a person maps to a metric.
 *
 * It is a custom integration, not a product one: the identity it reads is Hazel's own
 * (`GroupId` = the Clerk organization id, `UserId` = the Clerk user id), which is how Maple's
 * events are stamped (`maple/docs/product-events-catalog.md`). It creates no account and no
 * contact: a group Clerk does not hold waits in the unmatched list.
 *
 * Connecting needs a Maple **API key** (`maple_ak_…`, the MCP key under Settings → MCP is the
 * narrowest one that works) and the key's **region**: Maple runs one instance per region and a key
 * of one is refused by the other. The key is stored encrypted (`../credentials.ts`) and only ever
 * decrypted to call Maple. There are no webhooks — Maple sends none for product events — so the
 * schedule is the whole signal, hourly.
 *
 * Nothing here writes the store: `pull` produces `IngestOp`s and `CustomerIngest` applies them.
 *
 * Only the connection's organization: `validate` reads the organization the key opens out of the
 * one thing that names it (`$__orgFilter` expands to `OrgId = '…'`), and every query is scoped by
 * that same filter server-side, so a pull can only ever read the key's own organization. A key of
 * another organization than the connection's changes `externalAccountId`: core drops Maple's
 * metrics and parked records and imports from scratch, but not the activity, which sits on Clerk's
 * contacts (`docs/customers/maple.md`, "Known gaps").
 */
import type { ConnectionConfig, MapleRegion } from "@hazel/domain/customers"
import { Effect, Option, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError, CustomerWebhookRejectedError } from "../provider-errors"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { makeMapleApi } from "./http"
import { ACCOUNT_COLUMN, CONTACT_COLUMN, MAPLE_PULL_INTERVAL_MS, pullPage } from "./pull"
import { MapleProbeRow, orgIdOf } from "./wire"

export { MAPLE_PULL_INTERVAL_MS }

const KEY_PREFIX = "maple_ak_"

/** Why a connection cannot be read: it holds no Maple config, or never finished validating. */
const UNCONFIGURED = "The Maple connection has no Maple settings; reconnect it"
const UNVALIDATED = "The Maple connection has no validated account; reconnect it"
const REGION_CHANGED = "The region was changed since the key was checked; reconnect with a key of it"

/** The provider account: the organization *and* its region, since a key opens exactly one of each. */
export const accountIdOf = (organizationId: string, region: MapleRegion): string =>
	`${organizationId}:${region}`

/** The region half of the connection's account id, from what `validate` stored. */
export const regionOfAccountId = (externalAccountId: string | null): MapleRegion | null => {
	if (externalAccountId === null) return null
	if (externalAccountId.endsWith(":us")) return "us"
	return externalAccountId.endsWith(":eu") ? "eu" : null
}

const WHERE_TO_FIND = "Maple → Settings → MCP, or Settings → Keys"

const refused = (message: string) =>
	new CustomerProviderError({ code: "auth", message, httpStatus: null, retryAfterMs: null })

/** The connection's config, when it is Maple's. */
const mapleConfig = (config: ConnectionConfig) =>
	config._tag === "maple" ? Option.some(config) : Option.none()

/** A day far in the past: the probe proves the key's access, not the data behind it. */
const PROBE_WINDOW = { start: "2019-01-01 00:00:00", end: "2019-01-02 00:00:00" }

const PROBE_SQL = `
SELECT count() AS rows
FROM product_events
WHERE $__orgFilter
  AND Timestamp >= $__startTime AND Timestamp < $__endTime`

/**
 * Connecting proves the key can read `product_events` — the one table this integration reads — and
 * names the organization it opens, both from a single counting query over a day far in the past:
 * it matches nothing, so it costs Maple almost nothing, and `show_sql` brings back the statement
 * with `$__orgFilter` expanded, which is the only place the key's organization is named.
 *
 * A configured Maple organization id is checked against it rather than trusted: a key of another
 * organization would otherwise import that organization's usage under this one's name. The
 * identity columns are checked here too, so a config naming something Maple does not key identity
 * on says so at connect time instead of reading nothing for a day.
 */
const validateWith = Effect.fn("Maple.validate")(function* (
	credentials: ProviderCredentials,
	client: HttpClient.HttpClient,
) {
	const config = mapleConfig(credentials.config)
	if (Option.isNone(config)) return yield* refused(UNCONFIGURED)
	const { accountKey, userKey, mapleOrgId, region } = config.value
	if (accountKey.trim() !== "" && accountKey.trim() !== ACCOUNT_COLUMN) {
		return yield* refused(
			`Maple stamps the account on its events as "${ACCOUNT_COLUMN}"; leave the account key at that`,
		)
	}
	if (userKey.trim() !== "" && userKey.trim() !== CONTACT_COLUMN) {
		return yield* refused(
			`Maple stamps the user on its events as "${CONTACT_COLUMN}"; leave the user key at that`,
		)
	}
	if (!Redacted.value(credentials.apiKey).startsWith(KEY_PREFIX)) {
		return yield* refused(`"${KEY_PREFIX}…" is what a Maple API key looks like (${WHERE_TO_FIND})`)
	}
	const api = makeMapleApi(client, credentials.apiKey, region)
	const probe = yield* api.runSql({
		step: "connect",
		sql: PROBE_SQL,
		window: PROBE_WINDOW,
		row: MapleProbeRow,
		showSql: true,
	})
	const organizationId = probe.expandedSql === undefined ? null : orgIdOf(probe.expandedSql)
	if (organizationId === null) {
		return yield* refused("Maple did not say which organization the key opens; reconnect it")
	}
	const configured = mapleOrgId.trim()
	if (configured !== "" && configured !== organizationId) {
		// The ids go to the log only: the message is synced to every member of the organization.
		yield* Effect.logWarning("Maple key opens another organization", {
			opens: organizationId,
			configured,
		})
		return yield* refused("The key opens another Maple organization than the one this source is set to")
	}
	yield* Effect.annotateCurrentSpan({ "maple.organization_id": organizationId, "maple.region": region })
	return {
		externalAccountId: accountIdOf(organizationId, region),
		externalAccountName: `Maple (${region.toUpperCase()})`,
	}
})

export const makeMapleAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient

	const adapter: CustomerProviderAdapter = {
		provider: "maple",
		validate: (credentials) => validateWith(credentials, client),

		// Maple sends no webhook for a product event, so core never registers one for it and the
		// connect form offers no secret; a delivery reaching here is a misrouted endpoint.
		webhook: () =>
			Effect.fail(new CustomerWebhookRejectedError({ message: "Maple sends Hazel no webhooks" })),

		pull: (input) =>
			Option.match(mapleConfig(input.credentials.config), {
				onNone: () => Effect.fail(refused(UNCONFIGURED)),
				onSome: (config) => {
					const validated = regionOfAccountId(input.credentials.externalAccountId)
					if (validated === null) return Effect.fail(refused(UNVALIDATED))
					// A config-only update does not re-validate, so the region could have been changed
					// under a key of the other one: reading that region would answer 401 for no stated
					// reason.
					if (validated !== config.region) return Effect.fail(refused(REGION_CHANGED))
					return pullPage({
						api: makeMapleApi(client, input.credentials.apiKey, config.region),
						config,
						cursor: input.cursor,
						since: input.since,
					})
				},
			}),

		pullIntervalMs: MAPLE_PULL_INTERVAL_MS,
	}
	return adapter
})
