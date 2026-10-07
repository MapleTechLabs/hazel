import { Array, Option, Schema } from "effect"
import { Subscription } from "foldkit"
import type { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { HazelRpc } from "../rpc"
import type { AppRoute } from "../route"
import * as ChatChannel from "./chat/channel"
import * as ChatIndex from "./chat-index"
import type { PageHost, PageMessageBase, PageSlotBase, PageStep, PageViewInputs, Shared } from "./contract"
import type { PageOutMessage } from "./out-message"
import * as NotificationsInbox from "./notifications/inbox"
import * as OrgHome from "./home"
import * as Profile from "./profile"
import * as Root from "./root"
import * as IntegrationSettings from "./settings/integrations/detail"
import * as IntegrationsSettings from "./settings/integrations/index"
import * as InstalledAppsSettings from "./settings/integrations/installed"
import * as MarketplaceSettings from "./settings/integrations/marketplace"
import * as YourAppsSettings from "./settings/integrations/your-apps"
import * as TeamSettings from "./settings/team"

/**
 * Every routed page, registered once. Adding a page: import its module and append `X.page` below.
 * Routes without a page render their layout around an empty placeholder (see README.md).
 */
export const pages = [
	Root.page,
	TeamSettings.page,
	ChatChannel.page,
	NotificationsInbox.page,
	OrgHome.page,
	Profile.page,
	ChatIndex.page,
	IntegrationsSettings.page,
	InstalledAppsSettings.page,
	MarketplaceSettings.page,
	YourAppsSettings.page,
	IntegrationSettings.page,
]

export const PageSlot = Schema.Union(pages.map((page) => page.Slot))
export type PageSlot = typeof PageSlot.Type

export const PageMessage = Schema.Union(pages.map((page) => page.Wrapped))
export type PageMessage = typeof PageMessage.Type

/** The page slot after a transition, with the Commands and OutMessage that came with it. */
export interface PageTransition {
	readonly slot: PageSlot | null
	readonly commands: ReadonlyArray<Command.Command<PageMessage, never, HazelRpc>>
	readonly outMessage: Option.Option<PageOutMessage>
}

const unchanged = (slot: PageSlot | null): PageTransition => ({
	slot,
	commands: [],
	outMessage: Option.none(),
})

const toTransition = (step: Option.Option<PageStep<PageSlot, PageMessage>>, fallback: PageSlot | null) =>
	Option.match(step, { onNone: () => unchanged(fallback), onSome: (found): PageTransition => found })

const pageById = (id: string) => Array.findFirst(pages, (page) => page.id === id)

/**
 * Navigation: keep the page when its key is unchanged (informing it of the new route), otherwise
 * build the route's page and drop the previous one (React's unmount semantics).
 */
export const enterRoute = (current: PageSlot | null, route: AppRoute, shared: Shared): PageTransition =>
	Option.match(
		Array.findFirst(pages, (page) => page.ownsRoute(route)),
		{
			onNone: () => unchanged(null),
			onSome: (page) => {
				const isSameInstance =
					current !== null &&
					current._tag === page.id &&
					Option.contains(page.keyOf(route), current.key)
				return isSameInstance
					? toTransition(page.routeChanged(current, route, shared), current)
					: toTransition(page.init(route, shared), null)
			},
		},
	)

export const updatePage = (
	current: PageSlot | null,
	message: PageMessageBase,
	shared: Shared,
): PageTransition =>
	current === null
		? unchanged(current)
		: Option.match(pageById(message._tag), {
				onNone: () => unchanged(current),
				onSome: (page) => toTransition(page.update(current, message, shared), current),
			})

export const informShared = (current: PageSlot | null, shared: Shared): PageTransition =>
	current === null
		? unchanged(current)
		: Option.match(pageById(current._tag), {
				onNone: () => unchanged(current),
				onSome: (page) => toTransition(page.sharedChanged(current, shared), current),
			})

export const pageSubscriptions = Subscription.aggregate<PageHost, PageMessage, HazelRpc>()(
	...pages.map((page) => page.subscriptions),
)

/** Embeds the active page. `slotId` includes the key, so a new page instance gets a fresh boundary. */
export const viewPage = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	slot: PageSlotBase,
	inputs: PageViewInputs,
	toParentMessage: (message: PageMessage) => ParentMessage,
): Html =>
	Option.match(pageById(slot._tag), {
		onNone: () => h.empty,
		onSome: (page) =>
			h.submodel({
				slotId: `page:${slot._tag}:${slot.key}`,
				model: slot,
				view: page.hostView,
				viewInputs: inputs,
				toParentMessage,
			}),
	})
