/**
 * Channels linked to customers, on the `OrgObject` side (`docs/customers/channels.md`). The link
 * itself lives in the org's `CustomersObject` (`customer_channel_links`); the org holds:
 *
 * - `org.customerChannel` (call): before linking, the customers object asks whether the channel
 *   exists here, can be linked (a public or private channel, not a thread or a DM) and is visible
 *   to the person linking it (`channel_access`).
 * - `org.setChannelCustomers` (effect): the customers object's full, versioned snapshot of its
 *   links (channel → account id and name), replacing `channel_customers`. Chat reads it to show a
 *   channel's customer to the org's members who see the channel (never to Connect guests).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { defineCall } from "../calls"
import { inList } from "../customers/sql"
import { CustomersEffects } from "../effects/customers-effects"
import { defineEffect, enqueueEffect, type EffectReceivers, type EffectSender } from "../effects/registry"
import { customersTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"

// ---------------------------------------------------------------------------
// Link check
// ---------------------------------------------------------------------------

export const CustomerChannelCheck = Schema.Literals(["ok", "not_found", "not_linkable"])
export type CustomerChannelCheck = typeof CustomerChannelCheck.Type

export const CustomerChannelCall = defineCall("org.customerChannel", "org", {
	payload: Schema.Struct({ organizationId: OrganizationId, channelId: ChannelId, userId: UserId }),
	success: CustomerChannelCheck,
	error: Schema.Never,
})

/** Channel types a customer can be linked to: conversations, not threads or direct messages. */
const LINKABLE_TYPES: ReadonlySet<string> = new Set(["public", "private"])

/**
 * `not_found` for a channel that is not this org's, is deleted, or the user cannot see (one
 * answer, so the check does not reveal private channels).
 */
export const customerChannel = Effect.fn("OrgObject.customerChannel")(function* (payload: {
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
	readonly userId: UserId
}) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type")
			.where(($) => [
				$.id.eq(payload.channelId),
				$.organizationId.eq(payload.organizationId),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isNone(channel)) return "not_found" as const
	const access = yield* db.first(
		SQLite.from(schema.channelAccessTable)
			.select("channelId")
			.where(($) => [$.channelId.eq(payload.channelId), $.userId.eq(payload.userId)])
			.limit(1),
	)
	if (Option.isNone(access)) return "not_found" as const
	return LINKABLE_TYPES.has(channel.value.type) ? ("ok" as const) : ("not_linkable" as const)
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export const ChannelCustomerEntry = Schema.Struct({
	channelId: ChannelId,
	accountId: CustomerAccountId,
	accountName: Schema.String,
})
export type ChannelCustomerEntry = typeof ChannelCustomerEntry.Type

/** Every live link: a full snapshot, so a missed one is repaired by the next. */
export const SetChannelCustomersPayload = Schema.Struct({
	organizationId: OrganizationId,
	links: Schema.Array(ChannelCustomerEntry),
	/** Increases with every snapshot (out-of-order deliveries drop the older one). */
	version: Schema.Number,
})
export type SetChannelCustomersPayload = typeof SetChannelCustomersPayload.Type

export const ChannelCustomerOrgEffects = {
	setChannelCustomers: defineEffect("org.setChannelCustomers", "org", SetChannelCustomersPayload),
}

const VERSION_KEY = "channelCustomersVersion"

/** Replace `channel_customers` with the snapshot, writing only what changed. */
const applyChannelCustomers = Effect.fn("OrgObject.applyChannelCustomers")(function* (
	payload: SetChannelCustomersPayload,
) {
	const applied = Option.map(yield* readObjectMeta(VERSION_KEY), Number)
	if (Option.isSome(applied) && payload.version < applied.value) return
	yield* writeObjectMeta(VERSION_KEY, String(payload.version))

	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const current = yield* db.run(SQLite.from(schema.channelCustomersTable).select())
	const next = new Map(payload.links.map((link) => [link.channelId, link]))
	const gone = current.filter((row) => !next.has(row.channelId)).map((row) => row.channelId)
	if (gone.length > 0) {
		yield* db.run(
			SQLite.deleteFrom(schema.channelCustomersTable).where(($) => [inList($.channelId, gone)]),
		)
	}
	const held = new Map(current.map((row) => [row.channelId, row]))
	for (const link of payload.links) {
		const row = held.get(link.channelId)
		if (row !== undefined && row.accountId === link.accountId && row.accountName === link.accountName) {
			continue
		}
		const values = {
			organizationId: payload.organizationId,
			accountId: link.accountId,
			accountName: link.accountName,
			updatedAt: now,
		}
		yield* db.run(
			SQLite.insertInto(schema.channelCustomersTable)
				.values({ channelId: link.channelId, ...values })
				.onConflictDoUpdate({ target: ["channelId"], set: values }),
		)
	}
})

export const channelCustomerOrgReceivers = {
	"org.setChannelCustomers": applyChannelCustomers,
} satisfies EffectReceivers<typeof ChannelCustomerOrgEffects, Database.Database | SqlClient>

/** Only the org's own `CustomersObject` (DO name = organization id) sends its links, here only. */
export const channelCustomersSenderRefusal = (kind: string, payload: unknown, sender: EffectSender) =>
	Effect.gen(function* () {
		if (kind !== ChannelCustomerOrgEffects.setChannelCustomers.name) return Option.none<string>()
		const { organizationId } = payload as SetChannelCustomersPayload
		const self = yield* readObjectMeta("id").pipe(Effect.orDie)
		return sender.kind === "customers" &&
			sender.id === organizationId &&
			Option.getOrUndefined(self) === organizationId
			? Option.none<string>()
			: Option.some(`${kind} for org ${organizationId} from ${sender.kind}`)
	})

/**
 * A deleted channel with a customer: its `CustomersObject` drops the link (and sends a new
 * snapshot). Inside the delete's transaction; nothing to send for a channel without a customer.
 */
export const forgetChannelCustomer = Effect.fn("OrgObject.forgetChannelCustomer")(function* (
	organizationId: OrganizationId,
	channelId: ChannelId,
) {
	const db = yield* Database.Database
	const linked = yield* db.first(
		SQLite.from(schema.channelCustomersTable)
			.select("channelId")
			.where(($) => [$.channelId.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(linked)) return
	yield* enqueueEffect(CustomersEffects.channelDeleted, customersTarget(organizationId), {
		organizationId,
		channelId,
	})
})
