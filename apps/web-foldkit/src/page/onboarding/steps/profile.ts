import type { Html, HtmlBuilder } from "foldkit/html"
import type * as Interaction from "../../../ui/aria/interaction"
import { textField } from "../../../ui/text-field"
import { Message } from "../message"
import type { StepForm } from "../model"
import { autoFocus, onboardingNavigation, stepHeader } from "../navigation"

/** `profile-info-step.tsx`: the form validates on change, so errors appear after the first edit. */

type ProfileForm = Extract<StepForm, { _tag: "Profile" }>

const nameField = (
	h: HtmlBuilder<Message>,
	options: {
		readonly id: string
		readonly label: string
		readonly value: string
		readonly isInvalid: boolean
		readonly placeholder: string
		readonly description: string
		readonly testId: string
		readonly isAutoFocused: boolean
		readonly onInput: (value: string) => Message
		readonly interaction: Interaction.Wiring<Message>
	},
): Html =>
	textField(
		h,
		{
			id: options.id,
			value: options.value,
			isRequired: true,
			onInput: options.onInput,
			interaction: options.interaction,
		},
		(parts) => [
			parts.label([options.label]),
			parts.input({
				placeholder: options.placeholder,
				attributes: [
					h.DataAttribute("testid", options.testId),
					// `aria-invalid` on the Input only: the TextField itself stays valid.
					h.Attribute("aria-invalid", String(options.isInvalid)),
					...(options.isInvalid ? [h.DataAttribute("invalid", "true")] : []),
					...(options.isAutoFocused ? [autoFocus(h)] : []),
				],
			}),
			parts.description([options.description]),
		],
	)

const toFirstName = (value: string) => Message.ChangedFirstName({ value })
const toLastName = (value: string) => Message.ChangedLastName({ value })

export const profileStep = (
	h: HtmlBuilder<Message>,
	form: ProfileForm,
	interaction: Interaction.Wiring<Message>,
): Html => {
	const isFirstNameInvalid = form.hasChanged && form.firstName.length === 0
	const isLastNameInvalid = form.hasChanged && form.lastName.length === 0
	return h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", "onboarding-step-profile")],
		[
			stepHeader(h, {
				title: "Set up your profile",
				description: "Tell us a bit about yourself to personalize your experience",
			}),
			h.form(
				[h.OnSubmit(Message.SubmittedProfile())],
				[
					h.div(
						[h.Class("space-y-4")],
						[
							nameField(h, {
								id: "onboarding-first-name",
								label: "First name",
								value: form.firstName,
								isInvalid: isFirstNameInvalid,
								placeholder: "John",
								description: "Your first name as you'd like it to appear",
								testId: "input-first-name",
								isAutoFocused: true,
								onInput: toFirstName,
								interaction,
							}),
							nameField(h, {
								id: "onboarding-last-name",
								label: "Last name",
								value: form.lastName,
								isInvalid: isLastNameInvalid,
								placeholder: "Doe",
								description: "Your last name as you'd like it to appear",
								testId: "input-last-name",
								isAutoFocused: false,
								onInput: toLastName,
								interaction,
							}),
						],
					),
					onboardingNavigation(h, {
						onContinue: Message.SubmittedProfile(),
						canContinue: !isFirstNameInvalid && !isLastNameInvalid,
						isLoading: form.isSubmitting,
					}),
				],
			),
		],
	)
}
