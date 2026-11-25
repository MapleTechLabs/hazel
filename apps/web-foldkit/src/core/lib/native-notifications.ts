/**
 * @module Native notification handling
 * @platform desktop
 * @description Send system-level notifications via Tauri notification plugin
 */

import type { Channel, Message, User } from "@hazel/domain/models"
import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { openAppPath } from "../../platform/app-path"
import { AppRoute, chatMessageHref, hrefOf } from "../../route"
import { getTauriNotification, type TauriNotificationApi } from "../../platform/tauri"

/**
 * A message's notification offers Mark as read (`MESSAGE_ACTION_TYPE`); a click on it opens the
 * message, and the Tauri host brings the window to the front (`apps/desktop/src-tauri/src/lib.rs`).
 * Both come back through the plugin's `onAction` (`listenForActions`).
 */
export const MESSAGE_ACTION_TYPE = "hazel-message"
export const MARK_READ_ACTION = "mark-read"

let notificationApi: TauriNotificationApi | null = null
let permissionGrantedCache: boolean | null = null

const getNotificationApi = async (): Promise<TauriNotificationApi | null> => {
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

/** What a message's notification carries for its click and its actions (in the plugin's `extra`). */
export const NotificationTarget = Schema.Struct({
	channelId: ChannelId,
	/** The app path the click opens: the channel, at the message. */
	path: Schema.optional(Schema.String),
})
export type NotificationTarget = typeof NotificationTarget.Type

/** The plugin's `actionPerformed` event, as far as it is read here. */
const PerformedAction = Schema.Struct({
	actionId: Schema.String,
	notification: Schema.NullOr(
		Schema.Struct({
			extra: Schema.optional(Schema.Struct({ hazel: Schema.optional(NotificationTarget) })),
		}),
	),
})

export type NotificationAction =
	| { readonly _tag: "Open"; readonly path: string }
	| { readonly _tag: "MarkRead"; readonly channelId: ChannelId }

/** What a performed action asks for; `null` for another app's or an unknown one. Pure. */
export const notificationActionOf = (event: unknown): NotificationAction | null => {
	const decoded = Schema.decodeUnknownOption(PerformedAction)(event)
	if (decoded._tag === "None") return null
	const target = decoded.value.notification?.extra?.hazel
	if (target === undefined) return null
	if (decoded.value.actionId === "tap")
		return target.path === undefined ? null : { _tag: "Open", path: target.path }
	if (decoded.value.actionId === MARK_READ_ACTION) return { _tag: "MarkRead", channelId: target.channelId }
	return null
}

/** `channelMember.clearNotifications`, as the channel page does on reading it; best effort. */
const markChannelRead = async (channelId: ChannelId) => {
	const { HazelRpc, HazelRpcLive } = await import("../../rpc")
	await Effect.runPromise(
		HazelRpc.use((rpc) => rpc("channelMember.clearNotifications", { channelId })).pipe(
			Effect.provide(HazelRpcLive),
			Effect.catchCause((cause) =>
				Effect.logWarning("[native-notifications] mark as read failed", cause),
			),
		),
	)
}

/**
 * Listens for clicks and actions, then registers the message action type. Each on its own: a
 * platform that refuses the action type still opens a clicked notification. True when the
 * listener is in place.
 */
export const registerActions = async (
	notification: Pick<TauriNotificationApi, "onAction" | "registerActionTypes">,
): Promise<boolean> => {
	try {
		await notification.onAction((event) => {
			const action = notificationActionOf(event)
			if (action === null) return
			if (action._tag === "Open") openAppPath(action.path)
			else void markChannelRead(action.channelId)
		})
	} catch (error) {
		console.error("[native-notifications] notification clicks unavailable:", error)
		return false
	}
	try {
		await notification.registerActionTypes([
			{ id: MESSAGE_ACTION_TYPE, actions: [{ id: MARK_READ_ACTION, title: "Mark as read" }] },
		])
	} catch (error) {
		console.error("[native-notifications] Mark as read action unavailable:", error)
	}
	return true
}

let listening = false

/** `registerActions`, once; a listener that failed to attach is tried again on the next call. */
const listenForActions = async (notification: TauriNotificationApi) => {
	if (listening) return
	listening = true
	listening = await registerActions(notification)
}

export async function initNativeNotifications(): Promise<boolean> {
	const granted = await getPermission(true)
	const notification = await getNotificationApi()
	if (notification) await listenForActions(notification)
	return granted
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
	/** The author's profile picture (a web URL), shown with the notification */
	image?: string
	/** Who sent the message: the native app shows it as from them */
	sender?: { id: string; name: string }
	/** The channel's name, for a message in a channel (not a direct message) */
	conversation?: string
	/** The message: a click opens it, and it offers Mark as read */
	target?: NotificationTarget
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
			// Tauri's attachments and extra: the native app's host shows the sender and their picture.
			attachments: options.image ? [{ id: "avatar", url: options.image }] : undefined,
			actionTypeId: options.target === undefined ? undefined : MESSAGE_ACTION_TYPE,
			extra:
				options.sender === undefined && options.target === undefined
					? undefined
					: { sender: options.sender, conversation: options.conversation, hazel: options.target },
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
 * Build complete notification content from message, author, and channel data. With the channel's
 * org slug, a click opens the message (`target.path`).
 */
export function buildNotificationContent(
	message: Message.Type | undefined,
	author: User.Type | undefined,
	channel: Channel.Type | undefined,
	orgSlug?: string | null,
): NativeNotificationOptions {
	const title = formatNotificationTitle(author, channel)
	const direct = channel?.type === "direct" || channel?.type === "single"
	const body = getMessagePreview(message?.content)
	const largeBody = message?.content ? getMessagePreview(message.content, 300) : undefined

	return {
		title,
		body,
		largeBody,
		group: channel?.id,
		image: author?.avatarUrl ?? undefined,
		sender: author ? { id: author.id, name: formatAuthorName(author) } : undefined,
		conversation: channel && !direct ? channel.name : undefined,
		target:
			channel === undefined
				? undefined
				: {
						channelId: channel.id,
						path:
							orgSlug === null || orgSlug === undefined || orgSlug === ""
								? undefined
								: message === undefined
									? hrefOf(AppRoute.ChatChannel({ orgSlug, channelId: channel.id }))
									: chatMessageHref(orgSlug, channel.id, message.id),
					},
	}
}
