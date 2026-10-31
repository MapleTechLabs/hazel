import { toEpochMs } from "~/lib/utils"
import type {
	NotificationDecision,
	NotificationDecisionContext,
	NotificationEvent,
	NotificationProcessingRecord,
	NotificationSink,
} from "./types"

export interface NotificationOrchestratorDependencies {
	getContext: () => NotificationDecisionContext
	soundSink: NotificationSink
	nativeSink: NotificationSink
}

const MAX_PROCESSED_IDS = 2000

export class NotificationOrchestrator {
	private deps: NotificationOrchestratorDependencies | null = null
	private processedIds = new Set<string>()
	private queue: NotificationEvent[] = []
	private processing = false

	setDependencies(deps: NotificationOrchestratorDependencies) {
		this.deps = deps
	}

	enqueue(events: NotificationEvent[]) {
		if (!events.length) return

		for (const event of events) {
			if (this.processedIds.has(event.id)) {
				continue
			}
			this.queue.push(event)
		}

		this.queue.sort((a, b) => {
			const aTime = toEpochMs(a.notification.createdAt)
			const bTime = toEpochMs(b.notification.createdAt)
			if (aTime !== bTime) return aTime - bTime
			return a.id.localeCompare(b.id)
		})

		this.processQueue().catch((error) => {
			console.error("[notification-orchestrator] Failed to process queue:", error)
		})
	}

	private async processQueue() {
		const deps = this.deps
		if (!deps || this.processing) return
		this.processing = true

		try {
			while (this.queue.length > 0) {
				const event = this.queue.shift()
				if (!event || this.processedIds.has(event.id)) {
					continue
				}

				const record = await this.processEvent(deps, event)

				const hasFailures = record.results.some((result) => result.status === "failed")
				if (!hasFailures) {
					this.processedIds.add(event.id)
					this.compactProcessedIds()
				} else {
					// Failed events may be retried on the next collection update.
					this.processedIds.delete(event.id)
				}
			}
		} finally {
			this.processing = false
		}
	}

	private async processEvent(
		deps: NotificationOrchestratorDependencies,
		event: NotificationEvent,
	): Promise<NotificationProcessingRecord> {
		const startedAt = Date.now()
		const decision = this.makeDecision(event, deps.getContext())

		const results = await Promise.all([
			deps.soundSink.handle(event, decision),
			deps.nativeSink.handle(event, decision),
		])

		const finishedAt = Date.now()
		return {
			eventId: event.id,
			notificationId: event.notification.id,
			startedAt,
			finishedAt,
			durationMs: finishedAt - startedAt,
			decision,
			results,
		}
	}

	private makeDecision(event: NotificationEvent, ctx: NotificationDecisionContext): NotificationDecision {
		const reasons = new Set<NotificationDecision["reasons"][number]>()

		const isOldNotification = event.notification.createdAt < ctx.sessionStartTime
		if (isOldNotification) {
			reasons.add("before_session_start")
		}

		if (ctx.isMuted) {
			reasons.add("muted")
		}

		// The server's call: do not disturb, paused notifications or quiet hours.
		const isSilent = event.notification.silent
		if (isSilent) {
			reasons.add("silent")
		}

		const isFocusedAndVisible = ctx.isWindowFocused && ctx.visibilityState === "visible"
		const isCurrentChannel =
			ctx.currentChannelId !== null && event.notification.targetedResourceId === ctx.currentChannelId

		if (isFocusedAndVisible && isCurrentChannel) {
			reasons.add("focused_current_channel")
		}

		if (isFocusedAndVisible) {
			reasons.add("focused_window")
		}

		const playSound =
			!isOldNotification && !isSilent && !ctx.isMuted && !(isFocusedAndVisible && isCurrentChannel)
		const sendNative = !isOldNotification && !isSilent && !isFocusedAndVisible

		if (!reasons.size) {
			reasons.add("ok")
		}

		return {
			eventId: event.id,
			playSound,
			sendNative,
			reasons: [...reasons],
		}
	}

	private compactProcessedIds() {
		if (this.processedIds.size <= MAX_PROCESSED_IDS) {
			return
		}

		const ids = Array.from(this.processedIds)
		const keep = ids.slice(Math.floor(MAX_PROCESSED_IDS / 2))
		this.processedIds = new Set(keep)
	}
}

export const notificationOrchestrator = new NotificationOrchestrator()
