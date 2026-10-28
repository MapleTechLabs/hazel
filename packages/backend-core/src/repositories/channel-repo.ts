import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { OrganizationId } from "@hazel/schema"
import { Channel } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ChannelRepo extends Context.Service<ChannelRepo>()("ChannelRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.channelsTable,
			{ insert: Channel.Insert, update: Channel.Update },
			{
				idColumn: "id",
				name: "Channel",
			},
		)
		const db = yield* Database.Database

		const findByOrgAndName = (organizationId: OrganizationId, name: string) =>
			db.first(
				SQLite.from(schema.channelsTable)
					.select()
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.name.eq(name),
						$.deletedAt.isNull(),
					])
					.limit(1),
			)

		return {
			...baseRepo,
			findByOrgAndName,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
