import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { categories, type Integration, integrations } from "~/lib/integrations/__data"
import { IconPlus } from "../../../../icons"
import { ariaButton, button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { cardClassName } from "../../../../ui/card"
import { pageHeader } from "../../../../ui/page-header"
import { type StatusTone, statusLine } from "../../../../ui/status-dot"
import type { PageViewInputs } from "../../../contract"
import type { Connection } from "../shared/connections"
import { CHEVRON_RIGHT, fragment, integrationLogo, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"
import { heading } from "../../../../ui/heading"

/** Port of `routes/_app/$orgSlug/settings/integrations/index.tsx`. */

type Status = "connected" | "disconnected" | "coming-soon"

const STATUS: Readonly<Record<Status, { readonly label: string; readonly tone: StatusTone }>> = {
	connected: { label: "Connected", tone: "success" },
	disconnected: { label: "Not connected", tone: "neutral" },
	"coming-soon": { label: "Coming soon", tone: "neutral" },
}

const connectionStatus = (h: HtmlBuilder<Message>, status: Status): Html =>
	statusLine(h, { tone: STATUS[status].tone }, STATUS[status].label)

const cardContent = (h: HtmlBuilder<Message>, integration: Integration, status: Status): Array<Html> => [
	h.div(
		[h.Class("flex items-center gap-3")],
		[
			integrationLogo(h, integration, "md"),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
				[
					heading(h, { variant: "subsection", className: "truncate" }, [integration.name]),
					connectionStatus(h, status),
				],
			),
			...(status === "coming-soon"
				? []
				: [
						strokeIcon(h, {
							className:
								"size-4 shrink-0 text-muted-fg opacity-0 transition duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100",
							strokeWidth: "2",
							d: CHEVRON_RIGHT,
						}),
					]),
		],
	),
	h.p([h.Class("text-muted-fg text-sm leading-relaxed")], [integration.description]),
]

const CARD = "flex flex-col gap-4 p-5 text-left"

const integrationCard = (h: HtmlBuilder<Message>, integration: Integration, connected: boolean): Html =>
	integration.comingSoon
		? h.keyed("div")(
				integration.id,
				[h.Class(cardClassName(`${CARD} bg-bg-muted/30`))],
				cardContent(h, integration, "coming-soon"),
			)
		: ariaButton(
				h,
				{
					className: cardClassName(
						`${CARD} group cursor-pointer outline-none transition-colors duration-150 hover:border-border-hover hover:bg-bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring`,
					),
					onPress: Message.ClickedIntegration({ integrationId: integration.id }),
					attributes: [h.Key(integration.id)],
				},
				cardContent(h, integration, connected ? "connected" : "disconnected"),
			)

/**
 * `isIntegrationConnected`: an active OAuth connection (last row per provider wins) or a webhook. The
 * member's own connections count too (T3 Code is linked per member).
 */
const isConnectedWith = (model: Model) => {
	const byProvider = new Map<string, Connection>()
	for (const connection of [...model.connections, ...model.userConnections])
		byProvider.set(connection.provider, connection)
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
		pageHeader(h, {
			title: "Integrations",
			subtitle: "Connect your favorite tools to your workspace.",
			size: "title",
			actions: [
				button(
					h,
					{
						intent: "secondary",
						size: "md",
						className: "shrink-0",
						onPress: Message.ClickedRequestIntegration(),
					},
					[IconPlus(h, { attributes: { "data-slot": "icon" } }), "Request integration"],
				),
			],
		}),
		h.div(
			[h.Class("flex flex-wrap gap-1")],
			categories.map((category) =>
				button(
					h,
					{
						intent: model.selectedCategory === category.id ? "secondary" : "plain",
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
