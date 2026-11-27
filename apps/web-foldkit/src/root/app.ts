// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web app's root: an Effect UI component that owns the boot, the session and its gate, the
 * organization, the route (today's URLs and redirects), the theme, the keys, the notification
 * sinks and the page frame. Pages not yet on Effect UI run in the Foldkit host (`foldkit.ts`).
 */
import { Head, Mount } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { AsyncData } from "foldkit"
import { currentServer } from "~/config/server"
import { comboLabel } from "~/lib/keybindings/key-combo"
import { commonMessage } from "~/lib/error-messages"
import type { Region } from "../app/view"
import { badgedTitle } from "../platform/badge"
import { chatChannelIdOf, isPublicRoute, orgSectionOf, orgSlugOf, titleOf } from "../route"
import type { CurrentUser, Organization } from "../session"
import { hotkeyLabel } from "../shell/channels-sidebar/hotkey-label"
import { appError, appLoader, organizationNotFound } from "../shell/layouts"
import { LINK_PREVIEW_URL } from "../chat/unfurl"
import { assistantContextOf, column, setupHrefOf, toggleButton } from "./assistant"
import {
	ShellActivity,
	ShellAssistantPanel,
	ShellChannelHeader,
	ShellChannelSidebar,
	ShellJoinBanner,
	ShellMessageList,
} from "./children"
import { ShellFilesPage, ShellMediaPage } from "./children"
import { AdoptRegion, RunFoldkitHost } from "./foldkit"
import {
	mobileChromeOf,
	navRail,
	type RailInputs,
	sidebarDock,
	sidebarInner,
	sidebarInset,
	sidebarProvider,
	tabBar,
	topBar,
} from "./frame"
import { fromKit, kit } from "./kit"
import {
	type AppFlags,
	AppModel,
	currentUserOf,
	hostContextOf,
	init,
	keysOf,
	memberOf,
	organizationOf,
	update,
} from "./logic"
import { AppMessage } from "./message"
import { modalOf } from "./modals"
import { nativePageOf } from "./native-pages"
import { paletteDestinations, paletteShortcuts, ShellCommandPalette } from "./palette"
import { Hole } from "./portal"
import { chromeHoles, sectionContent, sectionSidebar } from "./sections"
import { sectionLayoutOf } from "../shell/sections"
import { subscriptions as subscriptionsOf } from "./subscriptions"
import { AppRoute } from "./routes"
import { authOf, OrgState, Session } from "./state"

/** Read before the first render (`entry.ts`), so a stored theme or the viewport never flash. */
export interface Boot extends AppFlags {
	readonly isCreateChannelHintDismissed: boolean
}

const BootSchema = Schema.declare((_: unknown): _ is Boot => true)

const AppDef = Html.component({
	name: "App",
	props: Schema.Struct({ route: AppRoute, boot: BootSchema }),
	model: AppModel,
	message: AppMessage,
})

type H = Parameters<Parameters<typeof AppDef.view>[0]>[0]

// VIEW

/** Where the Foldkit host's region shows in the frame: an element the region moves into. */
const slot = (h: H, region: Region) =>
	h.div
		.key(`slot:${region}`)
		.class("contents")
		.attr("data-foldkit-slot", region)
		.onMount(AdoptRegion({ region }))

const loader = (h: H, isStalled: boolean) =>
	fromKit(h, appLoader(kit, isStalled ? "reload" : undefined), { press: AppMessage.PressedReload() })

/** The session a native page reads (`shared-screens/src/app/session.ts`). */
const sessionOf = (model: AppModel) => ({
	auth: authOf(model.session),
	user: currentUserOf(model),
	organization: organizationOf(model),
	member: memberOf(model),
	orgSlug: orgSlugOf(model.route) ?? null,
})

/** The route's page: a native page (`native-pages.ts`), or the Foldkit host's page region. */
const page = (h: H, model: AppModel) =>
	nativePageOf(h, {
		route: model.route,
		session: sessionOf(model),
		isMobile: model.isMobile,
		nowMs: model.nowMs,
		// A failed chunk offers a reload, as a lazy area's pending page does.
		fallback: (failed) => loader(h, failed),
	}) ?? slot(h, "page")

/** The open native modal, over the frame (`modals.ts`). */
const modal = (h: H, model: AppModel) =>
	modalOf(h, model.modal, {
		session: sessionOf(model),
		route: model.route,
		nowMs: model.nowMs,
		isMobile: model.isMobile,
		keybindingOverrides: model.keybindingOverrides,
		keyboardPlatform: model.keyboardPlatform,
	})

const appRoot = (h: H, model: AppModel, ...children: ReadonlyArray<unknown>) =>
	h.div.attr("id", "app").children(...(children as Array<never>), slot(h, "overlays"), modal(h, model))

interface ShellData {
	readonly orgSlug: string
	readonly user: CurrentUser
	readonly organization: Organization
}

const chromeDataOf = (model: AppModel, data: ShellData) => ({ ...data, member: memberOf(model) })

/** The route's page inside its section layout, when the shell draws one (`sections.ts`). */
const sectionPage = (h: H, model: AppModel) => {
	const layout = sectionLayoutOf(model.route)
	return layout === null ? page(h, model) : sectionContent(h, model, layout, page(h, model))
}

/** The dock's secondary sidebar: a native section's, else the Foldkit host's (chat, customers). */
const dockSidebar = (h: H, model: AppModel, data: ShellData) => {
	const layout = sectionLayoutOf(model.route)
	return (
		(layout === null ? null : sectionSidebar(h, model, layout, chromeDataOf(model, data))) ??
		slot(h, "sidebar")
	)
}

/** A native section's sidebar as the phone's sheet, opened from its top bar's menu button. */
const phoneSectionSheet = (h: H, model: AppModel, data: ShellData) => {
	const layout = sectionLayoutOf(model.route)
	return layout === null ? null : sectionSidebar(h, model, layout, chromeDataOf(model, data))
}

/** The converted screens, each an ordinary child placed in its Foldkit page's hole (`portal.ts`). */
const children = (h: H, model: AppModel, data: ShellData) => {
	const { route } = model
	const keys = keysOf(model)
	const paletteKey = keys["commandPalette.open"]
	const channelId = chatChannelIdOf(route)
	const section = orgSectionOf(route)
	const memberId = hostContextOf(model).member?.id ?? null
	const tab =
		route._tag === "NotificationsAll" ? "all" : route._tag === "NotificationsMentions" ? "mentions" : null
	const orgUser = `${data.organization.id}:${data.user.id}`
	const native = sectionLayoutOf(route)
	return [
		// The org switcher and account card in the host's chat and customers sidebars.
		...(native !== "settings" && native !== "activity"
			? chromeHoles(h, model, chromeDataOf(model, data))
			: []),
		section === "Chat" || route._tag === "OrgHome"
			? Hole(h, { hole: "channel-sidebar", key: orgUser }, [
					ShellChannelSidebar(h, {
						key: orgUser,
						props: {
							organizationId: data.organization.id,
							userId: data.user.id,
							orgSlug: data.orgSlug,
							activeChannelId: channelId,
							membersActive: route._tag === "OrgHome",
							hintDismissed: h.props.boot.isCreateChannelHintDismissed,
							paletteKey: paletteKey === null ? null : hotkeyLabel(paletteKey),
							chrome: false,
						},
					}),
				])
			: null,
		route._tag === "ChatChannel" && channelId !== null
			? Hole(
					h,
					{
						hole: "message-list",
						key: channelId,
						matchKey: true,
						className: "flex min-h-0 flex-1 flex-col [&>[data-hz]]:min-h-0 [&>[data-hz]]:flex-1",
					},
					[
						ShellMessageList(h, {
							key: channelId,
							props: {
								channelId,
								userId: data.user.id,
								cdnUrl: currentServer().cdn ?? "https://cdn.hazel.sh",
								linkPreviewUrl: LINK_PREVIEW_URL,
								nowMs: model.nowMs,
							},
						}),
					],
				)
			: null,
		// The channel's Files and All media tabs, under the Foldkit channel page's header and tab bar.
		(route._tag === "ChatFiles" || route._tag === "ChatFilesMedia") && channelId !== null
			? Hole(h, { hole: "channel-files", key: `${route._tag}:${channelId}`, className: FILES_HOLE }, [
					(route._tag === "ChatFiles" ? ShellFilesPage : ShellMediaPage)(h, {
						key: channelId,
						props: {
							channelId,
							orgSlug: data.orgSlug,
							cdnUrl: currentServer().cdn ?? "https://cdn.hazel.sh",
						},
					}),
				])
			: null,
		route._tag === "ChatChannel" && channelId !== null
			? Hole(
					h,
					{
						hole: "join-banner",
						key: channelId,
						matchKey: true,
						className: "flex flex-1 flex-col items-center justify-center p-8",
					},
					[ShellJoinBanner(h, { key: channelId, props: { channelId, userId: data.user.id } })],
				)
			: null,
		route._tag === "ChatChannel" && channelId !== null
			? Hole(h, { hole: "channel-header", key: channelId, matchKey: true }, [
					ShellChannelHeader(h, {
						key: channelId,
						props: {
							channelId,
							organizationId: data.organization.id,
							userId: data.user.id,
							orgSlug: data.orgSlug,
							isMobile: model.isMobile,
							nowMs: model.nowMs,
						},
					}),
				])
			: null,
		tab !== null && memberId !== null
			? Hole(h, { hole: "activity", key: memberId }, [
					ShellActivity(h, {
						key: memberId,
						props: { memberId, orgSlug: data.orgSlug, tab, nowMs: model.nowMs, titled: false },
					}),
				])
			: null,
		model.palette === null
			? null
			: ShellCommandPalette(h, {
					key: `palette:${model.palette.opened}`,
					props: {
						page: model.palette.page,
						open: model.palette.isOpen,
						organizationId: data.organization.id,
						userId: data.user.id,
						orgSlug: data.orgSlug,
						theme: model.themePreference,
						destinations: paletteDestinations(data.orgSlug),
						shortcuts: paletteShortcuts(keys["aiPanel.toggle"], model.keyboardPlatform),
						nowMs: model.nowMs,
					},
					onEmit: {
						RequestedClose: () => AppMessage.RequestedClosePalette(),
						RequestedAiPanel: () => AppMessage.RequestedAiPanelFromPalette(),
						PickedStatus: ({ status }) => AppMessage.PickedPaletteStatus({ status }),
					},
				}),
	]
}

/** The files pages fill the channel page's content column, as its list does. */
const FILES_HOLE = "flex min-h-0 flex-1 flex-col [&>[data-hz]]:min-h-0 [&>[data-hz]]:flex-1"

/** The AI panel in its column (`assistant.ts`), drawn closed too so it keeps its chat. */
const assistant = (h: H, model: AppModel, data: ShellData) =>
	column(
		h,
		{
			isOpen: model.assistant.isOpen,
			isMobile: model.isMobile,
			width: model.assistant.width,
			isSidebarCollapsed: model.report?.isSidebarCollapsed ?? false,
		},
		(event) =>
			event._tag === "Resized"
				? AppMessage.ResizedAssistantPanel({ width: event.width })
				: AppMessage.RequestedCloseAssistantPanel(),
		ShellAssistantPanel(h, {
			key: data.organization.id,
			props: {
				organizationId: data.organization.id,
				userId: data.user.id,
				open: model.assistant.isOpen,
				mobile: model.isMobile,
				context: assistantContextOf(model.route, model.report?.assistantContext),
				setupHref: setupHrefOf(data.orgSlug),
			},
			onEmit: { RequestedClose: () => AppMessage.RequestedCloseAssistantPanel() },
		}),
	)

/** The rail's toggle, titled with its key as the user's keyboard labels it ("⌘J"). */
const assistantToggle = (h: H, model: AppModel) => {
	const key = keysOf(model)["aiPanel.toggle"]
	return toggleButton(
		h,
		model.assistant.isOpen,
		key === null ? null : comboLabel(key, model.keyboardPlatform),
		AppMessage.PressedAiPanelToggle(),
	)
}

/** Whose screen this is, for the last screen's paint (`app/paint.ts`). */
const paintAttrs = (data: ShellData) => ({ "data-paint": "shell", "data-paint-user": data.user.id })

const railInputsOf = (model: AppModel, data: ShellData): RailInputs => ({
	orgSlug: data.orgSlug,
	route: model.route,
	unreadCount: model.report?.bellCount ?? 0,
	appVersion: __APP_VERSION__,
})

/** `$orgSlug/layout.tsx` + `AppSidebar` + `SidebarInset` (`shell/app-shell.ts`). */
const orgShell = (h: H, model: AppModel, data: ShellData) => {
	const rail = railInputsOf(model, data)
	if (model.isMobile) return phoneShell(h, model, data, rail)
	return h.div
		.attr("id", "app")
		.attrs(paintAttrs(data))
		.children(
			// The panel's edge marks the frame while it is dragged (`assistant.ts`).
			sidebarProvider(h, "[&.cursor-col-resize_iframe]:pointer-events-none").children(
				sidebarDock(
					h,
					model.report?.isSidebarCollapsed ?? false,
					"overflow-hidden *:data-[sidebar=default]:flex-row",
					sidebarInner(h).children(
						navRail(h, rail, assistantToggle(h, model)),
						dockSidebar(h, model, data),
					),
				),
				sidebarInset(h, "").children(sectionPage(h, model)),
				assistant(h, model, data),
			),
			slot(h, "overlays"),
			modal(h, model),
			...children(h, model, data),
		)
}

/**
 * A phone's shell: one screen-high column with an optional top bar, the page (which scrolls inside
 * itself) and the tab bar, edge to edge, kept out of the status bar and the home indicator.
 */
const phoneShell = (h: H, model: AppModel, data: ShellData, rail: RailInputs) => {
	const chrome = mobileChromeOf(model.route)
	return h.div
		.attr("id", "app")
		.attrs(paintAttrs(data))
		.children(
			sidebarProvider(
				h,
				"h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
			).children(
				sidebarInset(
					h,
					chrome.hasTabBar ? "min-h-0" : "min-h-0 pb-[env(safe-area-inset-bottom)]",
				).children(
					chrome.topBar === null ? null : topBar(h, chrome.topBar, AppMessage.PressedMobileMenu()),
					// Pages that fill the screen (`h-full`) scroll inside themselves; the rest scroll here.
					h.div
						.class("relative min-h-0 flex-1 overflow-y-auto overscroll-contain")
						.children(sectionPage(h, model)),
					chrome.hasTabBar ? tabBar(h, rail, AppMessage.PressedMobileSearch()) : null,
				),
			),
			assistant(h, model, data),
			slot(h, "overlays"),
			phoneSectionSheet(h, model, data),
			modal(h, model),
			...children(h, model, data),
		)
}

/** `$orgSlug/layout.tsx`: a loader while `useOrganization()` loads the route's organization. */
const orgBody = (h: H, model: AppModel, user: CurrentUser) => {
	const orgSlug = orgSlugOf(model.route)
	if (orgSlug === undefined) return appRoot(h, model, page(h, model))
	return OrgState.match(model.org, {
		None: () => appRoot(h, model, loader(h, false)),
		Loading: ({ isStalled }) => appRoot(h, model, loader(h, isStalled)),
		NotFound: () => appRoot(h, model, fromKit(h, organizationNotFound(kit, orgSlug))),
		Loaded: ({ organization }) => orgShell(h, model, { orgSlug, user, organization }),
	})
}

const errorScreen = (h: H, title: string, description: string | undefined, onRetry: AppMessage) =>
	fromKit(h, appError(kit, { title, description, onRetry: "retry" }), { press: onRetry })

const body = (h: H, model: AppModel) => {
	const { route } = model
	if (route._tag === "NotFound") return h.div.attr("id", "app").children(`Not found: ${route.path}`)
	if (isPublicRoute(route)) return appRoot(h, model, page(h, model))
	// `_app/layout.tsx`: a loader until the API answers for the session; signed out redirects to sign-in.
	return Session.match(model.session, {
		Loading: () => appRoot(h, model, loader(h, false)),
		SignedOut: () => appRoot(h, model, loader(h, false)),
		Unreachable: ({ reason }) =>
			appRoot(
				h,
				model,
				errorScreen(
					h,
					"Can't reach Hazel",
					commonMessage(reason).description,
					AppMessage.PressedRetrySession(),
				),
			),
		// `AppShell`: a loader until `user.me` answers, then the error if it could not.
		SignedIn: ({ user }) =>
			AsyncData.matchData(user, {
				onEmpty: () => appRoot(h, model, loader(h, false)),
				onFailure: (reason) =>
					appRoot(
						h,
						model,
						errorScreen(
							h,
							"Couldn't load your account",
							commonMessage(reason).description,
							AppMessage.PressedRetryCurrentUser(),
						),
					),
				onData: (data) => orgBody(h, model, data),
			}),
	})
}

/** The route's title with Discord's unread prefix: `(3) Chat · Hazel`, or `• Chat · Hazel`. */
export const documentTitleOf = (model: AppModel): string =>
	badgedTitle(titleOf(model.route), model.report?.badge ?? { mentionCount: 0, hasUnread: false })

export const App = AppDef.make({
	init: ($) => {
		const next = init($.props.route, $.props.boot)
		return $.set(next.model).run(...next.commands)
	},
	update: ($, message) => {
		const next = update($.model, message)
		return next.model === $.model && next.commands.length === 0
			? $.model
			: $.set(next.model).run(...next.commands)
	},
	subscriptions: subscriptionsOf,
	head: ({ model }) => [Head.title(documentTitleOf(model))],
	view: (h, model) =>
		h.div
			.class("contents")
			.attr("data-hazel-root", "")
			.children(
				// The Foldkit host: started once, fed each render's context; its regions move into the slots.
				h.div
					.key("foldkit-host")
					.attr("hidden", "")
					.onMount(
						RunFoldkitHost({
							context: hostContextOf(model),
							isCreateChannelHintDismissed: h.props.boot.isCreateChannelHintDismissed,
						}).pipe(Mount.map((out) => AppMessage.ReceivedHostOut({ out }))),
					),
				body(h, model),
			),
})
