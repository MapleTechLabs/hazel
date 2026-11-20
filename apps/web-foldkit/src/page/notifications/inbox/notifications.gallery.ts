import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared, uuid } from "../../../test/pages-fixtures"
import type { Message } from "./message"
import { Model, type NotificationItem, Notifications } from "./model"
import { update } from "./update"
import { inboxView } from "./view"

/**
 * The notifications inbox with support SLA alerts beside message notifications, light and dark
 * (`bun run gallery`). Writes `notifications-sla-<theme>.png`.
 */

const NOW = Date.UTC(2026, 10, 10, 12)
const MINUTE = 60_000
const shared = makeShared({ nowMs: NOW })

const item = (n: number, fields: Partial<NotificationItem>): NotificationItem => ({
	id: Schema.decodeSync(NotificationId)(uuid(n)),
	isUnread: true,
	createdAtMs: NOW - n * 7 * MINUTE,
	resourceType: "customer_issue",
	reason: "sla_reply_breach",
	targetedResourceId: uuid(900 + n),
	targetedResourceType: "channel",
	messageContent: null,
	channel: { name: "SSO login loops back to the sign-in page", type: "thread" },
	author: null,
	...fields,
})

const ITEMS: ReadonlyArray<NotificationItem> = [
	item(1, {}),
	item(2, { reason: "sla_resolution_warning", channel: { name: "ext-acme", type: "public" } }),
	item(3, {
		isUnread: false,
		resourceType: "message",
		reason: null,
		messageContent: "Pushed the fix for the EU dashboards, can you confirm?",
		channel: { name: "ext-acme", type: "public" },
		author: { firstName: "Maya", lastName: "Reinhardt", avatarUrl: null },
	}),
]

const MODEL: Model = { category: "all", notifications: Notifications.Loaded({ items: ITEMS }) }

const render = () => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model: MODEL }),
			update: (model: Model, message: Message) => ({ model: update(model, message).model }),
			view: (model: Model, h: HtmlBuilder<Message>) =>
				h.div(
					[h.Id("gallery"), h.Class("w-[720px] bg-bg py-6 font-sans text-fg antialiased")],
					[inboxView(model, { shared }, h)],
				),
			container,
		}),
	)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const theme of ["light", "dark"] as const) {
	test(`sla alerts ${theme}`, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(800, 700)
		render()
		await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
		await new Promise((resolve) => setTimeout(resolve, 200))
		await document.fonts.ready
		const gallery = document.getElementById("gallery")
		if (gallery === null) throw new Error("The inbox did not render")
		await page.screenshot({ path: `notifications-sla-${theme}.png`, element: gallery })
	})
}
