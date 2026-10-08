import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconCopy, IconEye, IconEyeSlash } from "../../../icons"
import { button } from "../../../ui/button"
import * as Field from "../../../ui/field"
import { inputElement, inputGroup } from "../../../ui/input"
import { Message } from "./message"
import type { Model } from "./model"

/** Port of `components/channel-settings/token-display.tsx`. */

const copyIcon = <M>(h: HtmlBuilder<M>, isCopied: boolean): Html =>
	isCopied ? IconCheck(h, { className: "size-4 text-success" }) : IconCopy(h, { className: "size-4" })

const tokenField = (h: HtmlBuilder<Message>, label: string, field: Html, copy: Html): Html =>
	h.div(
		[],
		[
			Field.label(h, { className: "mb-1.5 block text-muted-fg text-xs" }, [label]),
			h.div([h.Class("flex gap-2")], [field, copy]),
		],
	)

const copyButton = (h: HtmlBuilder<Message>, model: Model, id: "token" | "url", value: string): Html =>
	button(
		h,
		{
			intent: "outline",
			size: "sq-sm",
			onPress: Message.ClickedCopy({
				id,
				value,
				successMessage: id === "token" ? "Token copied" : "URL copied",
				failureMessage: "Failed to copy to clipboard",
			}),
		},
		[copyIcon(h, model.copiedIds.includes(id))],
	)

/** `TokenDisplay` */
export const tokenDisplay = (
	h: HtmlBuilder<Message>,
	model: Model,
	created: { token: string; webhookUrl: string },
): Html => {
	const isVisible = model.createForm.isTokenVisible
	return h.div(
		[h.Class("rounded-xl border border-warning/30 bg-warning-subtle/30 p-4")],
		[
			h.div(
				[h.Class("flex items-start gap-3")],
				[
					h.div(
						[
							h.Class(
								"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle",
							),
						],
						[
							h.svg(
								[
									h.Class("size-4 text-warning-subtle-fg"),
									h.Attribute("fill", "none"),
									h.Attribute("stroke", "currentColor"),
									h.Attribute("stroke-width", "2"),
									h.Attribute("viewBox", "0 0 24 24"),
								],
								[
									h.path([
										h.Attribute(
											"d",
											"M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
										),
										h.Attribute("stroke-linecap", "round"),
										h.Attribute("stroke-linejoin", "round"),
									]),
								],
							),
						],
					),
					h.div(
						[h.Class("flex-1 space-y-4")],
						[
							h.p(
								[h.Class("font-medium text-warning-subtle-fg text-sm")],
								["Make sure to copy your token now. You won't be able to see it again!"],
							),
							h.div(
								[h.Class("space-y-3")],
								[
									tokenField(
										h,
										"Token",
										inputGroup(
											h,
											{ className: "flex-1 [--input-gutter-end:--spacing(12)]" },
											[
												inputElement(h, {
													className: "font-mono text-xs",
													attributes: [
														h.Value(created.token),
														h.Attribute("readonly", ""),
														h.Type(isVisible ? "text" : "password"),
													],
												}),
												button(
													h,
													{
														intent: "plain",
														size: "sq-sm",
														onPress: Message.ClickedToggleTokenVisible(),
														attributes: [
															h.AriaPressed(isVisible ? "true" : "false"),
															h.AriaLabel(
																isVisible ? "Hide token" : "Show token",
															),
														],
													},
													[
														isVisible
															? IconEyeSlash(h, { className: "size-4" })
															: IconEye(h, { className: "size-4" }),
													],
												),
											],
										),
										copyButton(h, model, "token", created.token),
									),
									tokenField(
										h,
										"Webhook URL",
										inputElement(h, {
											className: "flex-1 font-mono text-xs",
											attributes: [
												h.Value(created.webhookUrl),
												h.Attribute("readonly", ""),
											],
										}),
										copyButton(h, model, "url", created.webhookUrl),
									),
								],
							),
							button(
								h,
								{ intent: "secondary", size: "sm", onPress: Message.ClickedDismissToken() },
								["Done"],
							),
						],
					),
				],
			),
		],
	)
}
