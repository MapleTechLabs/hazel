import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { categories, getBrandfetchIcon, type Integration, integrations } from "~/lib/integrations/__data"
import { IconPlus } from "../../../../icons"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../../ui/section-header"
import type { PageViewInputs } from "../../../contract"
import type { Connection } from "../shared/connections"
import { CHEVRON_RIGHT, fragment, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/integrations/index.tsx`. */

const connectionStatus = (h: HtmlBuilder<Message>, connected: boolean, comingSoon: boolean): Html =>
	comingSoon
		? h.div(
				[h.Class("flex items-center gap-1.5")],
				[
					h.div([h.Class("size-1.5 rounded-full bg-warning")]),
					h.span([h.Class("text-warning text-xs")], ["Coming soon"]),
				],
			)
		: h.div(
				[h.Class("flex items-center gap-1.5")],
				[
					h.div(
						[h.Class(`size-1.5 rounded-full ${connected ? "bg-success" : "bg-secondary"}`)],
					),
					h.span(
						[h.Class(`text-xs ${connected ? "text-success" : "text-muted-fg"}`)],
						[connected ? "Connected" : "Not connected"],
					),
				],
			)

const cardBody = (h: HtmlBuilder<Message>, integration: Integration, status: Html): Html => {
	const logoSrc =
		integration.logoSrc ?? getBrandfetchIcon(integration.logoDomain, { type: integration.logoType })
	return h.div(
		[h.Class("flex flex-1 flex-col gap-4 p-5")],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-3")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							h.div(
								[
									h.Class(
										"flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/8",
									),
								],
								[
									h.img([
										h.Attribute("src", logoSrc),
										h.Attribute("alt", `${integration.name} logo`),
										h.Class("size-10 object-contain"),
									]),
								],
							),
							h.div(
								[h.Class("flex flex-col gap-0.5")],
								[
									h.h3([h.Class("font-semibold text-fg text-sm")], [integration.name]),
									status,
								],
							),
						],
					),
				],
			),
			h.p([h.Class("text-muted-fg text-sm leading-relaxed")], [integration.description]),
		],
	)
}

const integrationCard = (h: HtmlBuilder<Message>, integration: Integration, connected: boolean): Html =>
	integration.comingSoon
		? h.keyed("div")(
				integration.id,
				[
					h.Class(
						"relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg opacity-70",
					),
				],
				[
					cardBody(h, integration, connectionStatus(h, false, true)),
					h.div(
						[
							h.Class(
								"flex items-center justify-end border-border border-t bg-bg-muted/50 px-5 py-3",
							),
						],
						[
							strokeIcon(h, {
								className: "size-4 text-muted-fg/50",
								strokeWidth: "2",
								d: CHEVRON_RIGHT,
							}),
						],
					),
				],
			)
		: h.keyed("button")(
				integration.id,
				[
					h.Type("button"),
					h.OnClick(Message.ClickedIntegration({ integrationId: integration.id })),
					h.Class(
						"group relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg text-left transition-all duration-200 hover:border-border-hover hover:shadow-md",
					),
				],
				[
					cardBody(h, integration, connectionStatus(h, connected, false)),
					h.div(
						[
							h.Class(
								"flex items-center justify-between border-border border-t bg-bg-muted/50 px-5 py-3",
							),
						],
						[
							h.span(
								[
									h.Class(
										"font-medium text-fg text-xs opacity-0 transition-opacity group-hover:opacity-100",
									),
								],
								["Configure"],
							),
							strokeIcon(h, {
								className:
									"size-4 text-muted-fg transition-transform group-hover:translate-x-0.5",
								strokeWidth: "2",
								d: CHEVRON_RIGHT,
							}),
						],
					),
				],
			)

/** `isIntegrationConnected`: an active OAuth connection (last row per provider wins) or a webhook. */
const isConnectedWith = (model: Model) => {
	const byProvider = new Map<string, Connection>()
	for (const connection of model.connections) byProvider.set(connection.provider, connection)
	return (integrationId: string) =>
		byProvider.get(integrationId)?.isActive === true || model.webhookProviders.includes(integrationId)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const filtered =
		model.selectedCategory === "all"
			? integrations
			: integrations.filter((integration) => integration.category === model.selectedCategory)
	const isConnected = isConnectedWith(model)

	return fragment(h, [
		sectionHeaderRoot(h, { className: "border-none pb-0" }, [
			sectionHeaderGroup(h, {}, [
				h.div(
					[h.Class("flex flex-1 flex-col justify-center gap-1")],
					[
						sectionHeaderHeading(h, {}, ["Integrations"]),
						sectionHeaderSubheading(h, {}, ["Connect your favorite tools to your workspace."]),
					],
				),
				button(
					h,
					{ intent: "secondary", size: "md", className: "shrink-0", onPress: Message.ClickedRequestIntegration() },
					[
						IconPlus(h, { attributes: { "data-slot": "icon" } }),
						"Request integration",
					],
				),
			]),
		]),
		h.div(
			[h.Class("flex flex-wrap gap-2")],
			categories.map((category) =>
				button(
					h,
					{
						intent: model.selectedCategory === category.id ? "primary" : "secondary",
						size: "sm",
						onPress: Message.ClickedCategory({ categoryId: category.id }),
					},
					[category.label],
				),
			),
		),
		h.div(
			[h.Class("grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3")],
			filtered.map((integration) => integrationCard(h, integration, isConnected(integration.id))),
		),
		...(filtered.length === 0
			? [
					emptyState(h, {
						title: "No integrations found",
						description: "No integrations found in this category.",
					}),
				]
			: []),
	])
})
