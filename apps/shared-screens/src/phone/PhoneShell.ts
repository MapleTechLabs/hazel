// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The phone app (`docs/ios-native.md`): the system tab bar over one navigation stack per tab
 * (`app/screens`' `TABS`). A route opens as a push on the current tab, except a tab's own root,
 * which selects that tab. Each route draws its screen from the registry (`app/screens`); one with
 * none yet is the web fallback (`FallbackScreen`). Every tab's screens stay alive while another
 * shows. It follows the session as it changes (`CurrentSession`): another organization starts its
 * tabs over, with no restart. Navigation, toasts included, reaches it as `ShellIntents`.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Context, Duration, Match, Schema, Stream } from "effect"
import { CurrentSession } from "../app/current-session"
import { AppToast } from "../app/requests"
import { hrefOf, routeOfPath } from "../app/route"
import { AppTab, frameOf, screenOf, TABS, tabOf, titleOf } from "../app/screens"
import { Session } from "../app/session"
import { FallbackScreen } from "./FallbackScreen"

/** What the app asks of the shell: open, replace or leave a screen, or show a toast. */
export const ShellIntent = UiSchema.TaggedEnum({
	Open: { href: Schema.String },
	/** The top screen becomes `href` (a redirect): back skips it. */
	Replace: { href: Schema.String },
	Back: {},
	Toast: { toast: AppToast },
})
export type ShellIntent = typeof ShellIntent.Type

/** Every navigation the screens and the host ask for, in order (the host's one queue). */
export class ShellIntents extends Context.Service<
	ShellIntents,
	{ readonly intents: Stream.Stream<ShellIntent> }
>()("hazel/phone/ShellIntents") {}

export const PhoneShellProps = Schema.Struct({
	/** The install's uploads and link previews (fixed for a run: another install restarts the app). */
	cdnUrl: Schema.String,
	linkPreviewUrl: Schema.String,
})
export type PhoneShellProps = typeof PhoneShellProps.Type

/** Each tab's pushed screens, as hrefs (the root is the tab's own, from `TABS`). */
const Stacks = Schema.Record(AppTab, Schema.Array(Schema.String))
type Stacks = typeof Stacks.Type

const ShownToast = Schema.Struct({ id: Schema.Finite, toast: AppToast })

export const PhoneShellModel = Schema.Struct({
	tab: AppTab,
	stacks: Stacks,
	/** Null until the host's session first arrives. */
	session: Schema.NullOr(Session),
	nowMs: Schema.Finite,
	toasts: Schema.Array(ShownToast),
	nextToastId: Schema.Finite,
})
export type PhoneShellModel = typeof PhoneShellModel.Type

export const PhoneShellMessage = UiSchema.TaggedEnum({
	PickedTab: { id: Schema.String },
	/** The system popped the top `depth` screens (swipe back, the back button). */
	Popped: { depth: Schema.Finite },
	Intended: { intent: ShellIntent },
	ReceivedSession: { session: Session },
	Ticked: { nowMs: Schema.Finite },
	DismissedToast: { id: Schema.Finite },
})
export type PhoneShellMessage = typeof PhoneShellMessage.Type

const isTab = Schema.is(AppTab)
const emptyStacks: Stacks = { home: [], dms: [], activity: [], more: [] }

export const initialModel = (nowMs: number): PhoneShellModel => ({
	tab: "home",
	stacks: emptyStacks,
	session: null,
	nowMs,
	toasts: [],
	nextToastId: 1,
})

const withStack = (
	stacks: Stacks,
	tab: AppTab,
	f: (stack: ReadonlyArray<string>) => ReadonlyArray<string>,
): Stacks => ({ ...stacks, [tab]: f(stacks[tab]) })

