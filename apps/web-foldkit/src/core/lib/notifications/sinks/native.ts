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

		const content = buildNotificationContent(event.message, event.author, event.channel)
		const result = await sendNativeNotification(content)
		return toSinkStatus(result)
	}
}
