/**
 * Wakes the Durable Objects this load is about to open (`POST /sync/warm`), so a cold one starts
 * while the app is still booting instead of when its socket arrives. A browser's first call comes
 * from `index.html`, before this script has loaded; the desktop and native apps have no such page
 * script, so theirs is made here.
 */
import type { ChannelId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { sessionAuthorizationEffect } from "~/lib/session-bearer"
import { rememberedOrganizationIds } from "./sync-manager"

/** As many of each as the route takes (`apps/backend/src/worker/sync-route.ts`). */
const MAX_OF_EACH = 8

declare global {
	/** `index.html` already asked for this load's objects. */
	var __hazelEarlyWarm: boolean | undefined
}

const backendUrl = () => import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

export const warmUrl = (
	organizationIds: ReadonlyArray<string>,
	channelIds: ReadonlyArray<string>,
	base: string = backendUrl(),
): string => {
	const query = new URLSearchParams()
	for (const id of organizationIds.slice(0, MAX_OF_EACH)) query.append("org", id)
	for (const id of channelIds.slice(0, MAX_OF_EACH)) query.append("channel", id)
	const search = query.toString()
	return `${base}/sync/warm${search === "" ? "" : `?${search}`}`
}

/**
 * The remembered user's organizations and the route's channel. Nothing depends on the answer: a
 * failure only means the sockets wake the objects themselves.
 */
export const warmSyncObjects = (userId: UserId | null, channelId: ChannelId | null): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (globalThis.__hazelEarlyWarm === true) return
		const authorization = yield* sessionAuthorizationEffect
		yield* Effect.tryPromise(() =>
			fetch(
				warmUrl(
					userId === null ? [] : rememberedOrganizationIds(userId),
					channelId === null ? [] : [channelId],
				),
				{
					method: "POST",
					// The desktop app's session is a bearer; a browser's is the API's cookie.
					...(authorization === null
						? { credentials: "include" as const }
						: { credentials: "omit" as const, headers: { authorization } }),
				},
			),
		)
	}).pipe(Effect.ignore)
