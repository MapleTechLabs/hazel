// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shared `hazel` Activity list as an island in the inbox (Mentions and All), behind the
 * `hazel:island:activity` localStorage flag. Foldkit renders an empty container; this Mount runs
 * the component there on the web host, over the app's one ClientData, for the container's lifetime.
 */
import { Renderer } from "@effect/ui"
import { Activity, ActivityMessage, activityLayer } from "@hazel/shared-screens/activity/Activity"
import { HazelRpc } from "@hazel/client-data"
import { withWebHost } from "@hazel/ui/web/mount"
import type { ChannelId, OrganizationMemberId } from "@hazel/schema"
import { Context, Effect, Layer, Queue, Stream } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { clientData } from "~/db/client"
import { HazelRpcLive } from "../rpc"
import "./styles"

export const ACTIVITY_FLAG = "hazel:island:activity"

/** Read once at load: flipping the flag takes a reload, so the default list never changes under it. */
export const isActivityIslandEnabled: boolean = (() => {
	try {
		return globalThis.localStorage?.getItem(ACTIVITY_FLAG) === "1"
	} catch {
		return false
	}
})()

export type ActivityIslandTab = "mentions" | "all"

/** The tab the island shows, on its container: read at mount, then watched for changes. */
const TAB_ATTRIBUTE = "data-island-tab"

const tabOf = (element: Element): ActivityIslandTab =>
	element.getAttribute(TAB_ATTRIBUTE) === "all" ? "all" : "mentions"

/** A plain click on one of the island's row links is the island's: its `press` asks for the navigation. */
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
	args: { readonly memberId: OrganizationMemberId; readonly orgSlug: string },
	navigate: (channelId: ChannelId) => void,
) =>
	Effect.gen(function* () {
		// Built in the Mount's scope: a provided Layer would close the client when this effect returns.
		const rpc = Context.get(yield* Layer.build(HazelRpcLive), HazelRpc)
		let root: Renderer.Root<unknown, ActivityMessage> | undefined
		const mounting = Renderer.mount(
			Activity,
			{ ...args, tab: tabOf(element), nowMs: Date.now(), titled: false },
			element,
			{ head: false },
		).pipe(
			Effect.tap((mounted) => Effect.sync(() => (root = mounted))),
			Effect.provide(activityLayer(clientData, rpc, navigate)),
		)
		// Before the host exists, so the click claim runs ahead of its listeners.
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const observer = new MutationObserver(() =>
					root?.send(ActivityMessage.ChangedTab({ tab: tabOf(element) })),
				)
				observer.observe(element, { attributes: true, attributeFilter: [TAB_ATTRIBUTE] })
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
export const activityIsland = (
	element: Element,
	args: { readonly memberId: OrganizationMemberId; readonly orgSlug: string },
): Stream.Stream<ChannelId> =>
	Stream.callback<ChannelId>((queue) =>
		mountIsland(element, args, (channelId) => Queue.offerUnsafe(queue, channelId)).pipe(
			Effect.flatMap(() => Effect.never),
		),
	)

/** The island's container: keyed by member, so a switch of org mounts a fresh island. */
export const activityIslandView = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly memberId: OrganizationMemberId
		readonly tab: ActivityIslandTab
		/** The inbox's `OnMount` running `activityIsland` with these ids. */
		readonly onMount: Attribute<ParentMessage>
	},
): Html =>
	h.keyed("div")(`hazel-island:activity:${options.memberId}`, [
		h.Attribute("data-island", "activity"),
		h.Attribute(TAB_ATTRIBUTE, options.tab),
		options.onMount,
	])
