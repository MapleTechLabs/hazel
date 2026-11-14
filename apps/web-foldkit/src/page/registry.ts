import { Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Resources } from "../rpc"
import { AppRoute, isCustomersRoute, isMySettingsRoute, isSettingsRoute } from "../route"
import * as Auth from "./auth"
import * as BotInstall from "./bot-install"
import * as ChatChannel from "./chat/channel"
import * as ChatIndex from "./chat-index"
import type { PageHost, PageMessageBase, PageSlotBase, PageStep, PageViewInputs, Shared } from "./contract"
import * as Lazy from "./lazy"
import type { PageOutMessage } from "./out-message"
import * as NotificationsInbox from "./notifications/inbox"
import * as OrgHome from "./home"
import * as Profile from "./profile"
import * as Root from "./root"
import * as Invite from "./invite"
import * as Join from "./join"
import * as SelectOrganization from "./select-organization"

/**
 * Every routed page, registered once. Routes without a page render their layout around an empty
 * placeholder (see README.md).
 *
 * `pages` are in the app's first chunk: what a signed-in user's first screen (the chat) and a
 * signed-out one's (sign-in) can show. Adding one: import its module and append `X.page`.
 */
export const pages = [
	Root.page,
	ChatChannel.page,
	NotificationsInbox.page,
	OrgHome.page,
	Profile.page,
	ChatIndex.page,
	Auth.signInPage,
	Auth.registerPage,
	Auth.continuePage,
	Auth.desktopPage,
	SelectOrganization.page,
	Join.page,
	Invite.page,
	BotInstall.page,
]

type AreaPage =
	| (typeof import("./customers/pages"))["pages"][number]
	| (typeof import("./settings/pages"))["pages"][number]
	| (typeof import("./my-settings/pages"))["pages"][number]
	| (typeof import("./channel-settings/pages"))["pages"][number]
	| (typeof import("./onboarding/pages"))["pages"][number]

/**
 * The other pages, by area: each area is a chunk fetched when one of its routes is first entered
 * (`lazy.ts`). Adding a page to an area: append it in the area's `pages.ts`, and its routes to the
 * area's routes here. The imports are dynamic: a static import of a page below puts it back into
 * the first chunk.
 */
export const areas: ReadonlyArray<Lazy.LazyArea<AreaPage>> = [
	Lazy.lazyArea("Customers", isCustomersRoute, () => import("./customers/pages")),
	Lazy.lazyArea("Settings", isSettingsRoute, () => import("./settings/pages")),
	Lazy.lazyArea("MySettings", isMySettingsRoute, () => import("./my-settings/pages")),
	Lazy.lazyArea(
		"ChannelSettings",
		AppRoute.isAnyOf([
			"ChannelSettings",
			"ChannelSettingsOverview",
			"ChannelSettingsIntegrations",
			"ChannelSettingsConnect",
		]),
		() => import("./channel-settings/pages"),
	),
	Lazy.lazyArea(
		"Onboarding",
		AppRoute.isAnyOf(["Onboarding", "OnboardingSetupOrganization"]),
		() => import("./onboarding/pages"),
	),
]

type Page = (typeof pages)[number]

/** Loads every area. The dev server, tests and the native apps do this before the app starts. */
export const loadPages = (): Promise<void> =>
	Promise.all(areas.map((area) => area.load())).then(() => undefined)

const loadedAreaPages = (): ReadonlyArray<AreaPage> => areas.flatMap((area) => area.pages() ?? [])

const areaPageById = (id: string): AreaPage | undefined => {
	for (const area of areas) {
		const page = area.pageById(id)
		if (page !== undefined) return page
	}
	return undefined
}

/**
 * The pages of the loaded areas. Only the dev server reads these schemas (a Model kept across a
 * reload, DevTools), and it has loaded every area by then (`loadPages`).
 */
const AreaSlot = Schema.suspend(() => Schema.Union(loadedAreaPages().map((page) => page.Slot)))
const AreaMessage = Schema.suspend(() => Schema.Union(loadedAreaPages().map((page) => page.Wrapped)))

export const PageSlot = Schema.Union([...pages.map((page) => page.Slot), Lazy.Slot, AreaSlot])
export type PageSlot = typeof PageSlot.Type

