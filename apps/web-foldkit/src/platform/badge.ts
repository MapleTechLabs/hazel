/**
 * Discord's badges: the tab title reads `(3) Chat · Hazel` while mentions are unread and `• Chat ·
 * Hazel` while only channels are, the favicon gets a red dot for mentions, and the desktop app's
 * dock or taskbar icon shows the mention count.
 *
 * Mentions are the user's unread notifications in every organization (the `UserObject` streams
 * them all), so a mention elsewhere still shows. Unread channels are known only for the open
 * organization (its `OrgObject`), and muted ones never count; mentions in them still do.
 */
import { NotificationId } from "@hazel/schema"
import { Data, Effect, Schema } from "effect"
import { getTauriWindow, isTauri } from "./tauri"

export const Badge = Schema.Struct({
	mentionCount: Schema.Int,
	hasUnread: Schema.Boolean,
})
export type Badge = typeof Badge.Type

export const NO_BADGE: Badge = { mentionCount: 0, hasUnread: false }

export interface BadgeInputs {
	/** Every unread notification of the user, across organizations. */
	readonly unreadMentionIds: ReadonlyArray<NotificationId>
	/** Marked read here and not yet synced back: they no longer count. */
	readonly optimisticReadIds: ReadonlyArray<NotificationId>
	/** The open organization's unread channels; `isMuted` ones are already left out. */
	readonly unreadChannels: ReadonlyArray<{ readonly mutedUntilMs: number | null }>
	readonly nowMs: number
}

export const badgeOf = ({
	unreadMentionIds,
	optimisticReadIds,
	unreadChannels,
	nowMs,
}: BadgeInputs): Badge => {
	const optimistic = new Set(optimisticReadIds)
	const mentionCount = unreadMentionIds.filter((id) => !optimistic.has(id)).length
	const hasUnread = unreadChannels.some(
		({ mutedUntilMs }) => mutedUntilMs === null || mutedUntilMs <= nowMs,
	)
	return { mentionCount, hasUnread }
}

/** The document title with Discord's prefix: the mention count, else a dot for unread channels. */
export const badgedTitle = (title: string, badge: Badge): string =>
	badge.mentionCount > 0 ? `(${badge.mentionCount}) ${title}` : badge.hasUnread ? `• ${title}` : title

// FAVICON

const FAVICON_SIZE = 64
const DOT_RADIUS = 13
/** Discord's notification red. */
const DOT_COLOR = "#f23f43"

class FaviconError extends Data.TaggedError("FaviconError")<{ readonly cause: unknown }> {}

const iconLinks = (): ReadonlyArray<HTMLLinkElement> =>
	Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))

/** Each icon link's own href, read once before the first change. */
const originalHrefs = new WeakMap<HTMLLinkElement, string>()
/** The dotted image per original href, drawn once. */
const dottedHrefs = new Map<string, string>()

const loadImage = (href: string) =>
	Effect.callback<HTMLImageElement, FaviconError>((resume) => {
		const image = new Image()
		image.onload = () => resume(Effect.succeed(image))
		image.onerror = (cause) => resume(Effect.fail(new FaviconError({ cause })))
		image.src = href
	})

/** The icon, fitted into a square, with a red dot in its bottom-right corner, as a PNG data URL. */
const drawDotted = (href: string) =>
	Effect.gen(function* () {
		const cached = dottedHrefs.get(href)
		if (cached !== undefined) return cached
		const image = yield* loadImage(href)
		const canvas = document.createElement("canvas")
		canvas.width = FAVICON_SIZE
		canvas.height = FAVICON_SIZE
		const context = canvas.getContext("2d")
		if (context === null) return yield* new FaviconError({ cause: "no 2d context" })
		const scale = Math.min(FAVICON_SIZE / image.naturalWidth, FAVICON_SIZE / image.naturalHeight) || 1
		const width = image.naturalWidth * scale || FAVICON_SIZE
		const height = image.naturalHeight * scale || FAVICON_SIZE
		context.drawImage(image, (FAVICON_SIZE - width) / 2, (FAVICON_SIZE - height) / 2, width, height)
		context.beginPath()
		context.arc(FAVICON_SIZE - DOT_RADIUS, FAVICON_SIZE - DOT_RADIUS, DOT_RADIUS, 0, Math.PI * 2)
		context.fillStyle = DOT_COLOR
		context.fill()
		const dotted = canvas.toDataURL("image/png")
		dottedHrefs.set(href, dotted)
		return dotted
	})

/** The red dot on every icon link while mentions are unread, the original icon otherwise. */
const applyFavicon = (hasDot: boolean) =>
	Effect.forEach(
		iconLinks(),
		(link) => {
			const original = originalHrefs.get(link) ?? link.href
			originalHrefs.set(link, original)
			return (hasDot ? drawDotted(original) : Effect.succeed(original)).pipe(
				Effect.map((href) => {
					if (link.href !== href) link.href = href
				}),
			)
		},
		{ discard: true },
	).pipe(Effect.catchTag("FaviconError", () => Effect.void))

// DESKTOP

class BadgeCountError extends Data.TaggedError("BadgeCountError")<{ readonly cause: unknown }> {}

/** The dock (macOS) or taskbar (Linux) count; none at 0. Windows has no count and refuses it. */
const applyBadgeCount = (count: number) => {
	const api = getTauriWindow()
	if (api === undefined) return Effect.void
	return Effect.tryPromise({
		try: () => api.getCurrentWindow().setBadgeCount(count > 0 ? count : undefined),
		catch: (cause) => new BadgeCountError({ cause }),
	}).pipe(Effect.catchTag("BadgeCountError", () => Effect.void))
}

/**
 * Shows `badge` on the favicon and the desktop icon. The Tauri window has no tab, so its favicon
 * is left alone. The title is the view's (`badgedTitle`).
 */
export const applyBadge = (badge: Badge) =>
	Effect.suspend(() =>
		isTauri() ? applyBadgeCount(badge.mentionCount) : applyFavicon(badge.mentionCount > 0),
	)
