// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shared `hazel` ChannelSidebar as an island in the chat sidebar (Phase 3, `docs/hazel-ui.md`),
 * behind the `hazel:island:channel-list` localStorage flag. Foldkit renders an empty container and
 * keeps the org switcher and account card; this Mount runs the screen there on the web host, over
 * the app's one ClientData, and hands every navigation and menu choice back to the Foldkit sidebar.
 */
import { Renderer } from "@effect/ui"
import {
	ChannelSidebar,
	channelSidebarLayer,
	type NavTarget,
	type SidebarAction,
	SidebarMessage,
} from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { withWebHost } from "@hazel/ui/web/mount"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Queue, Stream } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { clientData } from "~/db/client"
import { hotkeyLabel } from "../shell/channels-sidebar/hotkey-label"
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

/** What the island asks of the Foldkit sidebar: a route, or a menu choice by today's keys. */
export type IslandIntent =
	| { readonly _tag: "Navigate"; readonly to: NavTarget }
	| { readonly _tag: "Act"; readonly action: SidebarAction }

/** The route the island shows, on its container: read at mount, then watched for changes. */
const ACTIVE_ATTRIBUTE = "data-island-active-channel"
const MEMBERS_ATTRIBUTE = "data-island-members"

const activeOf = (element: Element): ChannelId | null => {
	const value = element.getAttribute(ACTIVE_ATTRIBUTE)
	return value === null || value === "" ? null : ChannelId.make(value)
}
const membersOf = (element: Element) => element.getAttribute(MEMBERS_ATTRIBUTE) === "true"

export interface IslandArgs {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly orgSlug: string
	readonly hintDismissed: boolean
	readonly paletteKey: string | null
}

const mountIsland = (element: Element, args: IslandArgs, emit: (intent: IslandIntent) => void) =>
	Effect.gen(function* () {
		let root: Renderer.Root<unknown, SidebarMessage> | undefined
		const mounting = Renderer.mount(
			ChannelSidebar,
			{
				...args,
				paletteKey: args.paletteKey === null ? null : hotkeyLabel(args.paletteKey),
				activeChannelId: activeOf(element),
				membersActive: membersOf(element),
				chrome: false,
			},
			element,
			{ head: false },
		).pipe(
			Effect.tap((mounted) => Effect.sync(() => (root = mounted))),
			Effect.provide(
				channelSidebarLayer(
					clientData,
					(to) => emit({ _tag: "Navigate", to }),
					(action) => Effect.sync(() => emit({ _tag: "Act", action })),
				),
			),
		)
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const observer = new MutationObserver(() =>
					root?.send(
						SidebarMessage.ChangedRoute({
							activeChannelId: activeOf(element),
							membersActive: membersOf(element),
						}),
					),
				)
				observer.observe(element, {
					attributes: true,
					attributeFilter: [ACTIVE_ATTRIBUTE, MEMBERS_ATTRIBUTE],
				})
				return () => observer.disconnect()
			}),
			(disconnect) => Effect.sync(disconnect),
		)
		// Built in the Mount's scope: the element's removal closes it, which unmounts the tree.
		yield* Layer.build(withWebHost(mounting))
	})

/** Runs the island in `element` while the stream runs; emits each navigation or menu choice. */
export const channelListIsland = (element: Element, args: IslandArgs): Stream.Stream<IslandIntent> =>
	Stream.callback<IslandIntent>((queue) =>
		mountIsland(element, args, (intent) => Queue.offerUnsafe(queue, intent)).pipe(
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
		readonly membersActive: boolean
		/** The sidebar's `OnMount` running `channelListIsland` with these ids. */
		readonly onMount: Attribute<ParentMessage>
	},
): Html =>
	h.keyed("div")(`hazel-island:${options.organizationId}:${options.userId}`, [
		h.Attribute("data-island", "channel-list"),
		h.Attribute(ACTIVE_ATTRIBUTE, options.activeChannelId ?? ""),
		h.Attribute(MEMBERS_ATTRIBUTE, String(options.membersActive)),
		options.onMount,
	])
