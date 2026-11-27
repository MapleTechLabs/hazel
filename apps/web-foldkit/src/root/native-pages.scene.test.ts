// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { HtmlScene } from "@effect/ui/html/testing"
import { Locator } from "@effect/ui/testing"
import { AppRequest } from "@hazel/shared-screens/app/requests"
import { describe, expect, test } from "vitest"
import {
	ada,
	callsOf,
	flagsOf,
	hostRequestsOf,
	namesOf,
	navigationsOf,
	sessionMessages,
	shellAfter,
	shellBoot,
	shellSignedIn,
} from "../test/root-fixtures"
import { App, type Boot } from "./app"
import { update } from "./logic"
import { AppMessage } from "./message"
import { BotInstallPage, InvitePage, isNativeRoute, JoinPage, OAuthAuthorizePage } from "./native-pages"
import { AppRoute } from "./routes"

/** A route with a native page: the shell draws it, and the Foldkit host's page region stays out. */

const boot: Boot = {
	...flagsOf(),
	isCreateChannelHintDismissed: false,
	aiPanel: { isOpen: false, width: null },
}
const TOKEN = "tok_abcdefghijklmnop"
const pageSlot = Locator.attr("data-foldkit-slot", "page")

const shell = (path: string, messages: ReadonlyArray<AppMessage> = []) => {
	const model = shellAfter(shellBoot(path), messages)
	return HtmlScene.start(App, { route: model.route, boot }).given(model)
}

interface ChildNode {
	readonly _tag: "Child"
	readonly component: unknown
	readonly key?: string
	readonly props: Record<string, unknown>
}

/** The component children the view declares (a scene keeps them as leaves). */
const childrenOf = (node: unknown): ReadonlyArray<ChildNode> => {
	if (typeof node !== "object" || node === null) return []
	const { _tag, children } = node as { readonly _tag?: string; readonly children?: ReadonlyArray<unknown> }
	if (_tag === "Child") return [node as ChildNode]
	return (children ?? []).flatMap(childrenOf)
}
const invitePagesIn = (s: ReturnType<typeof shell>) =>
	childrenOf(s.current.root).filter((child) => child.component === InvitePage)

describe("a native page", () => {
	test("is the shell's own child where the page goes, with no Foldkit page region", () => {
		const s = shell(`/invite/${TOKEN}`).expect(pageSlot).toBeAbsent()
		expect(invitePagesIn(s)).toMatchObject([
			{
				key: TOKEN,
				props: {
					token: TOKEN,
					session: { auth: "Loading", user: null },
					signInHref: `/sign-in?redirect_url=%2Finvite%2F${TOKEN}`,
				},
			},
		])
	})

	test("reads the session from the shell as it loads", () => {
		const [signedIn, user] = sessionMessages()
		const s = shell(`/invite/${TOKEN}`, [signedIn!, user!])
		expect(invitePagesIn(s)[0]?.props["session"]).toMatchObject({
			auth: "SignedIn",
			user: { id: ada.id },
		})
	})

	test("a Foldkit route keeps the host's page region", () => {
		expect(isNativeRoute(AppRoute.Invite({ token: TOKEN }))).toBe(true)
		const s = shell("/hazel/notifications", sessionMessages()).expect(pageSlot).toExist()
		expect(invitePagesIn(s)).toEqual([])
	})

	test("join, OAuth consent and bot install are native, their links parsed for the page", () => {
		const join = shell("/join/hazel").expect(pageSlot).toBeAbsent()
		expect(
			childrenOf(join.current.root).find((child) => child.component === JoinPage)?.props,
		).toMatchObject({
			slug: "hazel",
			signInHref: "/sign-in?redirect_url=%2Fjoin%2Fhazel",
		})
		const install = shell("/oauth/bot-install").expect(pageSlot).toBeAbsent()
		expect(
			childrenOf(install.current.root).find((child) => child.component === BotInstallPage)?.props,
		).toMatchObject({ request: null })
		const consent = shell("/oauth/authorize").expect(pageSlot).toBeAbsent()
		expect(
			childrenOf(consent.current.root).find((child) => child.component === OAuthAuthorizePage)?.props,
		).toMatchObject({ request: null })
	})
})

describe("a native page's requests", () => {
	const request = (appRequest: AppRequest) =>
		update(shellSignedIn("/hazel/chat"), AppMessage.ReceivedAppRequest({ request: appRequest }))
	const toast = { intent: "success", title: "Joined", description: null } as const

	test("navigate in the app, or load another URL in full", () => {
		expect(
			navigationsOf(request(AppRequest.Navigate({ href: "/hazel/settings", replace: true })).commands),
		).toEqual(["replace /hazel/settings"])
		expect(callsOf(request(AppRequest.LoadPage({ href: "/hazel" })).commands)).toEqual([
			{ name: "LoadExternal", args: { href: "/hazel" } },
		])
		const away = request(AppRequest.Navigate({ href: "https://example.com", replace: false, toast }))
		expect(hostRequestsOf(away.commands)).toEqual([{ _tag: "RequestedToast", toast }])
		expect(namesOf(away.commands)).toContain("LoadExternal")
	})

	test("sign out, toast and history act as a Foldkit page's would", () => {
		expect(namesOf(request(AppRequest.SignOut()).commands)).toEqual(["shell/SignOut"])
		expect(hostRequestsOf(request(AppRequest.ShowToast({ toast })).commands)).toEqual([
			{ _tag: "RequestedToast", toast },
		])
		expect(namesOf(request(AppRequest.History({ direction: "Back" })).commands)).toEqual([
			"@effect/ui/Router/Back",
		])
	})

	test("a modal opens in the root; an unknown modal opens nothing", () => {
		const feedback = request(AppRequest.OpenModal({ modal: { _tag: "Feedback" } }))
		expect(hostRequestsOf(feedback.commands)).toEqual([])
		expect(feedback.model.modal?.request).toEqual({ _tag: "Feedback" })
		expect(request(AppRequest.OpenModal({ modal: { _tag: "NoSuchModal" } })).commands).toEqual([])
		// The palette is the shell's own child (`palette.ts`).
		const palette = request(AppRequest.OpenCommandPalette({ page: "search" }))
		expect(palette.commands).toEqual([])
		expect(palette.model.palette).toMatchObject({ page: "search", isOpen: true })
	})
})
