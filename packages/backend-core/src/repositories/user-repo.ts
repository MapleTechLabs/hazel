import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { UserId } from "@hazel/schema"
import { User } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class UserRepo extends Context.Service<UserRepo>()("UserRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.usersTable,
			{ insert: User.Insert, update: User.Update },
			{
				idColumn: "id",
				name: "User",
			},
		)
		const db = yield* Database.Database

		const findByExternalId = (externalId: string) =>
			db.first(
				SQLite.from(schema.usersTable)
					.select()
					.where(($) => [$.externalId.eq(externalId)])
					.limit(1),
			)

		const softDelete = (id: UserId) =>
			db.run(
				SQLite.update(schema.usersTable)
					.set({ deletedAt: new Date() })
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
			)

		return {
			...baseRepo,
			findByExternalId,
			softDelete,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
