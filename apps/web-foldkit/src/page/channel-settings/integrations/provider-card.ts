import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCopy } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button, iconButton } from "../../../ui/button"
import { callout } from "../../../ui/callout"
import { card, cardBody, cardHeader, panel } from "../../../ui/card"
import { copyButton } from "../../../ui/copy-button"
import { inputElement } from "../../../ui/input"
import { link } from "../../../ui/link"
import type { Shared } from "../../contract"
import { PROVIDER_LOGOS } from "./command"
import { Message } from "./message"
import { INTEGRATION_CONFIG, type Model, type Provider } from "./model"
import { formatDistanceToNow } from "~/lib/format-distance"
import { providerWebhook } from "./update-cards"
import { apiUrl } from "~/config/server"

/** Port of `components/channel-settings/integration-card.tsx` (OpenStatus and Railway). */

const BACKEND_URL = apiUrl()

const readonlyInput = <M>(h: HtmlBuilder<M>, value: string, className: string): Html =>
	inputElement(h, {
		className,
		attributes: [h.Attribute("readonly", ""), h.Type("text"), h.Value(value)],
	})

const title = (h: HtmlBuilder<Message>, name: string, extra: ReadonlyArray<Html>) =>
	h.div([h.Class("flex items-center gap-2")], [h.span([h.Class("font-medium text-fg")], [name]), ...extra])

export const providerCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: Provider,
	shared: Shared,
): Html => {
	const config = INTEGRATION_CONFIG[provider]
	const state = model.providers[provider]
	const webhook = providerWebhook(model, provider)
	const logo = h.img([h.Src(PROVIDER_LOGOS[provider]), h.Alt(config.name), h.Class("size-10 rounded-lg")])
	const isCopied = model.copiedIds.includes(`provider:${provider}`)
	const isConnecting = state.action._tag === "Connecting"
	const isConfirming = state.action._tag === "ConfirmingDelete"

	// Just created: the token is shown once.
	if (state.createdToken !== null && webhook !== null) {
		const fullUrl = `${BACKEND_URL}/webhooks/incoming/${webhook.id}/${state.createdToken}/${config.urlSuffix}`
		return card(h, {}, [
			cardHeader(
				h,
				[
					logo,
					h.div(
						[h.Class("flex-1")],
						[
							title(h, config.name, [badge(h, { intent: "success" }, ["Connected"])]),
							h.p([h.Class("text-muted-fg text-sm")], [config.description]),
						],
					),
				],
				"flex-row items-center gap-3",
			),
			cardBody(h, [
				callout(
					h,
					{
						intent: "warning",
						actions: [
							link(
								h,
								{
									href: config.docsUrl,
									className: "text-primary text-xs underline",
									attributes: [h.Target("_blank"), h.Rel("noopener noreferrer")],
								},
								["View setup instructions"],
							),
							button(
								h,
								{
									intent: "secondary",
									size: "sm",
									className: "ml-auto",
									onPress: Message.ClickedDismissProviderToken({ provider }),
								},
								["Done"],
							),
						],
					},
					[
						"Copy this URL now. The token won't be shown again.",
						h.div(
							[h.Class("mt-3 flex gap-2")],
							[
								readonlyInput(h, fullUrl, "flex-1 font-mono text-xs max-md:min-w-0"),
								copyButton(h, {
									label: "Copy URL",
									isCopied,
									onPress: Message.ClickedCopy({
										id: `provider:${provider}`,
										value: fullUrl,
										successMessage: "URL copied",
										failureMessage: "Failed to copy",
									}),
								}),
							],
						),
					],
				),
			]),
		])
	}

	if (webhook === null)
		return panel(h, {}, [
			h.div(
				[h.Class("flex items-center justify-between max-md:gap-3")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							logo,
							h.div(
								[],
								[
									title(h, config.name, []),
									h.p([h.Class("text-muted-fg text-sm")], [config.description]),
								],
							),
						],
					),
					button(
						h,
						{
							intent: "primary",
							size: "sm",
							isDisabled: isConnecting,
							onPress: Message.ClickedConnectProvider({ provider }),
						},
						[isConnecting ? "Connecting..." : "Connect"],
					),
				],
			),
		])

	const webhookUrl = `${BACKEND_URL}/webhooks/incoming/${webhook.id}/`
	return panel(h, { className: "gap-3" }, [
		h.div(
			[h.Class("flex items-start justify-between gap-4")],
			[
				h.div(
					[h.Class("flex items-start gap-3")],
					[
						logo,
						h.div(
							[h.Class("flex flex-col gap-1")],
							[
								title(h, config.name, [
									badge(h, { intent: webhook.isEnabled ? "success" : "secondary" }, [
										webhook.isEnabled ? "Active" : "Disabled",
									]),
								]),
								h.p([h.Class("text-muted-fg text-sm")], [config.description]),
								...(webhook.lastUsedAtMs === null
									? []
									: [
											h.p(
												[h.Class("text-muted-fg text-xs")],
												[
													"Last alert",
													" ",
													formatDistanceToNow(webhook.lastUsedAtMs, shared.nowMs),
												],
											),
										]),
							],
						),
					],
				),
				h.div(
					[h.Class("flex shrink-0 items-center gap-2")],
					[
						button(
							h,
							{
								intent: "outline",
								size: "sm",
								onPress: Message.ClickedToggleProvider({ provider }),
							},
							[webhook.isEnabled ? "Disable" : "Enable"],
						),
						button(
							h,
							{
								intent: isConfirming ? "danger" : "outline",
								size: "sm",
								isDisabled: state.action._tag === "Deleting",
								onPress: Message.ClickedDeleteProvider({ provider }),
							},
							[isConfirming ? "Confirm?" : "Delete"],
						),
					],
				),
			],
		),
		h.div(
			[h.Class("flex gap-2")],
			[
				readonlyInput(
					h,
					`${webhookUrl}****${webhook.tokenSuffix}/${config.urlSuffix}`,
					"flex-1 bg-secondary/30 font-mono text-muted-fg text-xs max-md:min-w-0",
				),
				iconButton(
					h,
					{ label: "URL info", intent: "outline", onPress: Message.ClickedProviderUrlInfo() },
					IconCopy(h, { attributes: { "data-slot": "icon" } }),
				),
			],
		),
	])
}
