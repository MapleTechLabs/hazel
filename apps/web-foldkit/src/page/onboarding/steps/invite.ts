import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose, IconPlus } from "../../../icons"
import type * as Interaction from "../../../ui/aria/interaction"
import { button } from "../../../ui/button"
import { description } from "../../../ui/field"
import { textField } from "../../../ui/text-field"
import { Message } from "../message"
import type { StepForm } from "../model"
import { autoFocus, onboardingNavigation, stepHeader } from "../navigation"

/** `invite-team-step.tsx` */

type InviteForm = Extract<StepForm, { _tag: "Invite" }>

const MAX_INVITES = 10
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailField = (
	h: HtmlBuilder<Message>,
	form: InviteForm,
	interaction: Interaction.Wiring<Message>,
	email: string,
	index: number,
): Html => {
	const error = form.errors[String(index)]
	return textField(
		h,
		{
			id: `onboarding-invite-${index}`,
			value: email,
			isInvalid: error !== undefined,
			onInput: (value) => Message.ChangedEmail({ index, value }),
			interaction,
		},
		(parts) => [
			parts.label(["Email ", String(index + 1)], { className: "sr-only" }),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					parts.input({
						placeholder: "colleague@example.com",
						attributes: [h.Type("email"), ...(index === 0 ? [autoFocus(h)] : [])],
					}),
					...(form.emails.length > 1
						? [
								button(
									h,
									{
										intent: "secondary",
										size: "sq-sm",
										onPress: Message.ClickedRemoveEmail({ index }),
										attributes: [h.AriaLabel("Remove email")],
									},
									[IconClose(h, { className: "size-4" })],
								),
							]
						: []),
				],
			),
			...(error === undefined ? [] : [parts.fieldError([error])]),
		],
	)
}

export const inviteStep = (
	h: HtmlBuilder<Message>,
	form: InviteForm,
	interaction: Interaction.Wiring<Message>,
): Html => {
	const hasValidEmails = form.emails.some((email) => email.trim().length > 0 && EMAIL_PATTERN.test(email))
	const isFull = form.emails.length >= MAX_INVITES
	return h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", "onboarding-step-invite")],
		[
			stepHeader(h, {
				title: "Invite your team",
				description:
					"Collaboration is better together. Invite teammates to join your workspace (you can also do this later).",
			}),
			h.div(
				[h.Class("space-y-3")],
				[
					...form.emails.map((email, index) => emailField(h, form, interaction, email, index)),
					button(
						h,
						{
							intent: "secondary",
							className: "w-full",
							isDisabled: isFull,
							onPress: Message.ClickedAddEmail(),
						},
						[IconPlus(h, { className: "size-4" }), "Add another email"],
					),
					...(isFull
						? [
								description(h, {}, [
									"Maximum of 10 invites at a time. You can invite more later.",
								]),
							]
						: []),
				],
			),
			onboardingNavigation(h, {
				onContinue: Message.ClickedContinueInvite(),
				isLoading: form.isLoading,
				continueLabel: hasValidEmails ? "Send invites" : "Skip for now",
			}),
		],
	)
}
