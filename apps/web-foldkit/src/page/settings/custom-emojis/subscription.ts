import { type CustomEmojiId, OrganizationId } from "@hazel/schema"
import { eq, isNull } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { customEmojiCollection, userCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

interface EmojiRow {
	readonly id: CustomEmojiId
	readonly name: string
	readonly imageUrl: string
	readonly createdAt?: Date | null
	readonly creatorFirstName: string
	readonly creatorLastName: string
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	emojis: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<EmojiRow, Message>(
							// Same query as `routes/_app/$orgSlug/settings/custom-emojis.tsx`.
							(q) =>
								q
									.from({ emoji: customEmojiCollection })
									.where(({ emoji }) => eq(emoji.organizationId, organizationId))
									.where(({ emoji }) => isNull(emoji.deletedAt))
									.innerJoin({ creator: userCollection }, ({ emoji, creator }) =>
										eq(emoji.createdBy, creator.id),
									)
									.orderBy(({ emoji }) => emoji.createdAt, "desc")
									.select(({ emoji, creator }) => ({
										...emoji,
										creatorFirstName: creator.firstName,
										creatorLastName: creator.lastName,
									})),
							(rows) =>
								Message.UpdatedEmojis({
									emojis: rows.map((row) => ({
										id: row.id,
										name: row.name,
										imageUrl: row.imageUrl,
										createdAtMs: row.createdAt ? new Date(row.createdAt).getTime() : null,
										creatorFirstName: row.creatorFirstName,
										creatorLastName: row.creatorLastName,
									})),
								}),
						),
		},
	),
}))
