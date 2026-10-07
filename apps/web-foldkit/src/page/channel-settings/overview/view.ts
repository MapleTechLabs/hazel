import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose } from "../../../icons"
import type * as Interaction from "../../../ui/aria/interaction"
import { button } from "../../../ui/button"
import * as Field from "../../../ui/field"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs } from "../../contract"
import { channelIcon, tabHeader } from "../section-header"
import { Message } from "./message"
import { canSave, type Form, isNameValid, type Model, nameInputTarget, saveButtonTarget } from "./model"

/** Port of `channels/$channelId/settings/overview.tsx`. */

const toInteractionMessage = (message: Interaction.Message) => Message.GotInteractionMessage({ message })
const toChangedName = (name: string) => Message.ChangedName({ name })

const iconField = (h: HtmlBuilder<Message>, form: Form): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			Field.label(h, {}, ["Channel Icon"]),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					// EmojiPickerDialog's trigger; the picker popover is not ported yet.
					button(
						h,
						{
							intent: "outline",
							size: "sq-md",
							className: "text-xl",
							attributes: [h.Attribute("aria-expanded", "false")],
						},
						[channelIcon(h, form.icon)],
					),
					...(form.icon
						? [
								button(
									h,
									{
										intent: "plain",
										size: "sq-sm",
										className: "text-muted-fg hover:text-fg",
										onPress: Message.ClearedIcon(),
									},
									[IconClose(h, { className: "size-4" })],
								),
							]
						: []),
					h.span(
						[h.Class("text-muted-fg text-sm")],
						[form.icon ? "Click to change icon" : "Click to add an emoji icon"],
					),
				],
			),
		],
	)

const settingsForm = (h: HtmlBuilder<Message>, model: Model, form: Form): Html => {
	const wiring = { model: model.interaction, toParentMessage: toInteractionMessage }
	const isEnabled = canSave(form)
	return h.form(
		[h.Class("flex flex-col gap-6"), h.OnSubmit(Message.SubmittedForm())],
		[
			iconField(h, form),
			textField(h, { id: "channel-name", value: form.name, onInput: toChangedName }, (field) => [
				field.label(["Channel name"]),
				field.input({
					placeholder: "Channel name",
					interaction: { wiring, target: nameInputTarget },
					attributes: [
						h.AriaInvalid(form.isNameDirty && !isNameValid(form.name)),
						...(form.isNameDirty && !isNameValid(form.name)
							? [h.DataAttribute("invalid", "true")]
							: []),
					],
				}),
			]),
			h.div(
				[],
				[
					button(
						h,
						{
							intent: "primary",
							isDisabled: !isEnabled,
							interaction: { wiring, target: saveButtonTarget },
							attributes: [h.Type("submit")],
						},
						[form.isSubmitting ? "Saving..." : "Save changes"],
					),
				],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			tabHeader(h, "Overview", "General information about this channel."),
			...(model.form === null ? [] : [settingsForm(h, model, model.form)]),
		],
	),
)
