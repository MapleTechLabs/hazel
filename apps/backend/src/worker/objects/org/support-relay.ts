/**
 * The `OrgObject` side of support issues (`docs/customers/issues.md`) beyond what the author-side
 * relay sends (`customers.chatMessage`, `./customer-chat.ts`, which opens and moves issues): a root
 * message deleted in a channel linked to a customer goes on to the org's `CustomersObject` as
 * `customers.supportMessageDeleted`. Called from `org.messageDeleted` once the local channel is known.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, MessageId, OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { CustomersEffects } from "../effects/customers-effects"
import { enqueueEffect } from "../effects/registry"
import { customersTarget } from "../kinds"

export const relaySupportMessageDeleted = Effect.fn("OrgObject.relaySupportMessageDeleted")(function* (input: {
	readonly organizationId: OrganizationId
	readonly channel: { readonly id: ChannelId; readonly parentChannelId: ChannelId | null }
	readonly messageId: MessageId
}) {
	// A reply's delete changes no issue: only a root's does.
	if (input.channel.parentChannelId !== null) return
	const db = yield* Database.Database
	const linked = yield* db.first(
		SQLite.from(schema.channelCustomersTable)
			.select("channelId")
			.where(($) => [$.channelId.eq(input.channel.id)])
			.limit(1),
	)
	if (Option.isNone(linked)) return
	yield* enqueueEffect(
		CustomersEffects.supportMessageDeleted,
		customersTarget(input.organizationId),
		{ organizationId: input.organizationId, channelId: input.channel.id, messageId: input.messageId },
		{ id: `support-deleted:${input.messageId}` },
	)
})
