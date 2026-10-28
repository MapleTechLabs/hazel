import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { ChannelMember } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ChannelMemberRepo extends Context.Service<ChannelMemberRepo>()("ChannelMemberRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.channelMembersTable,
			{ insert: ChannelMember.Insert, update: ChannelMember.Update },
			{
				idColumn: "id",
				name: "ChannelMember",
			},
		)
		const db = yield* Database.Database

		// Extended method to find channel member by channel and user
		const findByChannelAndUser = (channelId: ChannelId, userId: UserId) =>
			db.first(
				SQLite.from(schema.channelMembersTable)
					.select()
					.where(($) => [$.channelId.eq(channelId), $.userId.eq(userId), $.deletedAt.isNull()])
					.limit(1),
			)

		// Find existing single DM channel between two users
		const findExistingSingleDmChannel = (
			userId1: UserId,
			userId2: UserId,
			organizationId: OrganizationId,
		) =>
			db.first(
				SQLite.from(schema.channelsTable)
					.innerJoin(schema.channelMembersTable, "cm", (channel, cm) => cm.channelId.eq(channel.id))
					.select(($) => ({
						id: $.id,
						name: $.name,
						icon: $.icon,
						type: $.type,
						organizationId: $.organizationId,
						parentChannelId: $.parentChannelId,
						sectionId: $.sectionId,
						createdAt: $.createdAt,
						updatedAt: $.updatedAt,
						deletedAt: $.deletedAt,
					}))
					.distinct()
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.type.eq("single"),
						$.deletedAt.isNull(),
						$.cm.deletedAt.isNull(),
						// Channel must have both users as members
						$.cm.userId.in_(userId1, userId2),
					])
					// Group by every selected channel column: `id` is the primary key, so the groups are
					// one per channel exactly as grouping by `id` alone was.
					.groupBy(
						"id",
						"name",
						"icon",
						"type",
						"organizationId",
						"parentChannelId",
						"sectionId",
						"createdAt",
						"updatedAt",
						"deletedAt",
					)
					// Ensure the channel has exactly 2 members and they are our users
					.having(($) => [
						SQLite.countDistinct($.cm.userId).eq(2),
						SQLite.sql
							.cond`COUNT(DISTINCT ${$.cm.userId}) FILTER (WHERE ${$.cm.userId} IN (${userId1}, ${userId2})) = 2`,
					])
					.limit(1),
			)

		const listByChannel = (channelId: ChannelId) =>
			db.run(
				SQLite.from(schema.channelMembersTable)
					.select()
					.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()]),
			)

		return {
			...baseRepo,
			findByChannelAndUser,
			findExistingSingleDmChannel,
			listByChannel,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
