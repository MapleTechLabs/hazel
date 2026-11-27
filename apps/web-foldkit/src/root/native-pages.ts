// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Routes whose page is an Effect UI component (a native page): the shell draws it where the frame
 * shows the page, and the Foldkit host has no page for it. Converting a page is one entry here and
 * deleting its Foldkit page. Each page is `Component.lazy`, so it loads as its own chunk.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { ClientData } from "@hazel/client-data"
import type { Session } from "@hazel/shared-screens/app/session"
import { Layer } from "effect"
import { clientData } from "~/db/client"
import { type AppRoute, hrefOf, type RouteOf, signInHref } from "../route"
import { ShellDms } from "./children"
import type { AppMessage } from "./message"

// The `import()`s are the only references to the pages' modules: a static import undoes the split.
export const InvitePage = Component.lazy("InvitePage", () =>
	import("@hazel/shared-screens/auth/pages/invite/InvitePage").then((module) => module.InvitePage),
)

/** The app's one data instance, for pages that run live queries. */
const withClientData = <C extends Component.Any>(component: C) =>
	Component.provide(component, Layer.succeed(ClientData, clientData))

export const ChatIndexPage = Component.lazy("ChatIndexPage", () =>
	import("@hazel/shared-screens/chat/pages/ChatIndexPage").then((module) =>
		withClientData(module.ChatIndexPage),
	),
)

export const ChatDmsPage = Component.lazy("ChatDmsPage", () =>
	import("@hazel/shared-screens/chat/pages/dms/ChatDmsPage").then((module) =>
		withClientData(module.ChatDmsPage),
	),
)

/** What a native page reads: its route and the session, from the shell's Model. */
export interface NativeInputs<Tag extends AppRoute["_tag"]> {
	readonly route: RouteOf<Tag>
	readonly session: Session
	/** The shell's phone layout (`(max-width: 767px)`), and its clock. */
	readonly isMobile: boolean
	readonly nowMs: number
	/** Shown while the page's chunk loads, and if the load fails. */
	readonly fallback: (failed: boolean) => View.Content<AppMessage, any>
}

type NativePage<Tag extends AppRoute["_tag"]> = (
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
) => View.Content<AppMessage, any> | null

type Registry = { readonly [Tag in AppRoute["_tag"]]?: NativePage<Tag> }

/** Keyed by what makes a new instance (Foldkit's page `key`): a new token mounts a fresh page. */
const nativePages: Registry = {
	Invite: (h, { route, session, fallback }) =>
		InvitePage(h, {
			key: route.token,
			props: { token: route.token, session, signInHref: signInHref(hrefOf(route)) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	// A phone shows the shell's channel list here (`app/view.ts`), so only a wide screen is native.
	ChatIndex: (h, { route, session, isMobile, fallback }) =>
		isMobile
			? null
			: ChatIndexPage(h, {
					key: route.orgSlug,
					props: { session },
					fallback: (result) => fallback(result._tag === "Failure"),
				}),
	// The phone's DMs tab is the shared DMs screen; a wide screen the cards page.
	ChatDms: (h, { route, session, isMobile, nowMs, fallback }) => {
		const { organization, user } = session
		if (!isMobile)
			return ChatDmsPage(h, {
				key: route.orgSlug,
				props: { session },
				fallback: (result) => fallback(result._tag === "Failure"),
			})
		return organization === null || user === null
			? fallback(false)
			: // As today's hole: the screen keeps its content's height, so compose follows the last row.
				h.div.children(
					ShellDms(h, {
						key: `${organization.id}:${user.id}`,
						props: {
							organizationId: organization.id,
							userId: user.id,
							orgSlug: route.orgSlug,
							nowMs,
						},
					}),
				)
	},
}

/** The parity flag of a route's native page: `"0"` draws today's Foldkit page instead (`compare-pages.ts`). */
export const parityFlag = (tag: AppRoute["_tag"]) => `hazel:native:${tag}`

// The parity runner sets the flag before the app loads.
const forcedOff = (tag: AppRoute["_tag"]): boolean =>
	typeof localStorage !== "undefined" && localStorage.getItem(parityFlag(tag)) === "0"

export const isNativeRoute = (route: AppRoute): boolean =>
	nativePages[route._tag] !== undefined && !forcedOff(route._tag)

/** The route's native page, or null when the Foldkit host still draws it (also at a size a page leaves to it). */
export const nativePageOf = <Tag extends AppRoute["_tag"]>(
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
): View.Content<AppMessage, any> | null => {
	const page = nativePages[inputs.route._tag] as NativePage<Tag> | undefined
	return page === undefined || forcedOff(inputs.route._tag) ? null : page(h, inputs)
}
