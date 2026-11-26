// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shared `hazel` ChannelList as an island in the chat sidebar (G2, `docs/hazel-ui.md`), behind the
 * `hazel:island:channel-list` localStorage flag. Foldkit renders an empty container; this Mount runs
 * the component there on the web host, over the app's one ClientData, for the container's lifetime.
 */
import { Renderer } from "@effect/ui"
import {
	ChannelList,
	ChannelListMessage,
	channelListLayer,
} from "@hazel/shared-screens/channel-list/ChannelList"
import { withWebHost } from "@hazel/ui/web/mount"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Queue, Stream } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { clientData } from "~/db/client"
import "./styles"

export const CHANNEL_LIST_FLAG = "hazel:island:channel-list"

/** Read once at load: flipping the flag takes a reload, so the default sidebar never changes under it. */
export const isChannelListIslandEnabled: boolean = (() => {
	try {
		return globalThis.localStorage?.getItem(CHANNEL_LIST_FLAG) === "1"
	} catch {
		return false
	}
})()

/** The route the island shows, on its container: read at mount, then watched for changes. */
const ACTIVE_ATTRIBUTE = "data-island-active-channel"

const activeOf = (element: Element): ChannelId | null => {
	const value = element.getAttribute(ACTIVE_ATTRIBUTE)
	return value === null || value === "" ? null : ChannelId.make(value)
}

/**
 * A plain click on one of the island's links is the island's: its `press` asks for the navigation, so
 * the browser and Foldkit's link handler must skip it. Window capture runs before Effect UI's
 * document-capture delegation, whose flush swaps the selected row's link for a button mid-click.
 */
const claimLinkClicks = (element: Element) => {
	const window = element.ownerDocument.defaultView
	const onClick = (event: MouseEvent) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const link = event.target instanceof Element ? event.target.closest("a[data-hz-part=control]") : null
		if (link !== null && element.contains(link)) event.preventDefault()
	}
	window?.addEventListener("click", onClick, { capture: true })
	return () => window?.removeEventListener("click", onClick, { capture: true })
}

const mountIsland = (
	element: Element,
	args: { readonly organizationId: OrganizationId; readonly userId: UserId; readonly orgSlug: string },
	navigate: (channelId: ChannelId) => void,
) =>
	Effect.gen(function* () {
		let root: Renderer.Root<unknown, ChannelListMessage> | undefined
		const mounting = Renderer.mount(
			ChannelList,
			{ ...args, activeChannelId: activeOf(element) },
			element,
			{ head: false },
		).pipe(
			Effect.tap((mounted) => Effect.sync(() => (root = mounted))),
			Effect.provide(channelListLayer(clientData, navigate)),
		)
		// Before the host exists, so the click claim runs ahead of its listeners.
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const observer = new MutationObserver(() =>
					root?.send(ChannelListMessage.ChangedRoute({ activeChannelId: activeOf(element) })),
				)
				observer.observe(element, { attributes: true, attributeFilter: [ACTIVE_ATTRIBUTE] })
				const release = claimLinkClicks(element)
				return () => {
					observer.disconnect()
					release()
				}
			}),
			(cleanup) => Effect.sync(cleanup),
		)
		// Built in the Mount's scope: the element's removal closes it, which unmounts the tree.
		yield* Layer.build(withWebHost(mounting))
	})

/** Runs the island in `element` while the stream runs; emits each channel a press asks to open. */
export const channelListIsland = (
	element: Element,
	args: { readonly organizationId: OrganizationId; readonly userId: UserId; readonly orgSlug: string },
): Stream.Stream<ChannelId> =>
	Stream.callback<ChannelId>((queue) =>
		mountIsland(element, args, (channelId) => Queue.offerUnsafe(queue, channelId)).pipe(
			Effect.flatMap(() => Effect.never),
		),
	)

/** The island's container: keyed by org and user, so a switch mounts a fresh island. */
export const channelListIslandView = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly organizationId: OrganizationId
		readonly userId: UserId
		readonly activeChannelId: ChannelId | null
		/** The sidebar's `OnMount` running `channelListIsland` with these ids. */
		readonly onMount: Attribute<ParentMessage>
	},
): Html =>
	h.keyed("div")(`hazel-island:${options.organizationId}:${options.userId}`, [
		h.Attribute("data-island", "channel-list"),
		h.Attribute(ACTIVE_ATTRIBUTE, options.activeChannelId ?? ""),
		options.onMount,
	])
