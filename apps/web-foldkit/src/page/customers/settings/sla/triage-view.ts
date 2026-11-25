import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../../ui/button"
import { switchControl } from "../../../../ui/switch"
import { textarea } from "../../../../ui/textarea"
import { Message } from "./message"
import { ABOUT_MAX, type Model, triageFormOf } from "./model"
import { card, field, fieldLabel, help } from "./parts"

/**
 * Support triage (`docs/customers/issues.md` § Triage): whether new conversations are put to the
 * model before they reach the queue, and what the team supports, which is what "about our
 * product" is judged against.
 */

type H = HtmlBuilder<Message>

const ENABLED_ID = "support-triage-enabled"
const ABOUT_ID = "support-triage-about"
const ABOUT_HELP_ID = "support-triage-about-help"

export const sameTriage = (a: Customers.SupportTriageSettings, b: Customers.SupportTriageSettings): boolean =>
	a.enabled === b.enabled && a.about.trim() === b.about.trim()

export const triageCard = (h: H, model: Model, canEdit: boolean): Html => {
	const form = triageFormOf(model)
	const saved = model.settings?.supportTriage ?? Customers.DEFAULT_SUPPORT_TRIAGE
	const isDirty = model.triageForm !== null && !sameTriage(model.triageForm, saved)
	// Not before the saved settings are here: an edit would start from the defaults, not from them.
	const isDisabled = !canEdit || model.isSavingTriage || model.settings === null
	// As it is saved: trimmed.
	const isTooLong = form.about.trim().length > ABOUT_MAX
	return card(
		h,
		{
			title: "Triage",
			description:
				"Customers chat in linked channels, and most of it is not a request. Triage reads each new conversation, files what is not support under Filtered in the inbox, and joins a message to the conversation it continues.",
		},
		[
			switchControl(
				h,
				{
					id: ENABLED_ID,
					isSelected: form.enabled,
					isDisabled,
					onChange: (enabled) => Message.ToggledTriage({ enabled }),
				},
				"Triage new conversations",
			),
			field(h, [
				fieldLabel(h, "What your team supports", ABOUT_ID),
				textarea(h, {
					className: "min-h-24",
					placeholder:
						"Acme is a billing API. Support covers the API, the dashboard, invoices and account access.",
					isDisabled: isDisabled || !form.enabled,
					isInvalid: isTooLong,
					attributes: [
						h.Id(ABOUT_ID),
						h.Rows(3),
						h.Value(form.about),
						h.AriaDescribedBy(ABOUT_HELP_ID),
						h.OnInput((value) => Message.ChangedTriageAbout({ value })),
					],
				}),
				h.p(
					[
						h.Id(ABOUT_HELP_ID),
						h.Class(isTooLong ? "text-danger-subtle-fg text-xs" : "text-muted-fg text-xs"),
					],
					[
						isTooLong
							? `At most ${ABOUT_MAX.toLocaleString("en-US")} characters.`
							: "A sentence or two. Without it, talk about other tools can read as a product question. It is sent to the model with each conversation, never shown to customers.",
					],
				),
			]),
			...(canEdit && model.triageForm !== null
				? [
						h.div(
							[h.Class("flex flex-wrap items-center justify-end gap-2")],
							[
								...(isDirty ? [] : [help(h, "No changes")]),
								button(
									h,
									{
										intent: "plain",
										size: "sm",
										isDisabled: model.isSavingTriage,
										onPress: Message.PressedResetTriage(),
									},
									["Reset"],
								),
								button(
									h,
									{
										size: "sm",
										onPress: Message.PressedSaveTriage(),
										isDisabled: !isDirty || isTooLong || model.settings === null,
										isPending: model.isSavingTriage,
									},
									["Save triage"],
								),
							],
						),
					]
				: []),
		],
	)
}
