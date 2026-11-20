/**
 * `user.createCustomerNotification`: a support SLA warning or breach for the `UserObject`'s owner,
 * from the org's `CustomersObject` (`docs/customers/sla.md` §4). The inbox row points at the issue's
 * thread (`targetedResourceType` `channel`) and names the issue (`resourceType` `customer_issue`);
 * it is pushed like a message notification.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, CustomerIssueId, OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineEffect, type EffectSender } from "../effects/registry"
import { PushContent, schedulePush } from "./push"

export const CustomerNotificationReason = Schema.Literals(["sla_warning", "sla_breach"])
export type CustomerNotificationReason = typeof CustomerNotificationReason.Type

export const CreateCustomerNotificationPayload = Schema.Struct({
	organizationId: OrganizationId,
	/** The owner's `organization_members` id in that org. */
	memberId: OrganizationMemberId,
	issueId: CustomerIssueId,
	/** The issue's thread, else the channel its root message is in. */
	channelId: ChannelId,
	reason: CustomerNotificationReason,
	push: PushContent,
})
export type CreateCustomerNotificationPayload = typeof CreateCustomerNotificationPayload.Type

export const CustomerNotificationEffects = {
	createCustomerNotification: defineEffect(
		"user.createCustomerNotification",
		"user",
		CreateCustomerNotificationPayload,
	),
}

/** Only the org's own customers object notifies about its issues. */
export const customerNotificationSenderRefusal = (
	kind: string,
	payload: unknown,
	sender: EffectSender,
): Option.Option<string> => {
	if (kind !== CustomerNotificationEffects.createCustomerNotification.name) return Option.none()
	const organizationId = (payload as { readonly organizationId?: unknown }).organizationId
	return sender.kind === "customers" && "id" in sender && sender.id === organizationId
		? Option.none()
		: Option.some(`${kind} sent by ${sender.kind}`)
}

export const createCustomerNotification = Effect.fn("UserEffects.createCustomerNotification")(function* (
	payload: CreateCustomerNotificationPayload,
) {
	const db = yield* Database.Database
	const [created] = yield* db.run(
		SQLite.insertInto(schema.notificationsTable)
			.values({
				memberId: payload.memberId,
				targetedResourceId: payload.channelId,
				targetedResourceType: "channel",
				resourceId: payload.issueId,
				resourceType: "customer_issue",
				reason: payload.reason,
			})
			.returning("id"),
	)
	if (created === undefined) return
	yield* schedulePush({
		notificationId: created.id,
		channelId: payload.channelId,
		silent: false,
		content: payload.push,
	})
})

export const customerNotificationReceivers = {
	"user.createCustomerNotification": createCustomerNotification,
}
