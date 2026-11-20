import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../../styles.css"
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSettingsId, CustomerSlaPolicyId } from "@hazel/schema"
import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared, memberWithRole, uuid } from "../../../../test/pages-fixtures"
import type { Shared } from "../../../contract"
import { Message } from "./message"
import { Model, type PolicyRow } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The Support SLAs page, screenshotted in light and dark, desktop and phone width (`bun run gallery`):
 * `sla-<screen>-<theme>.png` beside the working directory.
 */

const admin = makeShared({ nowMs: Date.UTC(2026, 10, 20, 12) })
const member = makeShared({ nowMs: admin.nowMs, member: memberWithRole("member") })

const none = { accountIds: [], planNames: [], tagsAny: [] }
const target = (firstResponseMinutes: number, resolutionMinutes: number) => ({
	firstResponseMinutes,
	resolutionMinutes,
})
const policyId = (n: number) => Schema.decodeSync(CustomerSlaPolicyId)(uuid(100 + n))
const accountId = (n: number) => Schema.decodeSync(CustomerAccountId)(uuid(200 + n))

const policy = (n: number, fields: Partial<PolicyRow>): PolicyRow => ({
	id: policyId(n),
	name: `Policy ${n}`,
	position: n,
	enabled: true,
	appliesTo: none,
	targets: Customers.DEFAULT_SLA_POLICY.targets,
	hours: "business",
	warnBeforePct: 25,
	...fields,
})

const POLICIES: ReadonlyArray<PolicyRow> = [
	policy(0, {
		name: "Enterprise",
		appliesTo: { ...none, planNames: ["Enterprise"] },
		targets: {
			urgent: target(15, 4 * 60),
			high: target(30, 8 * 60),
			normal: target(60, 24 * 60),
			low: target(4 * 60, 48 * 60),
		},
		hours: "always",
	}),
	policy(1, {
		name: "Key accounts",
		appliesTo: { ...none, tagsAny: ["vip"], accountIds: [accountId(1), accountId(2)] },
	}),
	policy(2, {
		name: "Legacy plans",
		enabled: false,
		appliesTo: { ...none, planNames: ["Starter 2023", "Hobby"] },
	}),
	policy(3, { name: "Standard" }),
]

const ACCOUNTS = [
	{ id: accountId(1), name: "Acme", domain: "acme.test" },
	{ id: accountId(2), name: "Globex Corporation", domain: "globex.test" },
	{ id: accountId(3), name: "Initech", domain: "initech.test" },
]

const loaded = (shared: Shared, extra: ReadonlyArray<Message> = []): Model =>
	[
		Message.UpdatedPolicies({ policies: POLICIES }),
		Message.UpdatedSettings({
			settings: {
				settingsId: Schema.decodeSync(CustomerSettingsId)(uuid(9)),
				businessHours: { ...Customers.DEFAULT_BUSINESS_HOURS, timeZone: "Europe/Berlin" },
			},
		}),
		Message.UpdatedAccounts({ accounts: ACCOUNTS }),
		Message.SucceededFetchPlans({ plans: ["Enterprise", "Pro", "Starter 2023", "Hobby"] }),
		...extra,
	].reduce((model, message) => update(model, message, shared).model, init(null, shared).model)

const frame = <M>(h: HtmlBuilder<M>, width: number, content: Html): Html =>
	h.div(
		[
			h.Id("gallery"),
			h.Attribute("style", `width: ${width}px`),
			h.Class("bg-bg font-sans text-fg antialiased"),
		],
		[content],
	)

/** Mounts the page on Foldkit's runtime; Commands are dropped, as the gallery has no server. */
const mount = (model: Model, shared: Shared, width: number) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model }),
			update: (current: Model, message: Message) => ({ model: update(current, message, shared).model }),
			view: (current: Model, h: HtmlBuilder<Message>) => frame(h, width, view(current, { shared }, h)),
			container,
		}),
	)
}

const editing = loaded(admin, [
	Message.PressedEdit({ policyId: policyId(1) }),
	Message.ChangedAccountSearch({ value: "ini" }),
])

const screens: ReadonlyArray<readonly [string, Model, Shared, number]> = [
	["list", loaded(admin), admin, 1180],
	["editor", editing, admin, 1180],
	[
		"hours-error",
		loaded(admin, [
			...[1, 2, 3, 4, 5].map((day) => Message.ToggledDay({ day })),
			Message.ChangedEnd({ value: "08:30" }),
		]),
		admin,
		1180,
	],
	["member", loaded(member), member, 1180],
	["list-mobile", loaded(admin), admin, 390],
	["editor-mobile", editing, admin, 390],
]

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const [name, model, shared, width] of screens) {
	for (const theme of ["light", "dark"] as const) {
		test(`${name} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			await page.viewport(width, 3000)
			mount(model, shared, width)
			await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
			await new Promise((resolve) => setTimeout(resolve, 200))
			await document.fonts.ready
			const gallery = document.getElementById("gallery")
			if (gallery === null) throw new Error("The gallery did not render")
			expect(gallery.scrollWidth).toBeLessThanOrEqual(width)
			await page.screenshot({ path: `sla-${name}-${theme}.png`, element: gallery })
		})
	}
}
