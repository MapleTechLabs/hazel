import { Activity } from "effect/workflow"
import { and, Database, eq, inArray, isNull, ne, or, schema, sql } from "@hazel/db"
import { Cluster } from "@hazel/domain"
import type { ChannelMemberId, NotificationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Array, Effect, Option, Result } from "effect"

interface OrgMemberLookupRow {
	orgMemberId: OrganizationMemberId
	userId: UserId
}

interface InsertableNotificationRow {
	memberId: OrganizationMemberId
	targetedResourceId: string
	targetedResourceType: "channel"
	resourceId: string
	resourceType: "message"
	createdAt: Date
}

export const buildOrgMemberLookup = (rows: ReadonlyArray<OrgMemberLookupRow>) => {
	const byUserId = new Map<UserId, OrganizationMemberId>()
	for (const row of rows) {
		byUserId.set(row.userId, row.orgMemberId)
	}
	return byUserId
}

export const buildNotificationInsertRows = (
	members: ReadonlyArray<Cluster.ChannelMemberForNotification>,
	orgMemberByUserId: ReadonlyMap<UserId, OrganizationMemberId>,
	payload: Cluster.MessageNotificationWorkflowPayload,
) => {
	const values: InsertableNotificationRow[] = []
	const channelMemberByOrgMember = new Map<OrganizationMemberId, ChannelMemberId>()

	for (const member of members) {
		const orgMemberId = orgMemberByUserId.get(member.userId)
		if (!orgMemberId) {
			continue
		}

		values.push({
			memberId: orgMemberId,
			targetedResourceId: payload.channelId,
			targetedResourceType: "channel",
			resourceId: payload.messageId,
			resourceType: "message",
			createdAt: new Date(),
		})
		channelMemberByOrgMember.set(orgMemberId, member.id)
	}

	return { values, channelMemberByOrgMember }
}

