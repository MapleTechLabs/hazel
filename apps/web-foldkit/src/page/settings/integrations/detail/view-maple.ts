import type { Html, HtmlBuilder } from "foldkit/html"
import { buttonClassName } from "../../../../ui/button"
import { CHECK, strokeIcon } from "../shared/view"
import { panel } from "./view-connection"

/**
 * Maple is two things in Hazel, both through one bot: an AI agent you ask in a channel (installed
 * from Maple through `/oauth/bot-install`) and the alerts it posts in channels you pick. Both are set up
 * from Maple, because the link starts there (Maple's org owns the request), so this page shows
 * what is connected and sends you to the right place in Maple, in either region.
 */

/** Maple's own bots in production Hazel, one per Maple region. */
export const MAPLE_BOT_IDS: ReadonlyArray<string> = [
	"ca08852a-fb2e-4df9-8602-519e7ec3b9bf",
	"de89c591-fcf9-4ff7-a13e-0118180bfc99",
]

const MAPLE_APPS = {
	us: "https://app.maple.dev",
	eu: "https://app.eu.maple.dev",
} as const

/** Maple's integrations page, opened on its Hazel entry, where the bot is installed. */
export const mapleIntegrationUrl = (region: keyof typeof MAPLE_APPS): string =>
	`${MAPLE_APPS[region]}/integrations?integration=chat-hazel`

/** Maple's alert routing, where a Hazel channel is added as a destination once the bot is in. */
export const mapleAlertsUrl = (region: keyof typeof MAPLE_APPS): string =>
	`${MAPLE_APPS[region]}/alerts?tab=routing`

const external = { rel: "noopener noreferrer", target: "_blank" }

const linkButton = <M>(h: HtmlBuilder<M>, href: string, label: string, intent: "primary" | "outline"): Html =>
	h.a(
		[
			h.Href(href),
			h.Attribute("rel", external.rel),
			h.Attribute("target", external.target),
			h.Class(buttonClassName({ intent, size: "sm" })),
		],
		[label],
	)

/** "Using Maple's EU region?" — the same place in the other instance. */
const euLink = <M>(h: HtmlBuilder<M>, href: string, label: string): Html =>
	h.p(
		[h.Class("text-muted-fg text-xs")],
		[
			"On Maple's EU region? ",
			h.a(
				[
					h.Href(href),
					h.Attribute("rel", external.rel),
					h.Attribute("target", external.target),
					h.Class("text-fg underline underline-offset-2"),
				],
				[label],
			),
		],
	)

const steps = <M>(h: HtmlBuilder<M>, items: ReadonlyArray<string>): Html =>
	h.ol(
		[h.Class("flex flex-col gap-2 text-muted-fg text-sm")],
		items.map((item, index) =>
			h.keyed("li")(
				item,
				[h.Class("flex gap-2.5")],
				[
					h.span(
						[
							h.Class(
								"flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-fg text-xs",
							),
						],
						[String(index + 1)],
					),
					h.span([], [item]),
				],
			),
		),
	)

const installedNote = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class("flex items-start gap-2.5 rounded-lg bg-success-subtle p-3 text-sm")],
		[
			strokeIcon(h, {
				className: "mt-0.5 size-4 shrink-0 text-success-subtle-fg",
				strokeWidth: "3",
				d: CHECK,
			}),
			h.p(
				[h.Class("text-success-subtle-fg")],
				[
					"Maple is installed in this workspace. Mention ",
					h.span([h.Class("font-medium")], ["@Maple"]),
					" in any channel and it answers in a thread.",
				],
			),
		],
	)

const agentPanel = <M>(h: HtmlBuilder<M>, isInstalled: boolean): Html =>
	panel(h, "AI agent", [
		h.div(
			[h.Class("flex flex-col gap-4")],
			isInstalled
				? [
						installedNote(h),
						h.p(
							[h.Class("text-muted-fg text-sm")],
							[
								"Ask about errors, slow endpoints, traces and logs. When Maple proposes a change, anyone here can approve it with the buttons on its message.",
							],
						),
						h.div(
							[h.Class("flex flex-wrap items-center gap-3")],
							[linkButton(h, mapleIntegrationUrl("us"), "Manage in Maple", "outline")],
						),
						euLink(h, mapleIntegrationUrl("eu"), "Manage in Maple EU"),
					]
				: [
						h.p(
							[h.Class("text-muted-fg text-sm")],
							[
								"Ask Maple about your services right here: mention @Maple in a channel and it investigates your traces, logs and errors, then answers in a thread.",
							],
						),
						steps(h, [
							"Open the Hazel integration in Maple and click Connect.",
							"Pick this workspace and approve the install.",
							"Mention @Maple in any channel.",
						]),
						h.div(
							[h.Class("flex flex-wrap items-center gap-3")],
							[linkButton(h, mapleIntegrationUrl("us"), "Connect in Maple", "primary")],
						),
						euLink(h, mapleIntegrationUrl("eu"), "Connect in Maple EU"),
					],
		),
	])

const alertsPanel = <M>(h: HtmlBuilder<M>): Html =>
	panel(h, "Alerts", [
		h.div(
			[h.Class("flex flex-col gap-4")],
			[
				h.p(
					[h.Class("text-muted-fg text-sm")],
					[
						"Maple posts alerts through the same bot when error rates spike, latency degrades or a custom rule trips. Once the bot is installed, pick the channels in Maple's alert routing.",
					],
				),
				h.div(
					[h.Class("flex flex-wrap items-center gap-3")],
					[linkButton(h, mapleAlertsUrl("us"), "Set up alerts in Maple", "outline")],
				),
				euLink(h, mapleAlertsUrl("eu"), "Set up alerts in Maple EU"),
			],
		),
	])

/** The Maple page's main column: the agent, then alerts. */
export const mapleColumn = <M>(h: HtmlBuilder<M>, isInstalled: boolean): ReadonlyArray<Html> => [
	agentPanel(h, isInstalled),
	alertsPanel(h),
]
