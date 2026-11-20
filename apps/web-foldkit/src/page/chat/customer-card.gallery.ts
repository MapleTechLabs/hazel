import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../styles.css"
import type { ChannelCustomer } from "@hazel/domain/models"
import type { ChannelId, CustomerAccountId, CustomerSignalId, OrganizationId, UserId } from "@hazel/schema"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import * as CustomerCard from "./customer-card"
import { chatHeaderView } from "./header"

/**
 * The linked channel's customer at a glance (`customer-card.ts`): the header chip and the card in
 * each state the PR shows (populated, many signals, unknown health, a new customer, no customer),
 * desktop and phone width, light and dark (`bun run gallery`). Writes `customer-card-<theme>.png`.
 */

type M = Readonly<{ _tag: "Ignored" }>
const ignored: M = { _tag: "Ignored" }

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

const NOW = Date.parse("2026-11-20T12:00:00Z")
const ORG = "0b8f7c1e-3a52-4f8e-9a51-6f1c2d3e4a5b" as OrganizationId

const signal = (n: number, title: string, reason: string, severity: "high" | "medium" | "low") => ({
	id: `00000000-0000-4000-8000-00000000000${n}` as CustomerSignalId,
	title,
	reason,
	kind: "risk" as const,
	severity,
})

const base: ChannelCustomer.Type = {
	channelId: "1c9d0b8e-7e43-4d1a-8f0b-2a3b4c5d6e7f" as ChannelId,
	organizationId: ORG,
	accountId: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d" as CustomerAccountId,
	accountName: "Acme Corp",
	accountLogoUrl: null,
	healthStatus: "at_risk",
	healthScore: 48,
	healthWhy: "No sign-ins for 18 days; 12 weekly active users before",
	lifecycleStage: "active",
	planName: "Pro",
	mrrMinor: 240_000,
	currency: "usd",
	ownerUserId: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a" as UserId,
	seatsUsed: 18,
	seatsLimit: 25,
	lastActiveDay: "2026-11-17",
	openSignalCount: 2,
	topSignals: [
		signal(1, "Payment failed", "Invoice INV-2041 for $2,400 is 9 days past due", "high"),
		signal(2, "Usage dropped", "Daily active users down 42% vs the previous 4 weeks", "medium"),
	],
	sourceLinks: [
		{
			provider: "clerk",
			url: "https://dashboard.clerk.com/apps/app_1/instances/ins_1/organizations/org_1",
		},
		{ provider: "stripe", url: "https://dashboard.stripe.com/customers/cus_1" },
		{ provider: "maple", url: "https://app.maple.dev/groups/org_1" },
	],
	updatedAt: new Date(NOW),
}

const manySignals: ChannelCustomer.Type = {
	...base,
	accountName: "Globex International Holdings",
	healthStatus: "critical",
	healthScore: 22,
	healthWhy: "Subscription past due; 3 high-severity risk signals open",
	lifecycleStage: "past_due",
	openSignalCount: 9,
	topSignals: [
		signal(3, "Payment failed", "Card declined twice; retry in 2 days", "high"),
		signal(4, "Cancellation scheduled", "Cancels at period end on Dec 3", "high"),
		signal(5, "Champion inactive", "Maya Chen (most active) last seen 16 days ago", "high"),
	],
}

const unknownHealth: ChannelCustomer.Type = {
	...base,
	accountName: "Initech",
	healthStatus: "unknown",
	healthScore: null,
	healthWhy: null,
	lifecycleStage: "trialing",
	planName: "Team trial",
	mrrMinor: 0,
	ownerUserId: null,
	seatsUsed: null,
	seatsLimit: null,
	lastActiveDay: null,
	openSignalCount: 0,
	topSignals: [],
	sourceLinks: [
		{
			provider: "clerk",
			url: "https://dashboard.clerk.com/apps/app_1/instances/ins_1/organizations/org_2",
		},
	],
}

const context = (customer: ChannelCustomer.Type): CustomerCard.CardContext => ({
	customer,
	ownerName: customer.ownerUserId === null ? null : "Maya Chen",
	customerHref: "#customer",
	queueHref: "#queue",
	nowMs: NOW,
})

const header = (
	h: HtmlBuilder<M>,
	customer: ChannelCustomer.Type | null,
	isMobile: boolean,
	phase: CustomerCard.Phase,
) =>
	chatHeaderView(h, {
		channel: {
			id: base.channelId,
			name: customer === null ? "general" : "acme-support",
			type: "public",
			icon: null,
			organizationId: ORG,
			parentChannelId: null,
		},
		syncProvider: customer === null ? null : "slack",
		parentChannel: null,
		orgSlug: "hazel",
		isMember: true,
		otherMembers: [],
		isHiddenDm: false,
		dmPresence: null,
		pinnedTrigger: h.empty,
		mobileBack: h.empty,
		customerChip:
			customer === null
				? null
				: CustomerCard.chip(h, {
						customer,
						isOpen: phase === "pinned",
						isMobile,
						toMessage: () => ignored,
					}),
	})

/** A frame like the chat's: the header, and the card where it opens under the chip. */
const frame = (
	h: HtmlBuilder<M>,
	label: string,
	customer: ChannelCustomer.Type | null,
	options: Readonly<{ width: number; isMobile?: boolean }>,
) =>
	h.figure(
		[h.Class("flex flex-col gap-2")],
		[
			h.figcaption([h.Class("text-muted-fg text-xs")], [label]),
			h.div(
				[
					h.Class("relative overflow-hidden rounded-xl border border-border bg-bg"),
					h.Style({ width: `${options.width}px`, height: options.isMobile ? "720px" : "640px" }),
				],
				[
					header(h, customer, options.isMobile ?? false, customer === null ? "closed" : "pinned"),
					...(customer === null
						? [
								h.p(
									[h.Class("p-4 text-muted-fg text-sm")],
									["No customer linked: no chip, no card."],
								),
							]
						: options.isMobile
							? [
									h.div([h.Class("absolute inset-0 top-14 bg-black/30")]),
									h.div(
										[
											h.Class(
												"absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-border border-t bg-overlay text-sm shadow-md",
											),
										],
										[CustomerCard.cardBody(h, context(customer))],
									),
								]
							: [
									h.div(
										[h.Class("absolute top-14 left-12 w-88 pt-1.5")],
										[
											h.div(
												[
													h.Class(
														"overflow-hidden rounded-xl border border-border bg-overlay text-sm shadow-md",
													),
												],
												[CustomerCard.cardBody(h, context(customer))],
											),
										],
									),
								]),
				],
			),
		],
	)

const screen = (h: HtmlBuilder<M>) =>
	h.div(
		[
			h.Id("gallery"),
			h.Class("flex w-[1720px] flex-wrap items-start gap-6 bg-bg p-8 font-sans text-fg antialiased"),
		],
		[
			frame(h, "Desktop · at risk", base, { width: 520 }),
			frame(h, "Desktop · many signals", manySignals, { width: 520 }),
			frame(h, "Desktop · unknown health, new customer", unknownHealth, { width: 520 }),
			frame(h, "Desktop · no customer", null, { width: 520 }),
			frame(h, "Phone · sheet", base, { width: 400, isMobile: true }),
			frame(h, "Phone · many signals", manySignals, { width: 400, isMobile: true }),
		],
	)

for (const theme of ["light", "dark"] as const) {
	test(theme, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(1720, 1500)
		render(screen)
		await document.fonts.ready
		const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
		const gallery = document.getElementById("gallery")
		if (gallery === null) throw new Error("The gallery did not render")
		await page.screenshot({ path: `${label}customer-card-${theme}.png`, element: gallery })
	})
}
