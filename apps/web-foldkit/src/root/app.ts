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
import { commonMessage } from "~/lib/error-messages"
import type { Region } from "../app/view"
import * as AiPanel from "../assistant"
import { badgedTitle } from "../platform/badge"
import { chatChannelIdOf, isPublicRoute, orgSectionOf, orgSlugOf, titleOf } from "../route"
import type { CurrentUser, Organization } from "../session"
import { hotkeyLabel } from "../shell/channels-sidebar/hotkey-label"
import { appError, appLoader, organizationNotFound } from "../shell/layouts"
import {
	ShellActivity,
	ShellChannelHeader,
	ShellChannelSidebar,
	ShellDms,
	ShellJoinBanner,
	ShellMessageList,
} from "./children"
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
import { nativePageOf } from "./native-pages"
import { Hole } from "./portal"
import { subscriptions as subscriptionsOf } from "./subscriptions"
import { AppRoute } from "./routes"
import { authOf, OrgState, Session } from "./state"

/** Read before the first render (`entry.ts`), so a stored theme or the viewport never flash. */
export interface Boot extends AppFlags {
	readonly isCreateChannelHintDismissed: boolean
	readonly aiPanel: AiPanel.Stored
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
		// A failed chunk offers a reload, as a lazy area's pending page does.
		fallback: (failed) => loader(h, failed),
	}) ?? slot(h, "page")

const appRoot = (h: H, ...children: ReadonlyArray<unknown>) =>
	h.div.attr("id", "app").children(...(children as Array<never>), slot(h, "overlays"))

interface ShellData {
	readonly orgSlug: string
	readonly user: CurrentUser
	readonly organization: Organization
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
	return [
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
						className: "flex min-h-0 flex-1 flex-col [&>[data-hz]]:min-h-0 [&>[data-hz]]:flex-1",
					},
					[
						ShellMessageList(h, {
							key: channelId,
							props: {
								channelId,
								userId: data.user.id,
								cdnUrl: currentServer().cdn ?? "https://cdn.hazel.sh",
								nowMs: model.nowMs,
							},
						}),
					],
				)
			: null,
		route._tag === "ChatChannel" && channelId !== null
			? Hole(
					h,
					{
						hole: "join-banner",
						key: channelId,
						className: "flex flex-1 flex-col items-center justify-center p-8",
					},
					[ShellJoinBanner(h, { key: channelId, props: { channelId, userId: data.user.id } })],
				)
			: null,
		route._tag === "ChatChannel" && channelId !== null
			? Hole(h, { hole: "channel-header", key: channelId }, [
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
		model.isMobile && route._tag === "ChatDms"
			? Hole(h, { hole: "dms", key: orgUser, className: "flex min-h-full flex-col" }, [
					ShellDms(h, {
						key: orgUser,
						props: {
							organizationId: data.organization.id,
							userId: data.user.id,
							orgSlug: data.orgSlug,
							nowMs: model.nowMs,
						},
					}),
				])
			: null,
	]
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
	const isResizing = model.report?.isAiPanelResizing ?? false
	return h.div
		.attr("id", "app")
		.attrs(paintAttrs(data))
		.children(
			sidebarProvider(
				h,
				isResizing ? "cursor-col-resize select-none [&_iframe]:pointer-events-none" : "",
			).children(
				sidebarDock(
					h,
					model.report?.isSidebarCollapsed ?? false,
					"overflow-hidden *:data-[sidebar=default]:flex-row",
					sidebarInner(h).children(navRail(h, rail, slot(h, "ai-toggle")), slot(h, "sidebar")),
				),
				sidebarInset(h, "").children(page(h, model)),
				slot(h, "ai-panel"),
			),
			slot(h, "overlays"),
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
						.children(page(h, model)),
					chrome.hasTabBar ? tabBar(h, rail, AppMessage.PressedMobileSearch()) : null,
				),
			),
			slot(h, "ai-panel"),
			slot(h, "overlays"),
			...children(h, model, data),
		)
}

/** `$orgSlug/layout.tsx`: a loader while `useOrganization()` loads the route's organization. */
const orgBody = (h: H, model: AppModel, user: CurrentUser) => {
	const orgSlug = orgSlugOf(model.route)
	if (orgSlug === undefined) return appRoot(h, page(h, model))
	return OrgState.match(model.org, {
		None: () => appRoot(h, loader(h, false)),
		Loading: ({ isStalled }) => appRoot(h, loader(h, isStalled)),
		NotFound: () => appRoot(h, fromKit(h, organizationNotFound(kit, orgSlug))),
		Loaded: ({ organization }) => orgShell(h, model, { orgSlug, user, organization }),
	})
}

const errorScreen = (h: H, title: string, description: string | undefined, onRetry: AppMessage) =>
	fromKit(h, appError(kit, { title, description, onRetry: "retry" }), { press: onRetry })

const body = (h: H, model: AppModel) => {
	const { route } = model
	if (route._tag === "NotFound") return h.div.attr("id", "app").children(`Not found: ${route.path}`)
	if (isPublicRoute(route)) return appRoot(h, page(h, model))
	// `_app/layout.tsx`: a loader until the API answers for the session; signed out redirects to sign-in.
	return Session.match(model.session, {
		Loading: () => appRoot(h, loader(h, false)),
		SignedOut: () => appRoot(h, loader(h, false)),
		Unreachable: ({ reason }) =>
			appRoot(
				h,
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
				onEmpty: () => appRoot(h, loader(h, false)),
				onFailure: (reason) =>
					appRoot(
						h,
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
							aiPanel: h.props.boot.aiPanel,
						}).pipe(Mount.map((out) => AppMessage.ReceivedHostOut({ out }))),
					),
				body(h, model),
			),
})
