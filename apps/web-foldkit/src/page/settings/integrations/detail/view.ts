import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getIntegrationById, type Integration } from "~/lib/integrations/__data"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { pageHeader, pageLayout } from "../../../../ui/page-header"
import { statusDot } from "../../../../ui/status-dot"
import type { PageViewInputs, Shared } from "../../../contract"
import { CHECK, integrationLogo, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"
import {
	apiKeyConnectionForm,
	configOptionRow,
	connectedState,
	disconnectedState,
	sectionCard,
	verifyingState,
} from "./view-connection"
import { mapleColumn } from "./view-maple"
import { isT3CodeConnected, t3CodeColumn } from "./view-t3code"

/** Port of `routes/_app/$orgSlug/settings/integrations/$integrationId.tsx`. */

type H = HtmlBuilder<Message>

const WEBHOOK_INTEGRATIONS = ["openstatus", "railway", "rss", "maple"]

const connectionBadge = (h: H, connected: boolean): Html =>
	badge(h, { intent: connected ? "success" : "muted" }, [
		statusDot(h, { tone: connected ? "success" : "neutral" }),
		connected ? "Connected" : "Not connected",
	])

/** Not ported yet: the per-channel webhook content and the GitHub repository and subscription sections. */
const unported = (h: H, name: string): Html => h.div([h.Attribute("data-page-placeholder", name)], [])

const header = (h: H, integration: Integration, isWebhook: boolean, isConnected: boolean): Html =>
	pageHeader(h, {
		title: integration.name,
		subtitle: integration.description,
		size: "title",
		leading: integrationLogo(h, integration, "lg"),
		badges: isWebhook ? [] : [connectionBadge(h, isConnected)],
	})

const mainColumn = (h: H, integration: Integration, model: Model, shared: Shared) => {
	const hasOrganization = shared.organization !== null
	const isConnected = model.connection?.isActive === true
	if (integration.connectionType === "environment") return t3CodeColumn(h, integration, model, shared.nowMs)
	if (integration.id === "maple")
		return mapleColumn(h, {
			install: model.mapleInstall,
			isUninstalling: model.mapleUninstalling,
			isConfirming: model.confirmingRemoval,
			onUninstall: Message.ClickedUninstallMaple(),
			onConfirmUninstall: Message.ClickedConfirmUninstallMaple(),
			onCancel: Message.ClickedCancelRemoval(),
		})
	if (WEBHOOK_INTEGRATIONS.includes(integration.id))
		return hasOrganization ? [unported(h, `IntegrationContent:${integration.id}`)] : []
	if (integration.connectionType === "api-key")
		return [
			sectionCard(h, "Connection", [
				isConnected
					? connectedState(h, integration, model, { canConfigure: false })
					: apiKeyConnectionForm(h, integration, model),
			]),
		]
	const isVerifying = model.activity._tag === "Verifying" && !isConnected
	return [
		sectionCard(h, "Connection", [
			isVerifying
				? verifyingState(h, integration)
				: isConnected
					? connectedState(h, integration, model, { canConfigure: true })
					: disconnectedState(h, integration, model.activity._tag === "Connecting"),
		]),
		...(isConnected
			? [
					sectionCard(
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
		[h.Class("@3xl:sticky @3xl:top-6 @3xl:self-start")],
		[
			sectionCard(h, "Features", [
				h.p([h.Class("mb-4 text-muted-fg text-sm leading-relaxed")], [integration.fullDescription]),
				h.ul(
					[h.Class("flex flex-col gap-2.5")],
					integration.features.map((feature) =>
						h.keyed("li")(
							feature,
							[h.Class("flex items-center gap-2.5 text-sm")],
							[
								h.div(
									[
										h.Class(
											"flex size-5 shrink-0 items-center justify-center rounded-sm bg-success-subtle",
										),
									],
									[
										strokeIcon(h, {
											className: "size-3 text-success-subtle-fg",
											strokeWidth: "3",
											d: CHECK,
										}),
									],
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
	button(
		h,
		{
			intent: "plain",
			size: "sm",
			className: "-ml-2 w-fit text-muted-fg",
			onPress: Message.ClickedBack(),
		},
		[
			strokeIcon(h, { className: "size-4", strokeWidth: "2", d: "M15 19l-7-7 7-7" }),
			"Back to integrations",
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	// Unknown ids are a `notFound()` in the legacy `beforeLoad`.
	const integration = getIntegrationById(model.integrationId)
	if (integration === undefined) return h.empty
	// Maple's badge is its agent: installed here or not.
	const isWebhook = WEBHOOK_INTEGRATIONS.includes(integration.id) && integration.id !== "maple"
	return pageLayout(h, {}, [
		backLink(h),
		header(
			h,
			integration,
			isWebhook,
			integration.connectionType === "environment"
				? isT3CodeConnected(model, shared.nowMs)
				: integration.id === "maple"
					? model.mapleInstall !== null
					: model.connection?.isActive === true,
		),
		// Columns by the page's own width, not the window's: the assistant panel and sidebar take a share.
		h.div(
			[h.Class("@container")],
			[
				h.div(
					[h.Class("grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_20rem]")],
					[
						h.div(
							[h.Class("flex min-w-0 flex-col gap-8")],
							mainColumn(h, integration, model, shared),
						),
						featuresPanel(h, integration),
					],
				),
			],
		),
	])
})