export const MessageNotificationWorkflowLayer = Cluster.MessageNotificationWorkflow.toLayer(
	Effect.fn("workflow.MessageNotification")(function* (
		payload: Cluster.MessageNotificationWorkflowPayload,
		_executionId: string,
	) {
		yield* Effect.annotateCurrentSpan("workflow.message_id", payload.messageId)
		yield* Effect.annotateCurrentSpan("workflow.channel_id", payload.channelId)
		yield* Effect.annotateCurrentSpan("workflow.channel_type", payload.channelType)
		yield* Effect.annotateCurrentSpan("workflow.author_id", payload.authorId)

		yield* Effect.logDebug(
			`Starting MessageNotificationWorkflow for message ${payload.messageId} in channel ${payload.channelId} (type: ${payload.channelType})`,
		)

		// Parse mentions from content
		const mentions = Cluster.parseMentions(payload.content)

		// Determine if this is a DM/group chat or regular channel
		const isDmOrGroup = payload.channelType === "direct" || payload.channelType === "single"
		const shouldNotifyAll = isDmOrGroup || mentions.hasChannelMention || mentions.hasHereMention

		yield* Effect.annotateCurrentSpan("workflow.mode", isDmOrGroup ? "dm_group" : "regular")
		yield* Effect.annotateCurrentSpan("workflow.notify_all", shouldNotifyAll)

		yield* Effect.logDebug(
			`Notification mode: ${isDmOrGroup ? "DM/Group" : "Regular channel"}, notify all: ${shouldNotifyAll}`,
		)

		// Activity 1: Get notification targets based on channel type and mentions
		const membersResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "GetChannelMembers",
				success: Cluster.GetChannelMembersResult,
				error: Cluster.GetChannelMembersError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database

					if (shouldNotifyAll) {
						// DM/group or broadcast mention - notify all members (existing logic)
						yield* Effect.logDebug(
							`Querying all channel members for channel ${payload.channelId}`,
						)

						const channelMembers = yield* db
							.execute((client) =>
								client
									.select({
										id: schema.channelMembersTable.id,
										channelId: schema.channelMembersTable.channelId,
										userId: schema.channelMembersTable.userId,
										isMuted: schema.channelMembersTable.isMuted,
										notificationCount: schema.channelMembersTable.notificationCount,
									})
									.from(schema.channelMembersTable)
									.leftJoin(
										schema.userPresenceStatusTable,
										eq(
											schema.channelMembersTable.userId,
											schema.userPresenceStatusTable.userId,
										),
									)
									.where(
										and(
											eq(schema.channelMembersTable.channelId, payload.channelId),
											eq(schema.channelMembersTable.isMuted, false),
											ne(schema.channelMembersTable.userId, payload.authorId),
											isNull(schema.channelMembersTable.deletedAt),
											or(
												// No presence record - send notification
												isNull(schema.userPresenceStatusTable.userId),
												// Has presence record - check suppressNotifications and activeChannel/status
												and(
													eq(
														schema.userPresenceStatusTable.suppressNotifications,
														false,
													),
													or(
														isNull(
															schema.userPresenceStatusTable.activeChannelId,
														),
														ne(
															schema.userPresenceStatusTable.activeChannelId,
															payload.channelId,
														),
														ne(schema.userPresenceStatusTable.status, "online"),
													),
												),
											),
										),
									),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new Cluster.GetChannelMembersError({
												channelId: payload.channelId,
												message: "Failed to query channel members",
												cause: err,
											}),
										),
								}),
							)

						yield* Effect.annotateCurrentSpan("activity.members_count", channelMembers.length)

						yield* Effect.logDebug(
							`Found ${channelMembers.length} members to notify (all members mode)`,
						)

						return {
							members: channelMembers,
							totalCount: channelMembers.length,
						}
					}

					// Regular channel - only notify mentioned users and reply-to author
					yield* Effect.logDebug(
						`Smart notification mode: ${mentions.userMentions.length} user mentions, reply to: ${payload.replyToMessageId ?? "none"}`,
					)

					const usersToNotify: UserId[] = [...mentions.userMentions]

					// If this is a reply, get the original message author
					if (payload.replyToMessageId) {
						const replyToMessage = yield* db
							.execute((client) =>
								client
									.select({ authorId: schema.messagesTable.authorId })
									.from(schema.messagesTable)
									.where(eq(schema.messagesTable.id, payload.replyToMessageId!))
									.limit(1),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new Cluster.GetChannelMembersError({
												channelId: payload.channelId,
												message: "Failed to query reply-to message author",
												cause: err,
											}),
										),
								}),
							)

						const replyAuthor = Array.head(replyToMessage).pipe(
							Option.map((msg) => msg.authorId),
							Option.filter((authorId) => authorId !== payload.authorId),
						)
						if (Option.isSome(replyAuthor)) {
							yield* Effect.logDebug(
								`Adding reply-to author ${replyAuthor.value} to notification list`,
							)
							usersToNotify.push(replyAuthor.value)
						}
					}

					// Remove duplicates and the author
					const uniqueUsersToNotify = Array.dedupe(usersToNotify).filter(
						(userId) => userId !== payload.authorId,
					)

					yield* Effect.logDebug(`Unique users to notify: ${uniqueUsersToNotify.length}`)

					if (uniqueUsersToNotify.length === 0) {
						yield* Effect.logDebug("No users to notify in smart mode")
						return { members: [], totalCount: 0 }
					}

					// Query only the members who should be notified
					const channelMembers = yield* db
						.execute((client) =>
							client
								.select({
									id: schema.channelMembersTable.id,
									channelId: schema.channelMembersTable.channelId,
									userId: schema.channelMembersTable.userId,
									isMuted: schema.channelMembersTable.isMuted,
									notificationCount: schema.channelMembersTable.notificationCount,
								})
								.from(schema.channelMembersTable)
								.leftJoin(
									schema.userPresenceStatusTable,
									eq(
										schema.channelMembersTable.userId,
										schema.userPresenceStatusTable.userId,
									),
								)
								.where(
									and(
										eq(schema.channelMembersTable.channelId, payload.channelId),
										inArray(schema.channelMembersTable.userId, uniqueUsersToNotify),
										eq(schema.channelMembersTable.isMuted, false),
										isNull(schema.channelMembersTable.deletedAt),
										or(
											// No presence record - send notification
											isNull(schema.userPresenceStatusTable.userId),
											// Has presence record - check suppressNotifications and activeChannel/status
											and(
												eq(
													schema.userPresenceStatusTable.suppressNotifications,
													false,
												),
												or(
													isNull(schema.userPresenceStatusTable.activeChannelId),
													ne(
														schema.userPresenceStatusTable.activeChannelId,
														payload.channelId,
													),
													ne(schema.userPresenceStatusTable.status, "online"),
												),
											),
										),
									),
								),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.GetChannelMembersError({
											channelId: payload.channelId,
											message: "Failed to query channel members for mentions",
											cause: err,
										}),
									),
							}),
						)

					yield* Effect.annotateCurrentSpan("activity.members_count", channelMembers.length)

					yield* Effect.logDebug(`Found ${channelMembers.length} members to notify (smart mode)`)

					return {
						members: channelMembers,
						totalCount: channelMembers.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("GetChannelMembers activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		// If no members to notify, we're done
		if (membersResult.totalCount === 0) {
			yield* Effect.logDebug("No members to notify, workflow complete")
			return
		}

		// Activity 2: Create notifications for all members
		const notificationsResult = yield* Effect.gen(function* () {
			return yield* Activity.make({
				name: "CreateNotifications",
				success: Cluster.CreateNotificationsResult,
				error: Cluster.CreateNotificationError,
				execute: Effect.gen(function* () {
					const db = yield* Database.Database
					const startedAt = Date.now()
					yield* Effect.annotateCurrentSpan(
						"activity.candidate_count",
						membersResult.members.length,
					)
					yield* Effect.logDebug(
						`Creating notifications for ${membersResult.members.length} members`,
					)

					const userIds = membersResult.members.map(
						(member: Cluster.ChannelMemberForNotification) => member.userId,
					)
					const orgMembers = yield* db
						.execute((client) =>
							client
								.select({
									orgMemberId: schema.organizationMembersTable.id,
									userId: schema.organizationMembersTable.userId,
								})
								.from(schema.organizationMembersTable)
								.innerJoin(
									schema.channelsTable,
									eq(
										schema.channelsTable.organizationId,
										schema.organizationMembersTable.organizationId,
									),
								)
								.where(
									and(
										eq(schema.channelsTable.id, payload.channelId),
										inArray(schema.organizationMembersTable.userId, userIds),
										isNull(schema.organizationMembersTable.deletedAt),
									),
								),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.CreateNotificationError({
											messageId: payload.messageId,
											message: "Failed to query organization members",
											cause: err,
										}),
									),
							}),
						)

					const orgMemberLookup = buildOrgMemberLookup(orgMembers)
					const { values, channelMemberByOrgMember } = buildNotificationInsertRows(
						membersResult.members,
						orgMemberLookup,
						payload,
					)

					if (values.length === 0) {
						yield* Effect.logDebug("No valid organization members to notify")
						return { notificationIds: [], notifiedCount: 0 }
					}

					const insertedNotifications = yield* db
						.execute((client) =>
							client
								.insert(schema.notificationsTable)
								.values(values)
								.onConflictDoNothing()
								.returning({
									id: schema.notificationsTable.id,
									memberId: schema.notificationsTable.memberId,
								}),
						)
						.pipe(
							Effect.catchTags({
								DatabaseError: (err) =>
									Effect.fail(
										new Cluster.CreateNotificationError({
											messageId: payload.messageId,
											message: "Failed to insert notification batch",
											cause: err,
										}),
									),
							}),
						)

					const insertedChannelMemberIds = Array.filterMap(insertedNotifications, (row) => {
						const memberId = channelMemberByOrgMember.get(row.memberId)
						return memberId != null ? Result.succeed(memberId) : Result.failVoid
					})

					if (insertedChannelMemberIds.length > 0) {
						yield* db
							.execute((client) =>
								client
									.update(schema.channelMembersTable)
									.set({
										notificationCount: sql`${schema.channelMembersTable.notificationCount} + 1`,
									})
									.where(inArray(schema.channelMembersTable.id, insertedChannelMemberIds)),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new Cluster.CreateNotificationError({
												messageId: payload.messageId,
												message: "Failed to increment notification counts",
												cause: err,
											}),
										),
								}),
							)
					}

					const notificationIds = insertedNotifications.map((row) => row.id) as NotificationId[]
					yield* Effect.annotateCurrentSpan("activity.eligible_count", values.length)
					yield* Effect.annotateCurrentSpan("activity.inserted_count", insertedNotifications.length)
					yield* Effect.logDebug("Notification batch completed", {
						candidates: membersResult.members.length,
						eligible: values.length,
						inserted: insertedNotifications.length,
						durationMs: Date.now() - startedAt,
					})

					return {
						notificationIds,
						notifiedCount: notificationIds.length,
					}
				}),
			})
		}).pipe(
			Effect.tapError((err: { readonly _tag: string; readonly retryable?: boolean }) =>
				Effect.logError("CreateNotifications activity failed", {
					errorTag: err._tag,
					retryable: err.retryable,
				}),
			),
		)

		yield* Effect.annotateCurrentSpan("workflow.notified_count", notificationsResult.notifiedCount)
		yield* Effect.logDebug(
			`MessageNotificationWorkflow completed: ${notificationsResult.notifiedCount} notifications created`,
		)
	}),
)
