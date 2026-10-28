import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { UserId } from "@hazel/schema"
import { User } from "@hazel/domain/models"
import { Context, DateTime, Effect, Layer, type Schema } from "effect"

/** Timestamp columns take a `Date`; domain models carry `Date | DateTime.Utc`. */
const toNullableDate = (value: Date | DateTime.Utc | null): Date | null =>
	value === null ? null : DateTime.isDateTime(value) ? DateTime.toDate(value) : value

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

		/**
		 * Upsert user by external ID.
		 * @param options.syncAvatarUrl - If true, sync avatarUrl from the identity
		 *   provider; if false (default), preserve local avatarUrl (managed via R2 uploads).
		 */
		const upsertByExternalId = (
			data: Schema.Schema.Type<typeof User.Insert>,
			options?: { syncAvatarUrl?: boolean },
		) =>
			db
				.run(
					SQLite.insertInto(schema.usersTable)
						.values({
							externalId: data.externalId,
							email: data.email,
							firstName: data.firstName,
							lastName: data.lastName,
							avatarUrl: data.avatarUrl,
							userType: data.userType,
							settings: data.settings,
							isOnboarded: data.isOnboarded,
							timezone: data.timezone,
							deletedAt: toNullableDate(data.deletedAt),
						})
						.onConflictDoUpdate({
							target: ["externalId"],
							set: {
								firstName: data.firstName,
								lastName: data.lastName,
								...(options?.syncAvatarUrl && { avatarUrl: data.avatarUrl }),
								email: data.email,
								updatedAt: new Date(),
							},
						})
						.returning(),
				)
				.pipe(Effect.map((results) => results[0]))

		const findAllActive = () =>
			db.run(
				SQLite.from(schema.usersTable)
					.select()
					.where(($) => [$.deletedAt.isNull()]),
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
			upsertByExternalId,
			findAllActive,
			softDelete,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
