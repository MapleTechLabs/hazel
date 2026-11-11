import type { Html, HtmlBuilder } from "foldkit/html"
import { button, buttonClassName } from "../../../../ui/button"
import { CHECK, strokeIcon } from "../shared/view"
import type { MapleInstall } from "./model"
import { panel } from "./view-connection"

/**
 * Maple is two things in Hazel, both through one bot: an AI agent you ask in a channel (installed
 * from Maple through `/oauth/bot-install`) and the alerts it posts in channels you pick. Both are set up
 * from Maple, because the link starts there (Maple's org owns the request), so this page shows
 * what is connected, sends you to the right place in Maple, in the region that owns the install,
 * and removes the bot. It is not listed in Installed Apps (`../shared/integration-bots.ts`).
 */

const MAPLE_APPS = {
	us: "https://app.maple.dev",
	eu: "https://app.eu.maple.dev",
} as const

type MapleRegion = keyof typeof MAPLE_APPS

/** The Maple region an install belongs to, when it says (`null`: before regions, or the default). */
const regionOf = (install: MapleInstall): MapleRegion | null =>
	install.region === "eu" ? "eu" : install.region === null ? null : "us"

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

export interface MapleColumnOptions<M> {
	readonly install: MapleInstall | null
	readonly isUninstalling: boolean
	readonly onUninstall: M
}

const installedActions = <M>(h: HtmlBuilder<M>, options: MapleColumnOptions<M>, install: MapleInstall) => {
	const region = regionOf(install)
	return [
		h.div(
			[h.Class("flex flex-wrap items-center gap-3")],
			[
				linkButton(h, mapleIntegrationUrl(region ?? "us"), "Manage in Maple", "outline"),
				button(
					h,
					{
						intent: "danger",
						size: "sm",
						onPress: options.onUninstall,
						isDisabled: options.isUninstalling,
					},
					[options.isUninstalling ? "Removing..." : "Remove from workspace"],
				),
			],
		),
		// An install that names its region links straight there; an older one offers both.
		...(region === null ? [euLink(h, mapleIntegrationUrl("eu"), "Manage in Maple EU")] : []),
	]
}

const agentPanel = <M>(h: HtmlBuilder<M>, options: MapleColumnOptions<M>): Html =>
	panel(h, "AI agent", [
		h.div(
			[h.Class("flex flex-col gap-4")],
			options.install !== null
				? [
						installedNote(h),
						h.p(
							[h.Class("text-muted-fg text-sm")],
							[
								"Ask about errors, slow endpoints, traces and logs. When Maple proposes a change, anyone here can approve it with the buttons on its message.",
							],
						),
						...installedActions(h, options, options.install),
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

const alertsPanel = <M>(h: HtmlBuilder<M>, region: MapleRegion | null): Html =>
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
					[linkButton(h, mapleAlertsUrl(region ?? "us"), "Set up alerts in Maple", "outline")],
				),
				...(region === null ? [euLink(h, mapleAlertsUrl("eu"), "Set up alerts in Maple EU")] : []),
			],
		),
	])

/** The Maple page's main column: the agent, then alerts. */
export const mapleColumn = <M>(h: HtmlBuilder<M>, options: MapleColumnOptions<M>): ReadonlyArray<Html> => [
	agentPanel(h, options),
	alertsPanel(h, options.install === null ? null : regionOf(options.install)),
]
