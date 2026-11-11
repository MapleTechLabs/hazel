import type { NotificationSoundManager } from "~/lib/notification-sound-manager"
import type {
	NotificationDecision,
	NotificationEvent,
	NotificationSink,
	NotificationSinkResult,
} from "../types"

interface SoundSinkDependencies {
	notificationSoundManager: NotificationSoundManager
}

export class SoundNotificationSink implements NotificationSink {
	private deps: SoundSinkDependencies

	constructor(deps: SoundSinkDependencies) {
		this.deps = deps
	}

	async handle(event: NotificationEvent, decision: NotificationDecision): Promise<NotificationSinkResult> {
		if (!decision.playSound) {
			return {
				sink: "sound",
				status: "suppressed",
				reason: decision.reasons[0] ?? "focused_current_channel",
			}
		}

		const result = await this.deps.notificationSoundManager.playSound({ notificationId: event.id })
		return {
			sink: "sound",
			status: result.status,
			reason: result.reason,
			error: result.error,
		}
	}
}
