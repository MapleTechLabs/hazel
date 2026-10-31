/**
 * Message notifications, inside the channel's `OrgObject`: loads what decides each member's
 * notification (their level and mute, presence and settings), runs the rules
 * (`./notification-rules.ts`), bumps each recipient's `notificationCount` and sends the
 * notification row to their `UserObject` (`user.createNotification`) through the outbox.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Array, Clock, Context, Effect, Layer } from "effect"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { MessageNotificationEffects } from "../../worker/objects/user/message-notifications"
import {
	decide,
	defaultLevel,
	type MessageActivity,
	type NotificationReason,
	type Recipient,
	type RecipientSettings,
} from "./notification-rules"

export interface NotificationRecipient {
	readonly channelMemberId: schema.ChannelMember["id"]
	readonly userId: UserId
	readonly memberId: OrganizationMemberId
	readonly reason: NotificationReason
	readonly silent: boolean
}

/** Durable Object SQLite binds at most 100 parameters per statement. */
const UPDATE_BATCH = 90
const TARGET_FILTER_MAX = 80

const settingsOf = (settings: Record<string, unknown> | null): RecipientSettings | null =>
	settings === null
		? null
		: {
				doNotDisturb: settings.doNotDisturb === true,
				quietHoursStart:
					typeof settings.quietHoursStart === "string" ? settings.quietHoursStart : undefined,
				quietHoursEnd:
					typeof settings.quietHoursEnd === "string" ? settings.quietHoursEnd : undefined,
			}

export class NotificationService extends Context.Service<NotificationService>()(
	"@hazel/backend/NotificationService",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database

			/** The members `activity` notifies in `organizationId`, with why and whether silently. */
			const recipients = Effect.fn("NotificationService.recipients")(function* (
				organizationId: OrganizationId,
				activity: MessageActivity,
			) {
				// Members on the default `mentions` level only hear about a plain message by opting in.
				const targets = Array.dedupe([
					...activity.mentionedUserIds,
					...(activity.replyToAuthorId === null ? [] : [activity.replyToAuthorId]),
				])
				// Past `TARGET_FILTER_MAX` targets, load every member (the rules sort them out) rather than
				// bind more parameters than Durable Object SQLite allows.
				const everyone =
					activity.notifyAll ||
					defaultLevel(activity.channelType) === "all" ||
					targets.length > TARGET_FILTER_MAX
				const members = yield* db.run(
					SQLite.from(schema.channelMembersTable, "cm")
						.innerJoin(schema.organizationMembersTable, "om", (cm, om) =>
							SQLite.and(
								om.organizationId.eq(organizationId),
								om.userId.eq(cm.userId),
								om.deletedAt.isNull(),
							),
						)
						.leftJoin(schema.userPresenceStatusTable, "presence", (cm, presence) =>
							presence.userId.eq(cm.userId),
						)
						.leftJoin(schema.usersTable, "u", (cm, u) => u.id.eq(cm.userId))
						// A thread's members' settings in its parent channel (unused elsewhere).
						.leftJoin(schema.channelMembersTable, "parent", (cm, parent) =>
							SQLite.and(
								parent.channelId.eq(activity.parentChannelId ?? activity.channelId),
								parent.userId.eq(cm.userId),
								parent.deletedAt.isNull(),
							),
						)
						.select(($) => ({
							channelMemberId: $.id,
							userId: $.userId,
							memberId: $.om.id,
							level: $.notificationLevel,
							isMuted: $.isMuted,
							mutedUntil: $.mutedUntil,
							presenceStatus: $.presence.status,
							activeChannelId: $.presence.activeChannelId,
							suppressNotifications: $.presence.suppressNotifications,
							settings: $.u.settings,
							timezone: $.u.timezone,
							parentId: $.parent.id,
							parentLevel: $.parent.notificationLevel,
							parentIsMuted: $.parent.isMuted,
							parentMutedUntil: $.parent.mutedUntil,
						}))
						.where(($) => [
							$.channelId.eq(activity.channelId),
							$.userId.neq(activity.authorId),
							$.deletedAt.isNull(),
							...(everyone
								? []
								: [
										SQLite.or(
											$.notificationLevel.eq("all"),
											...(targets.length === 0 ? [] : [$.userId.in_(...targets)]),
										),
									]),
						]),
				)
				const nowMs = yield* Clock.currentTimeMillis

				// One recipient per member row, even if the parent join matched several.
				const result = Array.dedupeWith(
					members,
					(a, b) => a.channelMemberId === b.channelMemberId,
				).flatMap((member): ReadonlyArray<NotificationRecipient> => {
					const recipient: Recipient = {
						userId: member.userId,
						level: member.level,
						isMuted: member.isMuted,
						mutedUntil: member.mutedUntil,
						parent:
							member.parentId === null
								? null
								: {
										level: member.parentLevel,
										isMuted: member.parentIsMuted === true,
										mutedUntil: member.parentMutedUntil,
									},
						presence:
							member.presenceStatus === null
								? null
								: {
										status: member.presenceStatus,
										activeChannelId: member.activeChannelId,
										suppressNotifications: member.suppressNotifications === true,
									},
						settings: settingsOf(member.settings),
						timezone: member.timezone,
					}
					const decision = decide(activity, recipient, nowMs)
					return decision._tag === "Skip"
						? []
						: [
								{
									channelMemberId: member.channelMemberId,
									userId: member.userId,
									memberId: member.memberId,
									reason: decision.reason,
									silent: decision.silent,
								},
							]
				})
				yield* Effect.annotateCurrentSpan({
					"notification.candidates": members.length,
					"notification.recipients": result.length,
				})
				return result
			})

			/** Notify the recipients of `activity`: badge counts here, rows in their `UserObject`s. */
			const notify = Effect.fn("NotificationService.notify")(function* (
				organizationId: OrganizationId,
				activity: MessageActivity & { readonly messageId: schema.Message["id"] },
			) {
				const notified = yield* recipients(organizationId, activity)
				if (notified.length === 0) return notified
				yield* Effect.forEach(
					Array.chunksOf(
						notified.map((recipient) => recipient.channelMemberId),
						UPDATE_BATCH,
					),
					(ids) =>
						db.run(
							SQLite.update(schema.channelMembersTable)
								.set(($) => ({ notificationCount: $.notificationCount.add(1) }))
								.where(($) => [$.id.in_(...ids)]),
						),
					{ discard: true },
				)
				yield* Effect.forEach(
					notified,
					(recipient) =>
						enqueueEffect(
							MessageNotificationEffects.createNotification,
							{ kind: "user", id: recipient.userId },
							{
								memberId: recipient.memberId,
								channelId: activity.channelId,
								messageId: activity.messageId,
								reason: recipient.reason,
								silent: recipient.silent,
							},
							{ id: `notify:${activity.messageId}:${recipient.userId}` },
						),
					{ discard: true },
				)
				return notified
			})

			return { recipients, notify }
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
