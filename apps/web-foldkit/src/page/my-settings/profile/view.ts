import { Submodel } from "foldkit"
import type * as FieldValidation from "foldkit/fieldValidation"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEnvelope } from "../../../icons"
import { button } from "../../../ui/button"
import * as Field from "../../../ui/field"
import { inputGroup } from "../../../ui/input"
import { sectionLabelRoot } from "../../../ui/section-label"
import { textField } from "../../../ui/text-field"
import * as TimezoneSelect from "../../../ui/timezone-select"
import type { PageViewInputs, Shared } from "../../contract"
import { pageHeader } from "../shared"
import { profilePictureUpload } from "./avatar-view"
import { isSaveDisabled } from "./form"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction, toTimezoneMessage } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/profile.tsx`. */

const toFirstName = (value: string) => Message.ChangedFirstName({ value })
const toLastName = (value: string) => Message.ChangedLastName({ value })

const nameField = (
	h: HtmlBuilder<Message>,
	model: Model,
	field: {
		id: string
		label: string
		state: FieldValidation.Field<string>
		onInput: (value: string) => Message
	},
): Html => {
	const error = field.state._tag === "Invalid" ? field.state.errors[0] : undefined
	return textField(
		h,
		{
			id: field.id,
			value: field.state.value,
			onInput: field.onInput,
			isRequired: true,
			isInvalid: error !== undefined,
			interaction: interaction.wiring(model),
		},
		(parts) => [
			parts.label([field.label], { className: "lg:hidden" }),
			parts.input(),
			...(error === undefined ? [] : [parts.fieldError([error])]),
		],
	)
}

const section = (h: HtmlBuilder<Message>, title: string, children: ReadonlyArray<Html>, isRequired = false) =>
	h.div(
		[h.Class("space-y-2")],
		[sectionLabelRoot(h, { size: "sm", title, isRequired, className: "max-lg:hidden" }), ...children],
	)

/** The page body as a plain view (Scene tests render it directly). */
export const profileView = (model: Model, shared: Shared, h: HtmlBuilder<Message>): Html => {
	const user = shared.currentUser
	return h.form(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8"), h.OnSubmit(Message.SubmittedProfile())],
		[
			pageHeader(h, "Profile", "Manage your profile information and preferences."),
			h.div(
				[h.Class("max-w-xl space-y-6")],
				[
					section(h, "Profile picture", [
						profilePictureUpload(h, model, {
							avatarUrl: user?.avatarUrl ?? null,
							name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
						}),
					]),
					section(
						h,
						"Name",
						[
							h.div(
								[h.Class("grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-4")],
								[
									nameField(h, model, {
										id: "profile-first-name",
										label: "First name",
										state: model.firstName,
										onInput: toFirstName,
									}),
									nameField(h, model, {
										id: "profile-last-name",
										label: "Last name",
										state: model.lastName,
										onInput: toLastName,
									}),
								],
							),
						],
						true,
					),
					section(h, "Email address", [
						textField(
							h,
							{ id: "profile-email", value: user?.email ?? "", isDisabled: true },
							(parts) => [
								parts.label(["Email address"], { className: "lg:hidden" }),
								// React Aria's Group in a disabled TextField: data-disabled, role="presentation".
								inputGroup(h, { isDisabled: true, attributes: [h.Role("presentation")] }, [
									IconEnvelope(h),
									parts.input({ attributes: [h.Type("email")] }),
								]),
							],
						),
					]),
					section(h, "Timezone", [
						Field.label(h, { className: "lg:hidden" }, ["Timezone"]),
						h.submodel({
							slotId: "profile-timezone",
							model: model.timezone,
							view: TimezoneSelect.view,
							viewInputs: TimezoneSelect.viewInputs(),
							toParentMessage: toTimezoneMessage,
						}),
					]),
					h.div(
						[h.Class("flex justify-end")],
						[
							button(
								h,
								{
									intent: "primary",
									isDisabled: isSaveDisabled(model),
									interaction: {
										wiring: interaction.wiring(model),
										target: "profile-save",
									},
									attributes: [h.Type("submit")],
								},
								[model.save._tag === "Saving" ? "Saving..." : "Save"],
							),
						],
					),
				],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	profileView(model, shared, h),
)
