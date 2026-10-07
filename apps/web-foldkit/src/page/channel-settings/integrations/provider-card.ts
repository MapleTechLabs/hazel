import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconCopy } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import type { Shared } from "../../contract"
import { PROVIDER_LOGOS } from "./command"
import { Message } from "./message"
import { INTEGRATION_CONFIG, type Model, type Provider } from "./model"
import { formatDistanceToNow } from "./relative-time"
import { providerWebhook } from "./update-cards"

/** Port of `components/channel-settings/integration-card.tsx` (OpenStatus and Railway). */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

const readonlyInput = <M>(h: HtmlBuilder<M>, value: string, className: string): Html =>
	h.input([
		h.Class(className),
		h.Attribute("readonly", ""),
		h.Attribute("style", ""),
		h.Type("text"),
		h.Value(value),
	])

const copyIcon = <M>(h: HtmlBuilder<M>, isCopied: boolean): Html =>
	isCopied ? IconCheck(h, { className: "size-4 text-success" }) : IconCopy(h, { className: "size-4" })

const heading = (h: HtmlBuilder<Message>, name: string, extra: ReadonlyArray<Html>) =>
	h.div([h.Class("flex items-center gap-2")], [h.span([h.Class("font-medium text-fg")], [name]), ...extra])

export const providerCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	provider: Provider,
	shared: Shared,
): Html => {
	const config = INTEGRATION_CONFIG[provider]
	const card = model.providers[provider]
	const webhook = providerWebhook(model, provider)
	const logo = h.img([h.Src(PROVIDER_LOGOS[provider]), h.Alt(config.name), h.Class("size-10 rounded-lg")])
	const isCopied = model.copiedIds.includes(`provider:${provider}`)

	// Just created: the token is shown once.
	if (card.createdToken !== null && webhook !== null) {
		const fullUrl = `${BACKEND_URL}/webhooks/incoming/${webhook.id}/${card.createdToken}/${config.urlSuffix}`
		return h.div(
			[h.Class("rounded-xl border border-border bg-bg")],
			[
				h.div(
					[h.Class("flex items-center gap-3 border-border border-b p-4")],
					[
						logo,
						h.div(
							[h.Class("flex-1")],
							[
								heading(h, config.name, [badge(h, { intent: "success" }, ["Connected"])]),
								h.p([h.Class("text-muted-fg text-sm")], [config.description]),
							],
						),
					],
				),
				h.div(
					[h.Class("bg-warning-subtle/30 p-4")],
					[
						h.div(
							[h.Class("mb-3 flex items-start gap-2")],
							[
								h.div(
									[
										h.Class(
											"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-subtle",
										),
									],
									[
										h.svg(
											[
												h.Class("size-3 text-warning-subtle-fg"),
												h.Attribute("fill", "none"),
												h.Attribute("stroke", "currentColor"),
												h.Attribute("stroke-width", "2.5"),
												h.Attribute("viewBox", "0 0 24 24"),
											],
											[
												h.path([
													h.Attribute("d", "M12 9v2m0 4h.01"),
													h.Attribute("stroke-linecap", "round"),
													h.Attribute("stroke-linejoin", "round"),
												]),
											],
										),
									],
								),
								h.p(
									[h.Class("text-warning-subtle-fg text-sm")],
									["Copy this URL now. The token won't be shown again."],
								),
							],
						),
						h.div(
							[h.Class("flex gap-2")],
							[
								readonlyInput(
									h,
									fullUrl,
									"flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs",
								),
								button(
									h,
									{
										intent: "outline",
										size: "sq-sm",
										onPress: Message.ClickedCopy({
											id: `provider:${provider}`,
											value: fullUrl,
											successMessage: "URL copied",
											failureMessage: "Failed to copy",
										}),
									},
									[copyIcon(h, isCopied)],
								),
							],
						),
						h.div(
							[h.Class("mt-3 flex items-center justify-between")],
							[
								h.a(
									[
										h.Href(config.docsUrl),
										h.Target("_blank"),
										h.Rel("noopener noreferrer"),
										h.Class("text-primary text-xs underline"),
									],
									["View setup instructions"],
								),
								button(
									h,
									{
										intent: "secondary",
										size: "sm",
										onPress: Message.ClickedDismissProviderToken({ provider }),
									},
									["Done"],
								),
							],
						),
					],
				),
			],
		)
	}

	if (webhook === null)
		return h.div(
			[h.Class("rounded-xl border border-border bg-bg p-4")],
			[
				h.div(
					[h.Class("flex items-center justify-between")],
					[
						h.div(
							[h.Class("flex items-center gap-3")],
							[
								logo,
								h.div(
									[],
									[
										heading(h, config.name, []),
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
								isDisabled: card.isCreating,
								onPress: Message.ClickedConnectProvider({ provider }),
							},
							[card.isCreating ? "Connecting..." : "Connect"],
						),
					],
				),
			],
		)

	const webhookUrl = `${BACKEND_URL}/webhooks/incoming/${webhook.id}/`
	return h.div(
		[h.Class("rounded-xl border border-border bg-bg p-4")],
		[
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
									heading(h, config.name, [
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
														formatDistanceToNow(
															webhook.lastUsedAtMs,
															shared.nowMs,
														),
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
									intent: card.confirmDelete ? "danger" : "outline",
									size: "sm",
									isDisabled: card.isDeleting,
									onPress: Message.ClickedDeleteProvider({ provider }),
								},
								[card.confirmDelete ? "Confirm?" : "Delete"],
							),
						],
					),
				],
			),
			h.div(
				[h.Class("mt-3 flex gap-2")],
				[
					readonlyInput(
						h,
						`${webhookUrl}****${webhook.tokenSuffix}/${config.urlSuffix}`,
						"flex-1 rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-muted-fg text-xs",
					),
					button(
						h,
						{ intent: "outline", size: "sq-sm", onPress: Message.ClickedProviderUrlInfo() },
						[IconCopy(h, { className: "size-4" })],
					),
				],
			),
		],
	)
}
