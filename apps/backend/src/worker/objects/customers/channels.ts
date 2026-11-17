/**
 * Channels linked to customer accounts (`docs/customers/channels.md`), on the `CustomersObject`
 * side: the live links (`customer_channel_links`) and their projection to the `OrgObject`
 * (`org.setChannelCustomers`, a full snapshot of channel → account id and name).
 *
 * The snapshot is sent when it changes: after a link or unlink, after a rename by hand, and at
 * the end of every compute (which catches names set by a source, and accounts a source deleted).
 * Only live links of live accounts are projected.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { OrganizationId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { enqueueEffect } from "../effects/registry"
import { orgTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { type ChannelCustomerEntry, ChannelCustomerOrgEffects } from "../org/channel-customers"

/** The fingerprint of the last snapshot sent, and its version. */
const SENT_KEY = "channelCustomersSent"
const VERSION_KEY = "channelCustomersVersion"

/** Every live link of a live account, ordered by channel (a stable fingerprint). */
export const channelCustomerSnapshot = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.customerChannelLinksTable, "l")
			.innerJoin(schema.customerAccountsTable, "a", (l, a) =>
				SQLite.and(a.id.eq(l.accountId), a.deletedAt.isNull()),
			)
			.select(($) => ({ channelId: $.channelId, accountId: $.accountId, accountName: $.a.name }))
			.where(($) => [$.deletedAt.isNull()]),
	)
	return [...rows].sort((a, b) => (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0))
})

const fingerprint = (links: ReadonlyArray<ChannelCustomerEntry>) =>
	Effect.promise(() =>
		crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				JSON.stringify(links.map((link) => [link.channelId, link.accountId, link.accountName])),
			),
		),
	).pipe(
		Effect.map((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
		),
	)

/**
 * Send the org the current snapshot unless it is the one last sent. Joins the caller's
 * transaction (the outbox row commits with the change that caused it).
 */
export const publishChannelCustomers = Effect.fn("CustomersObject.publishChannelCustomers")(function* (
	organizationId: OrganizationId,
) {
	const links = yield* channelCustomerSnapshot
	const print = yield* fingerprint(links)
	const sent = yield* readObjectMeta(SENT_KEY).pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.getOrUndefined(sent) === print) return
	const last = Option.getOrElse(
		Option.map(
			yield* readObjectMeta(VERSION_KEY).pipe(Effect.mapError(Database.toDatabaseError)),
			Number,
		),
		() => 0,
	)
	// Past the last one and at least the clock, so it increases across restarts.
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* enqueueEffect(ChannelCustomerOrgEffects.setChannelCustomers, orgTarget(organizationId), {
		organizationId,
		links,
		version,
	})
	yield* writeObjectMeta(VERSION_KEY, String(version)).pipe(Effect.mapError(Database.toDatabaseError))
	yield* writeObjectMeta(SENT_KEY, print).pipe(Effect.mapError(Database.toDatabaseError))
})

/** After a compute: the object's own id is its organization's. In its own transaction. */
export const publishChannelCustomersAfterCompute = Effect.gen(function* () {
	const db = yield* Database.Database
	const self = yield* readObjectMeta("id").pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(self)) return
	const organizationId = self.value as OrganizationId
	yield* db.transaction(publishChannelCustomers(organizationId))
})