/** Opens `href`: a tab's root selects that tab at its root; anything else is pushed on this tab. */
export const open = (model: PhoneShellModel, href: string): PhoneShellModel => {
	const route = routeOfPath(href)
	if (route._tag === "NotFound") return model
	const tab = tabOf(route)
	if (tab !== null) return { ...model, tab, stacks: withStack(model.stacks, tab, () => []) }
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

/** The top screen becomes `href`; with none pushed, it opens. */
export const replace = (model: PhoneShellModel, href: string): PhoneShellModel =>
	model.stacks[model.tab].length === 0 ? open(model, href) : open(pop(model, 1), href)

/** The session now: another organization starts the tabs over at their roots. */
export const receiveSession = (model: PhoneShellModel, session: Session): PhoneShellModel =>
	model.session !== null && model.session.orgSlug === session.orgSlug
		? { ...model, session }
		: { ...model, session, tab: "home", stacks: emptyStacks }

/** Shows `toast`; one with the `id` of a shown toast replaces it in place. */
export const showToast = (model: PhoneShellModel, toast: AppToast): PhoneShellModel => ({
	...model,
	toasts: [
		...model.toasts.filter((shown) => toast.id === undefined || shown.toast.id !== toast.id),
		{ id: model.nextToastId, toast },
	],
	nextToastId: model.nextToastId + 1,
})

/** A screen stays alive while it is a tab's root or in a tab's stack (`h.keepAlive`'s predicate). */
const isLive = ({ key, model }: { readonly key: string; readonly model: PhoneShellModel }) =>
	tabOf(routeOfPath(key)) !== null || TABS.some((tab) => model.stacks[tab.id].includes(key))

/** How often relative times move on. */
const TICK = Duration.seconds(30)

const toneOf = (intent: AppToast["intent"]) =>
	Match.value(intent).pipe(
		Match.when("success", () => "success" as const),
		Match.when("error", () => "danger" as const),
		Match.when("warning", () => "warning" as const),
		Match.orElse(() => "neutral" as const),
	)

export const PhoneShell = Hazel.component({
	name: "PhoneShell",
	props: PhoneShellProps,
	model: PhoneShellModel,
	message: PhoneShellMessage,
}).make({
	init: () => initialModel(Date.now()),
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
				Replace: ({ href }) => replace($.model, href),
				Back: () => pop($.model, 1),
				Toast: ({ toast }) => showToast($.model, toast),
			}),
		ReceivedSession: ($, { session }) => receiveSession($.model, session),
		Ticked: ($, { nowMs }) => ({ ...$.model, nowMs }),
		DismissedToast: ($, { id }) => ({
			...$.model,
			toasts: $.model.toasts.filter((shown) => shown.id !== id),
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
		Subscription.make(
			"session",
			Stream.unwrap(
				CurrentSession.useSync(({ changes }) =>
					Stream.map(changes, (session) => PhoneShellMessage.ReceivedSession({ session })),
				),
			),
		),
		Subscription.make(
			"clock",
			Stream.tick(TICK).pipe(Stream.map(() => PhoneShellMessage.Ticked({ nowMs: Date.now() }))),
		),
	],
	view: (h, model) => {
		const session = model.session
		if (session === null) return h.screen.surface("page").children(h.progress.style("spinner"))
		const inputs = {
			session,
			nowMs: model.nowMs,
			cdnUrl: h.props.cdnUrl,
			linkPreviewUrl: h.props.linkPreviewUrl,
		}
		// A route's screen from the registry, or its fallback; kept alive while it is in a stack or a
		// tab's root, so another tab, or a screen pushed over it, finds it as it was left.
		const screen = (href: string) => {
			const route = routeOfPath(href)
			const kept = h.keepAlive(
				isLive,
				(s) =>
					screenOf(s, inputs, route) ??
					FallbackScreen(s, { key: href, props: { path: href, title: titleOf(route) } }),
			)
			// A page the web frames in its shell gets the phone's screen (its bar names it).
			const frame = frameOf(route)
			return frame === null
				? kept
				: h.screen.key(`${href}:frame`).title(frame).surface("page").children(kept)
		}
		const tab = TABS.find((candidate) => candidate.id === model.tab) ?? TABS[0]
		const toasts = model.toasts.map(({ id, toast }) =>
			h.toast
				.key(`toast:${id}`)
				.open(true)
				.tone(toneOf(toast.intent))
				.title(toast.title)
				.description(toast.description ?? undefined)
				.loading(toast.intent === "loading")
				.on("dismiss", PhoneShellMessage.DismissedToast({ id })),
		)
		return h.tabBar
			.tabs(TABS.map((each) => ({ id: each.id, label: each.label, icon: each.icon })))
			.selected(model.tab)
			.on("change", ({ id }) => PhoneShellMessage.PickedTab({ id }))
			.children(
				h.navigation
					.key(model.tab)
					.pushedTabBar("hidden")
					.on("pop", ({ depth }) => PhoneShellMessage.Popped({ depth }))
					.children(
						screen(hrefOf(tab.root(session.orgSlug ?? ""))),
						...model.stacks[model.tab].map(screen),
					),
				...toasts,
			)
	},
})
