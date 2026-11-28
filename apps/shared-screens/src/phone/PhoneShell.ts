// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone app (`docs/ios-native.md`): the system tab bar (Home, DMs, Activity, More) over one
 * navigation stack per tab. A route opens as a push on the current tab, except a tab's own root,
 * which selects that tab. Each route draws its screen from the app's registry (`app/screens`); one
 * with none yet is the web fallback (`FallbackScreen`). Every tab's screens stay alive while another
 * tab shows. The stacks follow the system's back (swipe or button) through `pop`, and every way a
 * screen navigates reaches `ShellIntents` (`./navigation`).
 */
import { Subscription, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Context, Match, Schema, Stream } from "effect"
import { hrefOf, routeOfPath } from "../app/route"
import { AppTab, screenOf, tabOf, tabRoot, titleOf } from "../app/screens"
import { FallbackScreen } from "./FallbackScreen"

export const PhoneTab = AppTab
export type PhoneTab = AppTab

/** What the app asks of the shell: open an in-app href, or go back one screen. */
export const ShellIntent = UiSchema.TaggedEnum({
	Open: { href: Schema.String },
	Back: {},
})
export type ShellIntent = typeof ShellIntent.Type

/** Every navigation the screens and the host ask for, in order (the host's one queue). */
export class ShellIntents extends Context.Service<
	ShellIntents,
	{ readonly intents: Stream.Stream<ShellIntent> }
>()("hazel/phone/ShellIntents") {}

export const PhoneShellProps = Schema.Struct({
	organizationId: OrganizationId,
	memberId: OrganizationMemberId,
	userId: UserId,
	orgSlug: Schema.String,
	/** The install's uploads and link previews (`ChannelScreen`'s message list). */
	cdnUrl: Schema.String,
	linkPreviewUrl: Schema.String,
	nowMs: Schema.Finite,
})
export type PhoneShellProps = typeof PhoneShellProps.Type

/** Each tab's pushed screens, as hrefs (the root is the tab's own). */
const Stacks = Schema.Struct({
	home: Schema.Array(Schema.String),
	dms: Schema.Array(Schema.String),
	activity: Schema.Array(Schema.String),
	more: Schema.Array(Schema.String),
})
type Stacks = typeof Stacks.Type

export const PhoneShellModel = Schema.Struct({ tab: PhoneTab, stacks: Stacks })
export type PhoneShellModel = typeof PhoneShellModel.Type

export const PhoneShellMessage = UiSchema.TaggedEnum({
	PickedTab: { id: Schema.String },
	/** The system popped the top `depth` screens (swipe back, the back button). */
	Popped: { depth: Schema.Finite },
	Intended: { intent: ShellIntent },
})
export type PhoneShellMessage = typeof PhoneShellMessage.Type

const TABS = [
	{ id: "home", label: "Home", icon: "messages" },
	{ id: "dms", label: "DMs", icon: "message-user" },
	{ id: "activity", label: "Activity", icon: "bell" },
	{ id: "more", label: "More", icon: "dots" },
] as const

const isTab = Schema.is(PhoneTab)

const withStack = (
	stacks: Stacks,
	tab: PhoneTab,
	f: (stack: ReadonlyArray<string>) => ReadonlyArray<string>,
): Stacks => ({ ...stacks, [tab]: f(stacks[tab]) })

/** Opens `href`: a tab's root selects that tab at its root; anything else is pushed on this tab. */
export const open = (model: PhoneShellModel, href: string): PhoneShellModel => {
	const route = routeOfPath(href)
	if (route._tag === "NotFound") return model
	const tab = tabOf(route)
	if (tab !== null) return { tab, stacks: withStack(model.stacks, tab, () => []) }
	const path = hrefOf(route)
	const stack = model.stacks[model.tab]
	if (stack[stack.length - 1] === path) return model
	return { ...model, stacks: withStack(model.stacks, model.tab, (pushed) => [...pushed, path]) }
}

/** Drops the top `depth` screens of the current tab. */
export const pop = (model: PhoneShellModel, depth: number): PhoneShellModel => ({
	...model,
	stacks: withStack(model.stacks, model.tab, (stack) => stack.slice(0, Math.max(0, stack.length - depth))),
})

/** A screen stays alive while it is a tab's root or in a tab's stack (`h.keepAlive`'s predicate). */
const isLive = ({ key, model }: { readonly key: string; readonly model: PhoneShellModel }) =>
	tabOf(routeOfPath(key)) !== null || TABS.some((tab) => model.stacks[tab.id].includes(key))

export const PhoneShell = Hazel.component({
	name: "PhoneShell",
	props: PhoneShellProps,
	model: PhoneShellModel,
	message: PhoneShellMessage,
}).make({
	init: () => ({ tab: "home" as const, stacks: { home: [], dms: [], activity: [], more: [] } }),
	update: {
		// The selected tab again goes back to its root, as every iOS app's tab bar does.
		PickedTab: ($, { id }) => {
			if (!isTab(id)) return $.model
			if (id === $.model.tab) return { ...$.model, stacks: withStack($.model.stacks, id, () => []) }
			return { ...$.model, tab: id }
		},
		Popped: ($, { depth }) => pop($.model, depth),
		Intended: ($, { intent }) =>
			Match.valueTags(intent, {
				Open: ({ href }) => open($.model, href),
				Back: () => pop($.model, 1),
			}),
	},
	subscriptions: () => [
		Subscription.make(
			"intents",
			Stream.unwrap(
				ShellIntents.useSync(({ intents }) =>
					Stream.map(intents, (intent) => PhoneShellMessage.Intended({ intent })),
				),
			),
		),
	],
	view: (h, model) => {
		const { props } = h
		const context = { ...props }
		// A route's screen from the registry, or its fallback; kept alive while it is in a stack or a
		// tab's root, so another tab, or a screen pushed over it, finds it as it was left.
		const screen = (href: string) =>
			h.keepAlive(isLive, (s) => {
				const route = routeOfPath(href)
				return (
					screenOf(s, context, route) ??
					FallbackScreen(s, { key: href, props: { path: href, title: titleOf(route) } })
				)
			})
		const root = hrefOf(tabRoot(model.tab, props.orgSlug))
		return h.tabBar
			.tabs(TABS.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon })))
			.selected(model.tab)
			.on("change", ({ id }) => PhoneShellMessage.PickedTab({ id }))
			.children(
				h.navigation
					.key(model.tab)
					.pushedTabBar("hidden")
					.on("pop", ({ depth }) => PhoneShellMessage.Popped({ depth }))
					.children(screen(root), ...model.stacks[model.tab].map(screen)),
			)
	},
})
