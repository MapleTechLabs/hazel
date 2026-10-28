import { ChannelRepo, ChannelSectionRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { ErrorUtils, withRemapDbErrors } from "@hazel/domain"
import {
	ChannelNotFoundError,
	ChannelSectionNotFoundError,
	ChannelSectionResponse,
	ChannelSectionRpcs,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { withAnnotatedScope } from "../../lib/policy-utils"
import { ChannelSectionPolicy } from "../../policies/channel-section-policy"
import { OrgResolver } from "../../services/org-resolver"

export const ChannelSectionRpcLive = ChannelSectionRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelSectionPolicy = yield* ChannelSectionPolicy
		const channelRepo = yield* ChannelRepo
		const channelSectionRepo = yield* ChannelSectionRepo
		const orgResolver = yield* OrgResolver

		return {
			"channelSection.create": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							// Calculate next order value if not provided or is 0
							let order = payload.order
							if (order === 0) {
								const maxOrderResult = yield* db.run(
									SQLite.from(schema.channelSectionsTable)
										.select(($) => ({
											maxOrder: SQLite.coalesce(SQLite.max($.order), SQLite.lit(-1)),
										}))
										.where(($) => [$.organizationId.eq(payload.organizationId)]),
								)

								order = (maxOrderResult[0]?.maxOrder ?? -1) + 1
							}

							// Use client-provided id for optimistic updates, or let DB generate one
							const insertData = id
								? { id, ...payload, order, deletedAt: null }
								: { ...payload, order, deletedAt: null }

							yield* channelSectionPolicy.canCreate(payload.organizationId)
							const createdSection = yield* channelSectionRepo
								.insert(insertData as typeof payload & { order: number; deletedAt: null })
								.pipe(Effect.map((res) => res[0]!))

							const txid = yield* generateTransactionId()

							return new ChannelSectionResponse({
								data: createdSection,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelSection", "create")),

			"channelSection.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelSectionPolicy.canUpdate(id)
							const updatedSection = yield* channelSectionRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new ChannelSectionResponse({
								data: updatedSection,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelSection", "update")),

			"channelSection.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelSectionPolicy.canDelete(id)
							// First, move all channels in this section back to default (sectionId = null)
							const section = yield* channelSectionRepo.findById(id)

							if (Option.isNone(section)) {
								return yield* Effect.fail(new ChannelSectionNotFoundError({ sectionId: id }))
							}

							// Update all channels in this section to have null sectionId
							yield* db.run(
								SQLite.update(schema.channelsTable)
									.set({ sectionId: null })
									.where(($) => [$.sectionId.eq(id)]),
							)

							// Delete the section
							yield* channelSectionRepo.deleteById(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChannelSection", "delete")),

			"channelSection.reorder": ({ organizationId, sectionIds }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelSectionPolicy.canReorder(organizationId)
							yield* db.run(
								SQLite.update(schema.channelSectionsTable)
									.set(($) => ({
										order: SQLite.caseWhen(
											sectionIds.map(
												(id, index) => [$.id.eq(id), SQLite.lit(index)] as const,
											),
											$.order,
										),
									}))
									.where(($) => [
										$.id.in_(...sectionIds),
										$.organizationId.eq(organizationId),
									]),
							)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChannelSection", "update")),

			"channelSection.moveChannel": ({ channelId, sectionId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							// Get channel first to know its organization
							const channel = yield* channelRepo.findById(channelId)
							if (Option.isNone(channel)) {
								return yield* Effect.fail(new ChannelNotFoundError({ channelId }))
							}

							// Validate target section exists and belongs to same org
							if (sectionId !== null) {
								const section = yield* channelSectionRepo.findById(sectionId)
								if (Option.isNone(section)) {
									return yield* Effect.fail(new ChannelSectionNotFoundError({ sectionId }))
								}
								if (section.value.organizationId !== channel.value.organizationId) {
									return yield* Effect.fail(new ChannelSectionNotFoundError({ sectionId }))
								}
							}

							if (sectionId !== null) {
								yield* channelSectionPolicy.canUpdate(sectionId)
							} else {
								yield* ErrorUtils.refailUnauthorized(
									"ChannelSection",
									"moveChannel",
								)(
									withAnnotatedScope((scope) =>
										orgResolver.requireAdminOrOwner(
											channel.value.organizationId,
											scope,
											"ChannelSection",
											"moveChannel",
										),
									),
								)
							}
							// Update the channel's sectionId
							yield* channelRepo.update({
								id: channelId,
								sectionId,
							})

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Channel", "update")),
		}
	}),
)
