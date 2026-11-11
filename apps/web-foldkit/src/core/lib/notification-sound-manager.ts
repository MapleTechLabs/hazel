/**
 * @module Notification Sound Manager
 * @description Singleton class for notification sound playback with cooldown and dedupe.
 */

import { isTauri } from "./tauri"
import type { NotificationDeliveryReason, NotificationSinkStatus } from "./notifications/types"

export interface NotificationSoundConfig {
	soundFile: "notification01" | "notification03"
	volume: number
	cooldownMs: number
}

export interface NotificationSoundDependencies {
	getConfig: () => NotificationSoundConfig
}

export interface PlaySoundParams {
	notificationId: string
}

export interface NotificationSoundResult {
	status: NotificationSinkStatus
	reason: NotificationDeliveryReason
	error?: unknown
}

export class NotificationSoundManager {
	private audioElement: HTMLAudioElement | null = null
	private isPrimed = false
	private playedIds = new Set<string>()
	private lastPlayedAt = 0
	private dependencies: NotificationSoundDependencies | null = null
	private primeClickHandler: (() => void) | null = null

	private static readonly MAX_PLAYED_IDS = 1000

	constructor() {
		if (typeof window !== "undefined") {
			this.audioElement = new Audio()
			this.audioElement.volume = 0.5

			if (isTauri()) {
				this.isPrimed = true
			}
		}
	}

	setDependencies(deps: NotificationSoundDependencies): void {
		this.dependencies = deps
	}

	initPriming(): () => void {
		if (this.isPrimed || !this.audioElement) {
			return () => {}
		}

		const primeAudio = async () => {
			if (!this.audioElement || this.isPrimed) return

			try {
				const originalVolume = this.audioElement.volume
				this.audioElement.volume = 0
				this.audioElement.src = "/sounds/notification01.mp3"
				await this.audioElement.play()
				this.audioElement.pause()
				this.audioElement.volume = originalVolume
				this.isPrimed = true
			} catch (error) {
				console.warn("[notification-sound-manager] Audio not primed yet:", error)
			}
		}

		this.primeClickHandler = primeAudio
		document.addEventListener("click", primeAudio, { once: true })

		return () => {
			if (this.primeClickHandler) {
				document.removeEventListener("click", this.primeClickHandler)
				this.primeClickHandler = null
			}
		}
	}

	getIsPrimed(): boolean {
		return this.isPrimed
	}

	async playSound(params: PlaySoundParams): Promise<NotificationSoundResult> {
		if (!this.audioElement || !this.isPrimed || !this.dependencies) {
			return {
				status: "suppressed",
				reason: "not_ready",
			}
		}

		if (this.playedIds.has(params.notificationId)) {
			return {
				status: "suppressed",
				reason: "duplicate",
			}
		}

		const config = this.dependencies.getConfig()
		const now = Date.now()
		if (now - this.lastPlayedAt < config.cooldownMs) {
			return {
				status: "suppressed",
				reason: "cooldown",
			}
		}

		this.playedIds.add(params.notificationId)
		this.lastPlayedAt = now
		this.compactPlayedIds()

		try {
			this.audioElement.src = `/sounds/${config.soundFile}.mp3`
			this.audioElement.volume = config.volume
			this.audioElement.currentTime = 0
			await this.audioElement.play()
			return {
				status: "sent",
				reason: "ok",
			}
		} catch (error) {
			console.error("[notification-sound-manager] Failed to play notification sound:", error)
			this.playedIds.delete(params.notificationId)
			return {
				status: "failed",
				reason: "error",
				error,
			}
		}
	}

	async testSound(): Promise<NotificationSoundResult> {
		if (!this.audioElement || !this.dependencies) {
			return {
				status: "suppressed",
				reason: "not_ready",
			}
		}

		const config = this.dependencies.getConfig()

		try {
			this.audioElement.src = `/sounds/${config.soundFile}.mp3`
			this.audioElement.volume = config.volume
			this.audioElement.currentTime = 0
			await this.audioElement.play()
			return {
				status: "sent",
				reason: "ok",
			}
		} catch (error) {
			console.error("[notification-sound-manager] Failed to play test sound:", error)
			return {
				status: "failed",
				reason: "error",
				error,
			}
		}
	}

	dispose(): void {
		if (this.primeClickHandler) {
			document.removeEventListener("click", this.primeClickHandler)
			this.primeClickHandler = null
		}

		if (this.audioElement) {
			this.audioElement.pause()
			this.audioElement.src = ""
			this.audioElement = null
		}

		this.playedIds.clear()
	}

	private compactPlayedIds() {
		if (this.playedIds.size <= NotificationSoundManager.MAX_PLAYED_IDS) {
			return
		}
		const idsArray = Array.from(this.playedIds)
		const toRemove = idsArray.slice(0, Math.floor(NotificationSoundManager.MAX_PLAYED_IDS / 2))
		for (const id of toRemove) {
			this.playedIds.delete(id)
		}
	}
}

export const notificationSoundManager = new NotificationSoundManager()
