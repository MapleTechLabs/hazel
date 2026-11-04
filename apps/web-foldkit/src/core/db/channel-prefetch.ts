/**
 * Opens a channel's sync when the user is about to open it: the pointer resting on a link to it,
 * or the press itself. Clicking then finds the snapshot in (or on its way) instead of paying the
 * stream open, a cold object's wake and the snapshot after the click.
 *
 * One delegated listener covers every link to a channel (sidebar, threads, mentions, search). The
 * lease is released at once: the hub keeps the source open for its grace period, which is what
 * the click reuses; a channel the user cannot read is just refused.
 */
import type { ChannelId } from "@hazel/schema"
import { routeOfPath } from "../../route"
import { messageCollection } from "./collections"

/** How long the pointer rests on a link before it counts as intent (a pass over the sidebar does not). */
const HOVER_INTENT_MS = 120
/** A channel prefetched this recently is still within the hub's grace period: not asked again. */
const REFRESH_AFTER_MS = 60_000

const prefetchedAt = new Map<ChannelId, number>()

const channelOfLink = (target: EventTarget | null): ChannelId | undefined => {
	if (!(target instanceof Element)) return undefined
	const link = target.closest("a[href]")
	if (link === null) return undefined
	const href = link.getAttribute("href")
	if (href === null || !href.startsWith("/")) return undefined
	const route = routeOfPath(href)
	return route._tag === "ChatChannel" ? route.channelId : undefined
}

export const prefetchChannel = (channelId: ChannelId) => {
	const now = Date.now()
	const last = prefetchedAt.get(channelId)
	if (last !== undefined && now - last < REFRESH_AFTER_MS) return
	prefetchedAt.set(channelId, now)
	messageCollection.utils.retainChannels([channelId]).release()
}

/** Installs the listeners on `root`; returns their removal. */
export const installChannelPrefetch = (root: Document | HTMLElement = document) => {
	let pending: { readonly channelId: ChannelId; readonly timer: ReturnType<typeof setTimeout> } | undefined
	const cancel = () => {
		if (pending !== undefined) clearTimeout(pending.timer)
		pending = undefined
	}
	const onOver = (event: Event) => {
		const channelId = channelOfLink(event.target)
		if (channelId === pending?.channelId) return
		cancel()
		if (channelId === undefined) return
		pending = {
			channelId,
			timer: setTimeout(() => {
				pending = undefined
				prefetchChannel(channelId)
			}, HOVER_INTENT_MS),
		}
	}
	// The press (or keyboard focus) is intent enough: no delay.
	const onPress = (event: Event) => {
		const channelId = channelOfLink(event.target)
		if (channelId !== undefined) prefetchChannel(channelId)
	}
	root.addEventListener("pointerover", onOver, { passive: true })
	root.addEventListener("pointerdown", onPress, { passive: true })
	root.addEventListener("focusin", onPress)
	return () => {
		cancel()
		root.removeEventListener("pointerover", onOver)
		root.removeEventListener("pointerdown", onPress)
		root.removeEventListener("focusin", onPress)
	}
}
