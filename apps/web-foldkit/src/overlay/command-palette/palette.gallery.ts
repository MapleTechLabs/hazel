import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../styles.css"
import { ChannelId, CustomerAccountId } from "@hazel/schema"
import { Context, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { signedInShared } from "../../test/root-fixtures"
import * as CommandMenu from "../../ui/command-menu"
import { Message } from "./message"
import type { Model } from "./model"
import { init, open, update } from "./update"
import { view } from "./view"

/**
 * The command palette over fixtures, screenshotted on its home page and with a query typed, in light
 * and dark: `bun run gallery` writes `palette-<state>-<theme>.png` next to the app.
 */

type M = Message

const shared = signedInShared()
const run = (model: Model, message: Message) => update(model, message, shared).model
const searched = (value: string) =>
	Message.GotMenuMessage({ message: CommandMenu.Message.ChangedSearch({ value }) })

const channel = (n: number, name: string) => ({
	id: Schema.decodeSync(ChannelId)(`00000000-0000-4000-8000-0000000000c${n}`),
	name,
	type: "public",
	icon: null,
})
const customer = (n: number, name: string, domain: string) => ({
	id: Schema.decodeSync(CustomerAccountId)(`00000000-0000-4000-8000-0000000000a${n}`),
	name,
	domains: [domain],
	logoUrl: null,
	primaryAccountId: null,
	environment: null,
})

const base = [
	Message.UpdatedChannels({
		channels: [channel(1, "general"), channel(2, "engineering"), channel(3, "support")],
	}),
	Message.UpdatedCustomers({
		customers: [customer(1, "Acme", "acme.dev"), customer(2, "Initech", "initech.com")],
	}),
].reduce(run, open(init(), "home", shared).model)

const STATES: ReadonlyArray<readonly [string, Model]> = [
	["home", base],
	["customers", run(base, searched("cust"))],
	["support", run(base, searched("support"))],
	["settings", run(base, searched("settings"))],
]

const render = (view: (h: HtmlBuilder<M>) => Html) => {
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
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const theme of ["light", "dark"] as const)
	for (const [state, model] of STATES)
		test(`${state} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			await page.viewport(900, 900)
			document.body.className = "bg-bg font-sans text-fg antialiased"
			render((h) =>
				h.submodel({
					slotId: "command-palette",
					model,
					view,
					viewInputs: { shared },
					toParentMessage: (message) => message,
				}),
			)
			await document.fonts.ready
			const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
			await page.screenshot({ path: `${label}palette-${state}-${theme}.png` })
		})
