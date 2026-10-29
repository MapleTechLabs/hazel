import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { IntegrationConnectionId, IntegrationTokenId } from "@hazel/schema"
import { IntegrationToken } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class IntegrationTokenRepo extends Context.Service<IntegrationTokenRepo>()("IntegrationTokenRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.integrationTokensTable,
			{ insert: IntegrationToken.Insert, update: IntegrationToken.Update },
			{
				idColumn: "id",
				name: "IntegrationToken",
			},
		)
		const db = yield* Database.Database

		// Find token by connection ID
		const findByConnectionId = (connectionId: IntegrationConnectionId) =>
			db.first(
				SQLite.from(schema.integrationTokensTable)
					.select()
					.where(($) => [$.connectionId.eq(connectionId)])
					.limit(1),
			)

		// Update token (for refresh)
		const updateToken = (
			tokenId: IntegrationTokenId,
			data: {
				encryptedAccessToken: string
				encryptedRefreshToken?: string | null
				iv: string
				refreshTokenIv?: string | null
				encryptionKeyVersion: number
				expiresAt?: Date | null
				scope?: string | null
			},
		) =>
			db.run(
				SQLite.update(schema.integrationTokensTable)
					.set({
						encryptedAccessToken: data.encryptedAccessToken,
						encryptedRefreshToken: data.encryptedRefreshToken,
						iv: data.iv,
						refreshTokenIv: data.refreshTokenIv,
						encryptionKeyVersion: data.encryptionKeyVersion,
						expiresAt: data.expiresAt,
						scope: data.scope,
						lastRefreshedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(tokenId)])
					.returning(),
			)

		// Delete token (hard delete for security)
		const deleteByConnectionId = (connectionId: IntegrationConnectionId) =>
			db.run(
				SQLite.deleteFrom(schema.integrationTokensTable).where(($) => [
					$.connectionId.eq(connectionId),
				]),
			)

		return {
			...baseRepo,
			findByConnectionId,
			updateToken,
			deleteByConnectionId,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
