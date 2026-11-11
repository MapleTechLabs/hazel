/**
 * @module Native notification handling
 * @platform desktop
 * @description Send system-level notifications via Tauri notification plugin
 */

import type { Channel, Message, User } from "@hazel/domain/models"
import { getTauriNotification, type TauriNotificationApi } from "@hazel/desktop/bridge"
import { isTauri } from "./tauri"

let notificationApi: TauriNotificationApi | null = null
let permissionGrantedCache: boolean | null = null

const getNotificationApi = async (): Promise<TauriNotificationApi | null> => {
	if (!isTauri()) {
		return null
	}

	try {
		notificationApi ??= getTauriNotification() ?? null
		return notificationApi
	} catch (error) {
		console.error("[native-notifications] Failed to load notification API:", error)
		return null
	}
}

const getPermission = async (requestIfMissing: boolean): Promise<boolean> => {
	const notification = await getNotificationApi()
	if (!notification) {
		return false
	}

	if (permissionGrantedCache === true) {
		return true
	}

	const granted = await notification.isPermissionGranted()
	if (granted) {
		permissionGrantedCache = true
		return true
	}

	if (!requestIfMissing) {
		permissionGrantedCache = false
		return false
	}

	const permission = await notification.requestPermission()
	const wasGranted = permission === "granted"
	permissionGrantedCache = wasGranted
	return wasGranted
}

export type NativeNotificationReason =
	| "ok"
	| "permission_denied"
	| "api_unavailable"
	| "focused_window"
	| "error"

export interface NativeNotificationResult {
	status: "sent" | "suppressed" | "failed"
	reason: NativeNotificationReason
	error?: unknown
}

export async function initNativeNotifications(): Promise<boolean> {
	return getPermission(true)
}

/**
 * Send a test notification (bypasses focus check for testing)
 * @returns true if notification was sent, false if not available/permitted
 */
export async function testNativeNotification(): Promise<boolean> {
	const notification = await getNotificationApi()
	if (!notification) return false

	const granted = await getPermission(true)
	if (!granted) {
		return false
	}

	try {
		notification.sendNotification({
			title: "Jane Smith in #general",
			body: "Hey! This is what your notifications will look like.",
			largeBody:
				"Hey! This is what your notifications will look like. You can customize sounds and quiet hours in the settings above.",
		})
		return true
	} catch (error) {
		console.error("[native-notifications] Test notification failed:", error)
		return false
	}
}

/**
 * Options for rich native notifications
 */
export interface NativeNotificationOptions {
	/** Notification title - author name or "Author in #channel" */
	title: string
	/** Message preview (truncated) */
	body: string
	/** Longer preview for expanded view */
	largeBody?: string
	/** Channel ID for grouping notifications */
	group?: string
}

/**
 * Send a native notification with rich content
 */
export async function sendNativeNotification(
	options: NativeNotificationOptions,
): Promise<NativeNotificationResult> {
	if (typeof document !== "undefined" && document.hasFocus()) {
		return {
			status: "suppressed",
			reason: "focused_window",
		}
	}

	const notification = await getNotificationApi()
	if (!notification) {
		return {
			status: "suppressed",
			reason: "api_unavailable",
		}
	}

	const granted = await getPermission(false)
	if (!granted) {
		return {
			status: "suppressed",
			reason: "permission_denied",
		}
	}

	try {
		notification.sendNotification({
			title: options.title,
			body: options.body,
			largeBody: options.largeBody,
			group: options.group,
		})
		return {
			status: "sent",
			reason: "ok",
		}
	} catch (error) {
		console.error("[native-notifications] Failed to send notification:", error)
		return {
			status: "failed",
			reason: "error",
			error,
		}
	}
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength)}...`
}

/**
 * Get a plain text preview from message content, stripping markdown
 */
export function getMessagePreview(content: string | null | undefined, maxLength = 100): string {
	if (!content) return "Sent a message"

	const plainText = content.replace(/[*_`~#]/g, "").trim()

	return truncateText(plainText, maxLength)
}

/**
 * Format author display name
 */
export function formatAuthorName(user: User.Type | undefined): string {
	if (!user) return "Someone"
	return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Someone"
}

/**
 * Format notification title based on channel type
 * - DM/single: Just author name ("John Doe")
 * - Channel/thread: Author + channel ("John Doe in #general")
 */
export function formatNotificationTitle(
	author: User.Type | undefined,
	channel: Channel.Type | undefined,
): string {
	const authorName = formatAuthorName(author)

	if (!channel) return authorName

	if (channel.type === "direct" || channel.type === "single") {
		return authorName
	}

	return `${authorName} in #${channel.name}`
}

/**
 * Build complete notification content from message, author, and channel data
 */
export function buildNotificationContent(
	message: Message.Type | undefined,
	author: User.Type | undefined,
	channel: Channel.Type | undefined,
): NativeNotificationOptions {
	const title = formatNotificationTitle(author, channel)
	const body = getMessagePreview(message?.content)
	const largeBody = message?.content ? getMessagePreview(message.content, 300) : undefined

	return {
		title,
		body,
		largeBody,
		group: channel?.id,
	}
}
