// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone app (`docs/ios-native.md`, N1): the system tab bar (Home, DMs, Activity, More) over one
 * navigation stack per tab. A route opens as a push on the current tab, except a tab's own root,
 * which selects that tab. A route with no shared screen yet is the host's web fallback
 * (`WebFallback`), pushed like any screen. The stacks follow the system's back (swipe or button)
 * through `pop`, and every way a screen navigates (links, requests) reaches `ShellIntents`.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { WebFallback } from "@hazel/ui/extensions/WebFallback"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Context, Match, Schema, Stream } from "effect"
import { Activity } from "../activity/Activity"
import { AppRoute, hrefOf, routeOfPath } from "../app/route"
import { ChannelSidebar } from "../channel-sidebar/ChannelSidebar"
import { Dms } from "../dms/Dms"

export const PhoneTab = Schema.Literals(["home", "dms", "activity", "more"])
export type PhoneTab = typeof PhoneTab.Type

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

/** The tab whose root a route is, if it is one. */
const rootTabOf = (route: AppRoute): PhoneTab | null =>
	AppRoute.matchOrElse(
		route,
		{
			OrgHome: () => "home" as const,
			ChatIndex: () => "home" as const,
			ChatDms: () => "dms" as const,
			NotificationsMentions: () => "activity" as const,
			NotificationsUnreads: () => "activity" as const,
			NotificationsAll: () => "activity" as const,
			OrgMore: () => "more" as const,
		},
		() => null,
	)

const withStack = (
	stacks: Stacks,
	tab: PhoneTab,
	f: (stack: ReadonlyArray<string>) => ReadonlyArray<string>,
): Stacks => ({ ...stacks, [tab]: f(stacks[tab]) })

/** Opens `href`: a tab's root selects that tab at its root; anything else is pushed on this tab. */
export const open = (model: PhoneShellModel, href: string): PhoneShellModel => {
	const route = routeOfPath(href)
	if (route._tag === "NotFound") return model
	const tab = rootTabOf(route)
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

/** The title a fallback screen's bar shows (its page draws its own heading under it). */
const titleOf = (route: AppRoute): string =>
	AppRoute.matchOrElse(
		route,
		{
			ChatFiles: () => "Files",
			ChatFilesMedia: () => "Media",
			Profile: () => "Profile",
			TeamSettings: () => "Members",
			OrgMore: () => "More",
		},
		() => "",
	)

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
		const fallback = (title: string, href: string) =>
			h.screen
				.key(href)
				.title(title)
				.surface("page")
				.children(h.extension(WebFallback, { path: href }))
		const root = Match.value(model.tab).pipe(
			Match.when("home", () =>
				ChannelSidebar(h, {
					key: "home",
					props: {
						organizationId: props.organizationId,
						userId: props.userId,
						orgSlug: props.orgSlug,
						activeChannelId: null,
						membersActive: false,
						hintDismissed: true,
						paletteKey: null,
						chrome: true,
					},
				}),
			),
			Match.when("dms", () =>
				Dms(h, {
					key: "dms",
					props: {
						organizationId: props.organizationId,
						userId: props.userId,
						orgSlug: props.orgSlug,
						nowMs: props.nowMs,
					},
				}),
			),
			Match.when("activity", () =>
				Activity(h, {
					key: "activity",
					props: {
						memberId: props.memberId,
						orgSlug: props.orgSlug,
						tab: "mentions",
						nowMs: props.nowMs,
						titled: true,
					},
				}),
			),
			Match.when("more", () => fallback("More", hrefOf(AppRoute.OrgMore({ orgSlug: props.orgSlug })))),
			Match.exhaustive,
		)
		const pushed = model.stacks[model.tab].map((href) => fallback(titleOf(routeOfPath(href)), href))
		return h.tabBar
			.tabs(TABS.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon })))
			.selected(model.tab)
			.on("change", ({ id }) => PhoneShellMessage.PickedTab({ id }))
			.children(
				h.navigation
					.key(model.tab)
					.on("pop", ({ depth }) => PhoneShellMessage.Popped({ depth }))
					.children(root, ...pushed),
			)
	},
})