export const PageMessage = Schema.Union([...pages.map((page) => page.Wrapped), Lazy.Wrapped, AreaMessage])
export type PageMessage = typeof PageMessage.Type
/** `PageMessage` under the Submodel name, so a parent's Got wrapper imports it as `Message`. */
export { PageMessage as Message }

/** The page slot after a transition, with the Commands and OutMessage that came with it. */
export interface PageTransition {
	readonly slot: PageSlot | null
	readonly commands?: ReadonlyArray<Command.Command<PageMessage, never, Resources>>
	readonly outMessage: Option.Option<PageOutMessage>
}

const unchanged = (slot: PageSlot | null): PageTransition => ({
	slot,
	outMessage: Option.none(),
})

const toTransition = (step: Option.Option<PageStep<PageSlot, PageMessage>>, fallback: PageSlot | null) =>
	Option.match(step, { onNone: () => unchanged(fallback), onSome: (found): PageTransition => found })

const pageById = (id: string): Page | AreaPage | undefined =>
	pages.find((page) => page.id === id) ?? areaPageById(id)

/** Keep the page when its key is unchanged (informing it of the new route), otherwise build it. */
const enterPage = (
	page: Page | AreaPage,
	current: PageSlot | null,
	route: AppRoute,
	shared: Shared,
	instance: number,
): PageTransition => {
	const isSameInstance =
		current !== null && current._tag === page.id && Option.contains(page.keyOf(route), current.key)
	return isSameInstance
		? toTransition(page.routeChanged(current, route, shared), current)
		: toTransition(page.init(route, shared, instance), null)
}

const pending = (step: Lazy.PendingStep): PageTransition => ({ ...step, outMessage: Option.none() })

/**
 * Navigation: the route's page, dropping the previous one (React's unmount semantics). A route of
 * an area that has not loaded gets the pending slot, which opens the page once the chunk is here.
 */
export const enterRoute = (
	current: PageSlot | null,
	route: AppRoute,
	shared: Shared,
	instance: number,
): PageTransition => {
	const page = pages.find((candidate) => candidate.ownsRoute(route))
	if (page !== undefined) return enterPage(page, current, route, shared, instance)
	const area = areas.find((candidate) => candidate.ownsRoute(route))
	if (area === undefined) return unchanged(null)
	const areaPages = area.pages()
	if (areaPages === undefined) return pending(Lazy.enter(area, route, instance))
	const areaPage = areaPages.find((candidate) => candidate.ownsRoute(route))
	return areaPage === undefined ? unchanged(null) : enterPage(areaPage, current, route, shared, instance)
}

export const updatePage = (
	current: PageSlot | null,
	message: PageMessageBase,
	shared: Shared,
): PageTransition => {
	if (current === null) return unchanged(current)
	if (Lazy.isWrapped(message))
		return Lazy.isSlot(current)
			? Lazy.update(
					current,
					message,
					(slot) => enterRoute(null, slot.route, shared, slot.instance),
					pending,
				)
			: unchanged(current)
	const page = pageById(message._tag)
	return page === undefined
		? unchanged(current)
		: toTransition(page.update(current, message, shared), current)
}

export const informShared = (current: PageSlot | null, shared: Shared): PageTransition => {
	if (current === null) return unchanged(current)
	const page = pageById(current._tag)
	return page === undefined
		? unchanged(current)
		: toTransition(page.sharedChanged(current, shared), current)
}

const noEntries: ReadonlyArray<never> = []

export const pageSubscriptions = Subscription.aggregate<PageHost, PageMessage, Resources>()(
	...pages.map((page) => page.subscriptions),
	Lazy.pooledSubscriptions<PageMessage>((host) => {
		const page = host.page === null ? undefined : areaPageById(host.page._tag)
		return page === undefined ? noEntries : Object.values(page.subscriptions)
	}),
)

/** Embeds the active page. `slotId` includes the key, so a new page instance gets a fresh boundary. */
export const viewPage = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	slot: PageSlotBase,
	inputs: PageViewInputs,
	toParentMessage: (message: PageMessage) => ParentMessage,
): Html => {
	const slotId = `page:${slot._tag}:${slot.key}`
	if (Lazy.isSlot(slot))
		return h.submodel({ slotId, model: slot, view: Lazy.view, viewInputs: inputs, toParentMessage })
	const page = pageById(slot._tag)
	return page === undefined
		? h.empty
		: h.submodel({ slotId, model: slot, view: page.hostView, viewInputs: inputs, toParentMessage })
}
