import type { Html, HtmlBuilder } from "foldkit/html"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toaster"
import { type PageMessage, viewPage } from "../page/registry"
import { chatChannelIdOf, orgSectionOf, orgSlugOf } from "../route"
import { isNativeSectionRoute, sectionLayoutOf } from "../shell/sections"
import { displayNameOf } from "../session"
import * as ChannelsSidebar from "../shell/channels-sidebar"
import * as CustomersSidebar from "../shell/customers-sidebar"
import type { ShellContext } from "../shell/context"
import { mobileSidebarSheet } from "../shell/mobile"
import * as Shell from "../shell/model"
import type * as ModalKit from "../ui/modal"
import { Message } from "./message"
import { type Model, sharedOf } from "./model"

/**
 * The host draws its parts into fixed regions; the Effect UI shell moves each region into its
 * place in the frame (`src/root/foldkit.ts`). The list and order never change, so Foldkit only ever
 * patches inside a region and never inserts next to one it no longer holds.
 */
export const REGIONS = ["sidebar", "page", "overlays"] as const
export type Region = (typeof REGIONS)[number]

export const REGION_ATTRIBUTE = "data-foldkit-region"

// Module-level and built as literals: memoized views compare them by reference, and wrapper
// constructors would re-validate large payloads (sidebar rows, message pages) per dispatch.
const toShellMessage = (message: Shell.Message): Message => ({ _tag: "GotShellMessage", message })
const toChannelsSidebarMessage = (message: ChannelsSidebar.Message) =>
	toShellMessage({ _tag: "GotChannelsSidebarMessage", message })
const toCustomersSidebarMessage = (message: CustomersSidebar.Message) =>
	toShellMessage(Shell.Message.GotCustomersSidebarMessage({ message }))
const toMobileSidebarMessage = (message: ModalKit.Message) =>
	toShellMessage({ _tag: "GotMobileSidebarMessage", message })
export const toPageMessage = (message: PageMessage): Message => ({ _tag: "GotPageMessage", message })
const toToastsMessage = (message: Toasts.Message): Message => ({ _tag: "GotToastsMessage", message })
const toModalMessage = (message: Modal.Message): Message => ({ _tag: "GotModalMessage", message })
const toCommandPaletteMessage = (message: CommandPalette.Message): Message => ({
	_tag: "GotCommandPaletteMessage",
	message,
})

/** The org shell's context: the loaded user and organization of the route's slug, or none yet. */
const shellContextOf = (model: Model): ShellContext | null => {
	const { context } = model
	const orgSlug = orgSlugOf(context.route)
	const user = context.currentUser
	const organization = context.organization
	if (orgSlug === undefined || user === null || organization === null) return null
	return {
		orgSlug,
		route: context.route,
		organization,
		currentUser: { displayName: displayNameOf(user), email: user.email, avatarUrl: user.avatarUrl },
		currentUserId: user.id,
		appVersion: __APP_VERSION__,
		paletteKey: sharedOf(model).keys["commandPalette.open"],
		createChannelKey: sharedOf(model).keys["channel.create"],
	}
}

/** The routed page, or an empty placeholder until its page is ported. */
const pageBody = (model: Model, h: HtmlBuilder<Message>, isInsideMain: boolean): Html => {
	if (model.page !== null) return viewPage(h, model.page, { shared: sharedOf(model) }, toPageMessage)
	const placeholder = h.Attribute("data-page-placeholder", model.context.route._tag)
	return isInsideMain ? h.div([placeholder]) : h.main([placeholder])
}

/**
 * The route's section layout around the page. Settings, my settings, notifications and channel
 * settings draw theirs in the shell (`src/root/sections.ts`), around this page region.
 */
const sectionBody = (model: Model, h: HtmlBuilder<Message>): Html => {
	const { route } = model.context
	// Customers pages own their scrolling (the queue's preview panel spans the full height).
	if (orgSectionOf(route) === "Customers")
		return h.main([h.Class("h-full w-full min-w-0 overflow-hidden bg-bg")], [pageBody(model, h, true)])
	return pageBody(model, h, isNativeSectionRoute(route))
}

const secondarySidebar = (model: Model, h: HtmlBuilder<Message>, context: ShellContext): Html => {
	const { shell } = model
	if (orgSectionOf(model.context.route) === "Customers")
		return CustomersSidebar.view(h, shell.customersSidebar, context, toCustomersSidebarMessage)
	return ChannelsSidebar.view(
		h,
		shell.channelsSidebar,
		{ shell: context, activeChannelId: chatChannelIdOf(model.context.route), nowMs: model.context.nowMs },
		toChannelsSidebarMessage,
	)
}

/**
 * On a phone, the chat list is the Chats tab's page (the channels sidebar, full screen) rather
 * than a sheet behind a menu button: a channel opens from it, and its header leads back.
 */
const phoneChatList = (h: HtmlBuilder<Message>, sidebar: Html): Html =>
	h.main(
		[
			h.Attribute("data-slot", "sidebar"),
			h.Attribute("data-intent", "default"),
			h.Class("flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-fg [--sidebar-width:100%]"),
		],
		[sidebar],
	)

interface Regions {
	readonly sidebar: ReadonlyArray<Html>
	readonly page: ReadonlyArray<Html>
	readonly overlays: ReadonlyArray<Html>
}

const regionsOf = (model: Model, h: HtmlBuilder<Message>): Regions => {
	const context = shellContextOf(model)
	const shared = sharedOf(model)
	const overlays = [
		Toasts.view(h, model.toasts, toToastsMessage, model.context.isMobile),
		Modal.view(h, model.modal, shared, toModalMessage),
		h.submodel({
			slotId: "command-palette",
			model: model.commandPalette,
			view: CommandPalette.view,
			viewInputs: { shared },
			toParentMessage: toCommandPaletteMessage,
		}),
	]
	if (context === null) return { sidebar: [], page: [pageBody(model, h, false)], overlays }
	const { isMobile } = model.context
	// Settings' and Activity's sidebars are the shell's (`src/root/sections.ts`), on a phone too.
	const layout = sectionLayoutOf(model.context.route)
	const isNativeSection = layout === "settings" || layout === "activity"
	const sidebar = isNativeSection ? h.empty : secondarySidebar(model, h, context)
	const isPhoneChatList = isMobile && model.context.route._tag === "ChatIndex"
	return {
		sidebar: isMobile ? [] : [sidebar],
		page: [isPhoneChatList ? phoneChatList(h, sidebar) : sectionBody(model, h)],
		overlays: isMobile
			? [
					mobileSidebarSheet(h, {
						isOpen: model.shell.isSidebarOpen && !isPhoneChatList && !isNativeSection,
						children: [sidebar],
						toMessage: toMobileSidebarMessage,
					}),
					...overlays,
				]
			: overlays,
	}
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
	const regions = regionsOf(model, h)
	return h.div(
		[h.Attribute("data-foldkit-host", ""), h.Attribute("hidden", "")],
		REGIONS.map((region) =>
			h.keyed("div")(
				region,
				[h.Attribute(REGION_ATTRIBUTE, region), h.Class("contents")],
				[...regions[region]],
			),
		),
	)
}
