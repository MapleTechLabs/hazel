import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose, IconPlus } from "../../../icons"
import type * as Interaction from "../../../ui/aria/interaction"
import { button } from "../../../ui/button"
import { description } from "../../../ui/field"
import { textField } from "../../../ui/text-field"
import { Message } from "../message"
import type { InviteRow, StepOf } from "../model"
import { autoFocus, onboardingNavigation, stepHeader } from "../navigation"
import { hasSendableEmails, MAX_INVITES } from "../validation"

/** `invite-team-step.tsx` */

type InviteForm = StepOf<"Invite">

/** Keyed by the row's id, so removing a row keeps every other input (and its focus) in place. */
const emailField = (
	h: HtmlBuilder<Message>,
	form: InviteForm,
	interaction: Interaction.Wiring<Message>,
	row: InviteRow,
	index: number,
): Html =>
	h.keyed("div")(
		`invite-row-${row.id}`,
		[],
		[
			textField(
				h,
				{
					id: `onboarding-invite-${row.id}`,
					value: row.email,
					isInvalid: Option.isSome(row.error),
					onInput: (value) => Message.ChangedEmail({ rowId: row.id, value }),
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
							...(form.rows.length > 1
								? [
										button(
											h,
											{
												intent: "secondary",
												size: "sq-sm",
												onPress: Message.ClickedRemoveEmail({ rowId: row.id }),
												attributes: [h.AriaLabel("Remove email")],
											},
											[IconClose(h, { className: "size-4" })],
										),
									]
								: []),
						],
					),
					...(Option.isSome(row.error)
						? [parts.fieldError(["Please enter a valid email address"])]
						: []),
				],
			),
		],
	)

export const inviteStep = (
	h: HtmlBuilder<Message>,
	form: InviteForm,
	interaction: Interaction.Wiring<Message>,
): Html => {
	const isFull = form.rows.length >= MAX_INVITES
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
					...form.rows.map((row, index) => emailField(h, form, interaction, row, index)),
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
									`Maximum of ${MAX_INVITES} invites at a time. You can invite more later.`,
								]),
							]
						: []),
				],
			),
			onboardingNavigation(h, {
				onContinue: Message.ClickedContinueInvite(),
				isLoading: form.isSending,
				continueLabel: hasSendableEmails(form.rows) ? "Send invites" : "Skip for now",
			}),
		],
	)
}
