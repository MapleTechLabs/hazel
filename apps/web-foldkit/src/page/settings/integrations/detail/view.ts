import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getBrandfetchIcon, getIntegrationById, type Integration } from "~/lib/integrations/__data"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../../ui/section-header"
import type { PageViewInputs } from "../../../contract"
import { CHECK, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"
import {
	apiKeyConnectionForm,
	configOptionRow,
	connectedState,
	disconnectedState,
	verifyingState,
} from "./view-connection"

/** Port of `routes/_app/$orgSlug/settings/integrations/$integrationId.tsx`. */

type H = HtmlBuilder<Message>

const WEBHOOK_INTEGRATIONS = ["openstatus", "railway", "rss", "maple"]

const panel = (h: H, title: string, body: ReadonlyArray<Html>, bodyClass = "p-5"): Html =>
	h.div(
		[h.Class("overflow-hidden rounded-xl border border-border bg-bg")],
		[
			h.div(
				[h.Class("border-border border-b bg-bg-muted/30 px-5 py-3")],
				[h.h3([h.Class("font-semibold text-fg text-sm")], [title])],
			),
			h.div([h.Class(bodyClass)], [...body]),
		],
	)

const connectionBadge = (h: H, connected: boolean): Html =>
	h.span(
		[
			h.Class(
				`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 font-medium text-xs ${
					connected ? "bg-success-subtle text-success-subtle-fg" : "bg-muted text-muted-fg"
				}`,
			),
		],
		[
			h.span([h.Class(`size-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-fg"}`)], []),
			connected ? "Connected" : "Not connected",
		],
	)

/** Not ported yet: the per-channel webhook content and the GitHub repository and subscription sections. */
const unported = (h: H, name: string): Html => h.div([h.Attribute("data-page-placeholder", name)], [])

const header = (h: H, integration: Integration, isWebhook: boolean, isConnected: boolean): Html =>
	sectionHeaderRoot(h, { className: "border-none pb-0" }, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex items-center gap-4")],
				[
					h.div(
						[
							h.Class(
								"flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-black/8",
							),
							h.Style({ backgroundColor: `${integration.brandColor}10` }),
						],
						[
							h.img([
								h.Attribute(
									"src",
									integration.logoSrc ??
										getBrandfetchIcon(integration.logoDomain, {
											theme: "light",
											type: integration.logoType,
										}),
								),
								h.Attribute("alt", `${integration.name} logo`),
								h.Class("size-12 object-contain"),
							]),
						],
					),
					h.div(
						[h.Class("flex flex-col gap-1")],
						[
							h.div(
								[h.Class("flex items-center gap-3")],
								[
									sectionHeaderHeading(h, {}, [integration.name]),
									...(isWebhook ? [] : [connectionBadge(h, isConnected)]),
								],
							),
							sectionHeaderSubheading(h, {}, [integration.description]),
						],
					),
				],
			),
		]),
	])

const mainColumn = (h: H, integration: Integration, model: Model, hasOrganization: boolean) => {
	const isConnected = model.connection?.isActive === true
	if (WEBHOOK_INTEGRATIONS.includes(integration.id))
		return hasOrganization ? [unported(h, `IntegrationContent:${integration.id}`)] : []
	if (integration.connectionType === "api-key")
		return [
			panel(h, "Connection", [
				isConnected
					? connectedState(h, integration, model, { canConfigure: false })
					: apiKeyConnectionForm(h, integration, model),
			]),
		]
	const isVerifying = model.pendingVerification && !isConnected
	return [
		panel(h, "Connection", [
			isVerifying
				? verifyingState(h, integration)
				: isConnected
					? connectedState(h, integration, model, { canConfigure: true })
					: disconnectedState(h, integration, model.isConnecting),
		]),
		...(isConnected
			? [
					panel(
						h,
						"Configuration",
						integration.configOptions.map((option) =>
							configOptionRow(h, option, model.enabledOptionIds.includes(option.id)),
						),
						"flex flex-col divide-y divide-border",
					),
				]
			: []),
		...(isConnected && integration.id === "github" && hasOrganization
			? [unported(h, "GitHubRepositoryAccess"), unported(h, "GitHubSubscriptions")]
			: []),
	]
}

const featuresPanel = (h: H, integration: Integration): Html =>
	h.div(
		[h.Class("lg:sticky lg:top-6 lg:self-start")],
		[
			panel(h, "Features", [
				h.p([h.Class("mb-4 text-muted-fg text-sm leading-relaxed")], [integration.fullDescription]),
				h.ul(
					[h.Class("flex flex-col gap-2.5")],
					integration.features.map((feature) =>
						h.keyed("li")(
							feature,
							[h.Class("flex items-center gap-2.5 text-sm")],
							[
								h.div(
									[h.Class("flex size-5 shrink-0 items-center justify-center rounded-sm bg-success-subtle")],
									[strokeIcon(h, { className: "size-3 text-success-subtle-fg", strokeWidth: "3", d: CHECK })],
								),
								h.span([h.Class("text-fg")], [feature]),
							],
						),
					),
				),
			]),
		],
	)

const backLink = (h: H): Html =>
	h.button(
		[
			h.Type("button"),
			h.OnClick(Message.ClickedBack()),
			h.Class("-ml-1 flex w-fit items-center gap-1 text-muted-fg text-sm transition-colors hover:text-fg"),
		],
		[
			strokeIcon(h, { className: "size-4", strokeWidth: "2", d: "M15 19l-7-7 7-7" }),
			h.span([], ["Back to integrations"]),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	// Unknown ids are a `notFound()` in the legacy `beforeLoad`.
	const integration = getIntegrationById(model.integrationId)
	if (integration === undefined) return h.empty
	const isWebhook = WEBHOOK_INTEGRATIONS.includes(integration.id)
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			backLink(h),
			header(h, integration, isWebhook, model.connection?.isActive === true),
			h.div(
				[h.Class("grid gap-8 lg:grid-cols-[1fr_320px]")],
				[
					h.div(
						[h.Class("flex flex-col gap-8")],
						mainColumn(h, integration, model, shared.organization !== null),
					),
					featuresPanel(h, integration),
				],
			),
		],
	)
})
