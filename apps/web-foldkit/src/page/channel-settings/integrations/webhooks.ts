import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconCopy, IconPlus, IconWebhook } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { loader } from "../../../ui/loader"
import { textField } from "../../../ui/text-field"
import type { Shared } from "../../contract"
import { Message } from "./message"
import { type CreateForm, isNameValid, type Model, rowMenuId, type Webhook } from "./model"
import { formatDistanceToNow } from "./relative-time"
import { rowMenu } from "./row-menu"
import { tokenDisplay } from "./token-display"
import { canCreate } from "./update-cards"

/** The Custom Webhooks card: `CompactWebhookItem` and `CreateWebhookForm`. */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

const copyIcon = <M>(h: HtmlBuilder<M>, isCopied: boolean): Html =>
	isCopied ? IconCheck(h, { className: "size-4 text-success" }) : IconCopy(h, { className: "size-4" })

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
			webhook.avatarUrl
				? h.img([
						h.Src(webhook.avatarUrl),
						h.Alt(webhook.name),
						h.Class("size-8 rounded-full object-cover"),
					])
				: h.div(
						[h.Class("flex size-8 items-center justify-center rounded-full bg-secondary")],
						[IconWebhook(h, { className: "size-4 text-muted-fg" })],
					),
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
					button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							className: "text-muted-fg",
							onPress: Message.ClickedCopy({
								id: webhook.id,
								value: url,
								successMessage: "URL copied",
								failureMessage: "Failed to copy",
							}),
						},
						[copyIcon(h, model.copiedIds.includes(webhook.id))],
					),
					rowMenu(h, {
						kind: "webhook",
						id: webhook.id,
						menu: model.rowMenus.find((menu) => menu.id === rowMenuId("webhook", webhook.id)),
						isEnabled: webhook.isEnabled,
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
	const isNameInvalid = form.isNameDirty && !isNameValid(form.name)
	return h.div(
		[h.Class("rounded-xl border border-border bg-bg p-4")],
		[
			h.form(
				[h.Class("space-y-4"), h.OnSubmit(Message.SubmittedCreateForm())],
				[
					textField(
						h,
						{ id: "webhook-name", value: form.name, onInput: toField("name") },
						(field) => [
							field.label(["Name"]),
							field.description(["A display name for this webhook"]),
							field.input({
								placeholder: "My Webhook",
								attributes: [
									h.AriaInvalid(isNameInvalid),
									...(isNameInvalid ? [h.DataAttribute("invalid", "true")] : []),
								],
							}),
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
		],
	)
}

export const customWebhooksCard = (
	h: HtmlBuilder<Message>,
	model: Model,
	regular: ReadonlyArray<Webhook>,
	shared: Shared,
): Html =>
	h.div(
		[h.Class("rounded-xl border border-border bg-bg")],
		[
			h.div(
				[h.Class("flex items-center justify-between border-border border-b p-4")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							h.div(
								[h.Class("flex size-10 items-center justify-center rounded-lg bg-secondary")],
								[IconWebhook(h, { className: "size-5 text-muted-fg" })],
							),
							h.div(
								[],
								[
									h.div(
										[h.Class("flex items-center gap-2")],
										[
											h.span([h.Class("font-medium text-fg")], ["Custom Webhooks"]),
											...(regular.length > 0
												? [badge(h, { intent: "secondary" }, [`${regular.length}`])]
												: []),
										],
									),
									h.p(
										[h.Class("text-muted-fg text-sm")],
										["Allow external services to post messages"],
									),
								],
							),
						],
					),
				],
			),
			h.div(
				[h.Class("p-4")],
				[
					model.webhooks.isLoading
						? h.div(
								[h.Class("flex items-center justify-center py-6")],
								[loader(h, { className: "size-5" })],
							)
						: regular.length === 0
							? h.div(
									[
										h.Class(
											"mb-4 rounded-lg border border-border border-dashed py-6 text-center",
										),
									],
									[h.p([h.Class("text-muted-fg text-sm")], ["No webhooks yet"])],
								)
							: h.div(
									[h.Class("mb-4 flex flex-col gap-2")],
									regular.map((webhook) => compactWebhookItem(h, model, webhook, shared)),
								),
					createWebhookForm(h, model, model.createForm),
				],
			),
		],
	)
