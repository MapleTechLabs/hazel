import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEye, IconEyeSlash } from "../../../icons"
import { button, iconButton } from "../../../ui/button"
import { callout } from "../../../ui/callout"
import { copyButton } from "../../../ui/copy-button"
import * as Field from "../../../ui/field"
import { inputElement, inputGroup } from "../../../ui/input"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `components/channel-settings/token-display.tsx`. */

const tokenField = (h: HtmlBuilder<Message>, label: string, field: Html, copy: Html): Html =>
	h.div(
		[],
		[
			Field.label(h, { className: "mb-1.5 block text-muted-fg text-xs" }, [label]),
			h.div([h.Class("flex gap-2")], [field, copy]),
		],
	)

const copy = (h: HtmlBuilder<Message>, model: Model, id: "token" | "url", value: string): Html =>
	copyButton(h, {
		label: id === "token" ? "Copy token" : "Copy URL",
		isCopied: model.copiedIds.includes(id),
		onPress: Message.ClickedCopy({
			id,
			value,
			successMessage: id === "token" ? "Token copied" : "URL copied",
			failureMessage: "Failed to copy to clipboard",
		}),
	})

/** `TokenDisplay` */
export const tokenDisplay = (
	h: HtmlBuilder<Message>,
	model: Model,
	created: { token: string; webhookUrl: string },
): Html => {
	const isVisible = model.createForm.isTokenVisible
	return callout(
		h,
		{
			intent: "warning",
			title: "Make sure to copy your token now. You won't be able to see it again!",
			actions: [
				button(h, { intent: "secondary", size: "sm", onPress: Message.ClickedDismissToken() }, [
					"Done",
				]),
			],
		},
		[
			h.div(
				[h.Class("mt-2 space-y-3")],
				[
					tokenField(
						h,
						"Token",
						inputGroup(h, { className: "flex-1 [--input-gutter-end:--spacing(12)]" }, [
							inputElement(h, {
								className: "font-mono text-xs",
								attributes: [
									h.Value(created.token),
									h.Attribute("readonly", ""),
									h.Type(isVisible ? "text" : "password"),
								],
							}),
							iconButton(
								h,
								{
									label: isVisible ? "Hide token" : "Show token",
									onPress: Message.ClickedToggleTokenVisible(),
									attributes: [h.AriaPressed(isVisible ? "true" : "false")],
								},
								isVisible
									? IconEyeSlash(h, { attributes: { "data-slot": "icon" } })
									: IconEye(h, { attributes: { "data-slot": "icon" } }),
							),
						]),
						copy(h, model, "token", created.token),
					),
					tokenField(
						h,
						"Webhook URL",
						inputElement(h, {
							className: "flex-1 font-mono text-xs",
							attributes: [h.Value(created.webhookUrl), h.Attribute("readonly", "")],
						}),
						copy(h, model, "url", created.webhookUrl),
					),
				],
			),
		],
	)
}
