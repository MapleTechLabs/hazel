import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../styles.css"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { AppRoute } from "../route"
import * as Menu from "../ui/menu"
import type { SidebarChrome } from "./channels-sidebar"
import type { ShellContext } from "./context"
import { ORG_SWITCHER_ID, USER_MENU_ID } from "./menus"
import { settingsSidebar } from "./sidebars"

/**
 * The Settings sidebar on an account page and on a workspace page, light and dark
 * (`bun run gallery`). Writes `settings-sidebar-<theme>.png` (or `<VITE_GALLERY_LABEL>-...`).
 */

type M = Readonly<{ _tag: "Ignored" }>
const ignored: M = { _tag: "Ignored" }

const chrome: SidebarChrome<M> = {
	userMenu: Menu.init({ id: USER_MENU_ID, placement: "bottom right" }),
	orgSwitcher: Menu.init({ id: ORG_SWITCHER_ID }),
	userMenuEntries: [],
	orgSwitcherEntries: [],
	organizations: [],
	userStatus: null,
	statusExpiration: null,
	toUserMenuMessage: () => ignored,
	toOrgSwitcherMessage: () => ignored,
}

const contextOn = (route: AppRoute): ShellContext => ({
	orgSlug: "acme",
	route,
	organization: { name: "Acme", logoUrl: null },
	currentUser: { displayName: "Ada Lovelace", email: "ada@acme.dev", avatarUrl: null },
	appVersion: "gallery",
	paletteKey: null,
	createChannelKey: null,
})

const ROUTES: ReadonlyArray<AppRoute> = [
	AppRoute.MySettingsProfile({ orgSlug: "acme" }),
	AppRoute.SettingsGeneral({ orgSlug: "acme" }),
]

const render = (view: (h: HtmlBuilder<M>) => Html, into: HTMLElement) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		Context.make(Dispatch, dispatch).pipe(
			Context.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<M>())
		const container = document.createElement("div")
		into.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

/** One sidebar per route, each rendered on its own (their menus share ids). */
const renderScreen = () => {
	const gallery = document.createElement("div")
	gallery.id = "gallery"
	gallery.className = "inline-flex gap-6 bg-bg p-6 font-sans text-fg antialiased"
	document.body.append(gallery)
	for (const route of ROUTES)
		render(
			(h) =>
				h.div(
					[h.Class("flex h-[1040px] w-64 overflow-hidden rounded-lg border bg-sidebar")],
					[settingsSidebar(h, contextOn(route), chrome)],
				),
			gallery,
		)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const theme of ["light", "dark"] as const) {
	test(theme, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(700, 1120)
		renderScreen()
		await document.fonts.ready
		const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
		const gallery = document.getElementById("gallery")
		if (gallery === null) throw new Error("The gallery did not render")
		await page.screenshot({ path: `${label}settings-sidebar-${theme}.png`, element: gallery })
	})
}
