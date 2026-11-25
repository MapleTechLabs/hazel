import { organizationCollection } from "~/db/collections"
import {
	buildNotificationContent,
	type NativeNotificationResult,
	sendNativeNotification,
} from "~/lib/native-notifications"
import type {
	NotificationDecision,
	NotificationEvent,
	NotificationSink,
	NotificationSinkResult,
} from "../types"

const toSinkStatus = (result: NativeNotificationResult): NotificationSinkResult => ({
	sink: "native",
	status: result.status,
	reason: result.reason,
	error: result.error,
})

export class NativeNotificationSink implements NotificationSink {
	async handle(event: NotificationEvent, decision: NotificationDecision): Promise<NotificationSinkResult> {
		if (!decision.sendNative) {
			return {
				sink: "native",
				status: "suppressed",
				reason: decision.reasons[0] ?? "focused_window",
			}
		}

		const orgSlug =
			event.channel === undefined
				? undefined
				: organizationCollection.state.get(event.channel.organizationId)?.slug
		const content = buildNotificationContent(event.message, event.author, event.channel, orgSlug)
		const result = await sendNativeNotification(content)
		return toSinkStatus(result)
	}
}
