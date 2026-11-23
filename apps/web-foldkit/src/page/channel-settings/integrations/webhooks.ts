import type { Html, HtmlBuilder } from "foldkit/html"
import { IconPlus, IconWebhook } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardBody, cardHeader, panel } from "../../../ui/card"
import { copyButton } from "../../../ui/copy-button"
import { emptyState } from "../../../ui/empty-state"
import { iconTile } from "../../../ui/icon-tile"
import { textField } from "../../../ui/text-field"
import type { Shared } from "../../contract"
import { CARD_HEADER_ROW, cardTitle, listBody, spinner } from "./cards"
import { Message } from "./message"
import { type CreateForm, type Model, rowMenuId, type Webhook } from "./model"
import { formatDistanceToNow } from "~/lib/format-distance"
import { rowMenu } from "./row-menu"
import { tokenDisplay } from "./token-display"
import { canCreate } from "./update-cards"
import { apiUrl } from "~/config/server"

/** The Custom Webhooks card: `CompactWebhookItem` and `CreateWebhookForm`. */

const BACKEND_URL = apiUrl()

const compactWebhookItem = (
	h: HtmlBuilder<Message>,
	model: Model,
	webhook: Webhook,
	shared: Shared,
): Html => {
	const url = `${BACKEND_URL}/webhooks/incoming/${webhook.id}/`
	return h.keyed("div")(
		webhook.id,
		[
			h.Class(
				"flex items-center gap-3 rounded-lg border border-border bg-bg p-3 transition-colors hover:border-border-hover",
			),
		],
		[
			avatar(h, {
				size: "sm",
				src: webhook.avatarUrl,
				alt: webhook.name,
				placeholder: IconWebhook(h, { className: "size-4 text-muted-fg" }),
			}),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.span([h.Class("truncate font-medium text-fg text-sm")], [webhook.name]),
							badge(
								h,
								{
									intent: webhook.isEnabled ? "success" : "secondary",
									className: "shrink-0",
								},
								[webhook.isEnabled ? "Active" : "Disabled"],
							),
						],
					),
					h.div(
						[h.Class("flex items-center gap-2 text-muted-fg text-xs")],
						[
							h.span([h.Class("font-mono")], ["****", webhook.tokenSuffix]),
							...(webhook.lastUsedAtMs === null
								? []
								: [
										h.span([h.Class("text-muted-fg/50")], ["·"]),
										h.span([], [formatDistanceToNow(webhook.lastUsedAtMs, shared.nowMs)]),
									]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-1")],
				[
					copyButton(h, {
						label: "Copy webhook URL",
						isCopied: model.copiedIds.includes(webhook.id),
						intent: "plain",
						size: "sq-xs",
						className: "text-muted-fg max-md:size-10",
						onPress: Message.ClickedCopy({
							id: webhook.id,
							value: url,
							successMessage: "URL copied",
							failureMessage: "Failed to copy",
						}),
					}),
					rowMenu(h, {
						kind: "webhook",
						id: webhook.id,
						menu: model.rowMenus.find((menu) => menu.id === rowMenuId("webhook", webhook.id)),
						isEnabled: webhook.isEnabled,
						isToggling: model.togglingRowIds.includes(webhook.id),
						triggerClassName: "text-muted-fg",
						labels: { enable: "Enable", disable: "Disable", remove: "Delete" },
					}),
				],
			),
		],
	)
}

const toField = (field: "name" | "description" | "avatarUrl") => (value: string) =>
	Message.ChangedCreateField({ field, value })

/** `CreateWebhookForm` */
const createWebhookForm = (h: HtmlBuilder<Message>, model: Model, form: CreateForm): Html => {
	if (form.created !== null) return tokenDisplay(h, model, form.created)
	if (!form.isExpanded)
		return button(h, { intent: "secondary", size: "md", onPress: Message.ClickedExpandCreateForm() }, [
			IconPlus(h, { attributes: { "data-slot": "icon" } }),
			"Create webhook",
		])
	const nameError = form.name._tag === "Invalid" ? form.name.errors[0] : null
	return panel(h, {}, [
		h.form(
			[h.Class("space-y-4"), h.OnSubmit(Message.SubmittedCreateForm())],
			[
				textField(
					h,
					{
						id: "webhook-name",
						value: form.name.value,
						onInput: toField("name"),
						isInvalid: nameError !== null,
					},
					(field) => [
						field.label(["Name"]),
						field.description(["A display name for this webhook"]),
						field.input({ placeholder: "My Webhook" }),
						field.fieldError([nameError ?? ""]),
					],
				),
				textField(
					h,
					{
						id: "webhook-description",
						value: form.description,
						onInput: toField("description"),
					},
					(field) => [
						field.label(["Description"]),
						field.description(["Optional description for this webhook"]),
						field.textarea({
							placeholder: "Describe what this webhook is used for...",
							attributes: [h.Attribute("rows", "2")],
						}),
					],
				),
				textField(
					h,
					{ id: "webhook-avatar", value: form.avatarUrl, onInput: toField("avatarUrl") },
					(field) => [
						field.label(["Avatar URL"]),
						field.description(["Optional avatar image URL for the webhook bot"]),
						field.input({ placeholder: "https://example.com/avatar.png" }),
					],
				),
				h.div(
					[h.Class("flex items-center gap-2 pt-2")],
					[
						button(h, { intent: "outline", onPress: Message.ClickedCancelCreateForm() }, [
							"Cancel",
						]),
						button(
							h,
							{
								intent: "primary",
								isDisabled: !canCreate(form),
								attributes: [h.Type("submit")],
							},
							[form.isSubmitting ? "Creating..." : "Create webhook"],
						),
					],
				),
			],
		),
	])
}

export const customWebhooksCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	regular: ReadonlyArray<Webhook>,
	shared: Shared,
): Html =>
	card(h, {}, [
		cardHeader(
			h,
			[
				h.div(
					[h.Class("flex items-center gap-3")],
					[
						iconTile(h, { size: "md" }, IconWebhook(h)),
						cardTitle(
							h,
							"Custom Webhooks",
							regular.length > 0
								? [badge(h, { intent: "secondary" }, [`${regular.length}`])]
								: [],
							"Allow external services to post messages",
						),
					],
				),
			],
			CARD_HEADER_ROW,
		),
		cardBody(h, [
			listBody(h, "webhook", model.webhooks.data, {
				loading: () => spinner(h),
				empty: () =>
					emptyState(h, {
						title: "No webhooks yet",
						className: "mb-4 rounded-lg border border-border border-dashed py-6",
					}),
				rows: () =>
					h.div(
						[h.Class("mb-4 flex flex-col gap-2")],
						regular.map((webhook) => compactWebhookItem(h, model, webhook, shared)),
					),
			}),
			createWebhookForm(h, model, model.createForm),
		]),
	])
