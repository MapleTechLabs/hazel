// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shared `hazel` DMs screen as an island on the phone's DMs tab (`ChatDms`), behind the
 * `hazel:island:dms` localStorage flag. Foldkit renders an empty container; this Mount runs the
 * screen there on the web host, over the app's one ClientData, for the container's lifetime.
 */
import { Renderer } from "@effect/ui"
import { Dms, dmsLayer } from "@hazel/shared-screens/dms/Dms"
import { withWebHost } from "@hazel/ui/web/mount"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Queue, Stream } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { clientData } from "~/db/client"
import "./styles"

export const DMS_FLAG = "hazel:island:dms"

/** Read once at load: flipping the flag takes a reload, so today's page never changes under it. */
export const isDmsIslandEnabled: boolean = (() => {
	try {
		return globalThis.localStorage?.getItem(DMS_FLAG) === "1"
	} catch {
		return false
	}
})()

/** What a press in the island asks the page for. */
export type DmsIslandRequest =
	| { readonly _tag: "Open"; readonly channelId: ChannelId }
	| { readonly _tag: "Compose" }

/**
 * A plain click on one of the island's row links is the island's: its `press` asks for the
 * navigation, so the browser and Foldkit's link handler must skip it (as `channel-list.ts`).
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

interface Args {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly orgSlug: string
}

/** Runs the island in `element` while the stream runs; emits each request a press makes. */
export const dmsIsland = (element: Element, args: Args): Stream.Stream<DmsIslandRequest> =>
	Stream.callback<DmsIslandRequest>((queue) =>
		Effect.gen(function* () {
			const mounting = Renderer.mount(Dms, { ...args, nowMs: Date.now() }, element, {
				head: false,
			}).pipe(
				Effect.provide(
					dmsLayer(
						clientData,
						(channelId) => Queue.offerUnsafe(queue, { _tag: "Open", channelId }),
						() => Queue.offerUnsafe(queue, { _tag: "Compose" }),
					),
				),
			)
			// Before the host exists, so the click claim runs ahead of its listeners.
			yield* Effect.acquireRelease(
				Effect.sync(() => claimLinkClicks(element)),
				(release) => Effect.sync(release),
			)
			// Built in the Mount's scope: the element's removal closes it, which unmounts the tree.
			yield* Layer.build(withWebHost(mounting))
		}).pipe(Effect.flatMap(() => Effect.never)),
	)

/** The island's container: keyed by org and user, so a switch mounts a fresh island. */
export const dmsIslandView = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	options: {
		readonly organizationId: OrganizationId
		readonly userId: UserId
		/** The page's `OnMount` running `dmsIsland` with these ids. */
		readonly onMount: Attribute<ParentMessage>
	},
): Html =>
	h.keyed("div")(`hazel-island-dms:${options.organizationId}:${options.userId}`, [
		h.Attribute("data-island", "dms"),
		options.onMount,
	])
