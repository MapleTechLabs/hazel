import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose, IconOffice } from "../../../icons"
import { searchOptions } from "../../../customers/channels"
import { customerRoute, hrefOf } from "../../../route"
import { button } from "../../../ui/button"
import { heading } from "../../../ui/heading"
import { input } from "../../../ui/input"
import { link } from "../../../ui/link"
import * as Popover from "../../../ui/popover"
import * as Field from "../../../ui/field"
import { textField } from "../../../ui/text-field"
import type { PageViewInputs } from "../../contract"
import { channelIcon, tabHeader } from "../section-header"
import { Message } from "./message"
import { canSave, type Form, isSubmitting, type Model, nameInputTarget, saveButtonTarget } from "./model"
import { interaction } from "./update"

/** Port of `channels/$channelId/settings/overview.tsx`. */

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
							attributes: [
								h.AriaLabel("Change channel icon"),
								h.Attribute("aria-expanded", "false"),
							],
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
										attributes: [h.AriaLabel("Remove channel icon")],
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
	const wiring = interaction.wiring(model)
	const isEnabled = canSave(form)
	const nameError = form.name._tag === "Invalid" ? form.name.errors[0] : null
	return h.form(
		[h.Class("flex flex-col gap-6"), h.OnSubmit(Message.SubmittedForm())],
		[
			iconField(h, form),
			textField(
				h,
				{
					id: "channel-name",
					value: form.name.value,
					onInput: toChangedName,
					isInvalid: nameError !== null,
				},
				(field) => [
					field.label(["Channel name"]),
					field.input({
						placeholder: "Channel name",
						interaction: { wiring, target: nameInputTarget },
					}),
					field.fieldError([nameError ?? ""]),
				],
			),
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
						[isSubmitting(form) ? "Saving..." : "Save changes"],
					),
				],
			),
		],
	)
}

/** The customer picker: search the org's customers (the list loads while it is open). */
const customerPicker = (h: HtmlBuilder<Message>, model: Model, label: string): Html => {
	const candidates =
		model.customers === null
			? []
			: searchOptions(
					model.customers.filter((customer) => customer.id !== model.customer?.accountId),
					model.customerSearch,
				)
	return h.submodel({
		slotId: model.customerPopover.id,
		model: model.customerPopover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) =>
				button(
					h,
					{
						intent: "outline",
						size: "sm",
						isDisabled: model.customerLinking !== "Idle",
						attributes: [...attributes],
					},
					[model.customerLinking === "Linking" ? "Linking…" : label],
				),
			toContent: () => [
				h.div(
					[h.Class("flex w-72 flex-col gap-1 p-2")],
					[
						input(h, {
							placeholder: "Search customers",
							attributes: [
								h.AriaLabel("Search customers"),
								h.Value(model.customerSearch),
								h.OnInput((value) => Message.ChangedCustomerSearch({ value })),
							],
						}),
						...(model.customers === null
							? [h.p([h.Class("px-2 py-3 text-muted-fg text-sm")], ["Loading customers…"])]
							: candidates.length === 0
								? [
										h.p(
											[h.Class("px-2 py-3 text-muted-fg text-sm")],
											[
												model.customers.length === 0
													? "No customers yet. Connect a data source in Customers."
													: "No customer matches.",
											],
										),
									]
								: candidates.map((customer) =>
										button(
											h,
											{
												intent: "plain",
												size: "sm",
												className: "w-full justify-start",
												onPress: Message.PressedLinkCustomer({
													accountId: customer.id,
												}),
												attributes: [h.Key(customer.id)],
											},
											[
												IconOffice(h, { className: "size-4 shrink-0 text-muted-fg" }),
												h.span(
													[h.Class("min-w-0 truncate text-left")],
													[customer.name],
												),
											],
										),
									)),
					],
				),
			],
			placement: "bottom start",
		},
		toParentMessage: (message) => Message.GotCustomerPopoverMessage({ message }),
	})
}

/** Which customer this channel is with: shown in chat and on the customer's page. */
const customerSection = (h: HtmlBuilder<Message>, model: Model, orgSlug: string | null): Html =>
	h.section(
		[h.Class("flex flex-col gap-3 border-border border-t pt-6")],
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					heading(h, { variant: "subsection", level: 2 }, ["Customer"]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"Link this channel to the customer you talk to in it. Members see the customer in the channel, and the channel shows on the customer's page.",
						],
					),
				],
			),
			model.customer === null
				? h.div([h.Class("flex items-center gap-3")], [customerPicker(h, model, "Link to customer")])
				: h.div(
						[h.Class("flex flex-wrap items-center gap-3")],
						[
							h.div(
								[
									h.Class(
										"flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2",
									),
								],
								[
									IconOffice(h, { className: "size-4 shrink-0 text-muted-fg" }),
									orgSlug === null
										? h.span(
												[h.Class("truncate font-medium text-sm")],
												[model.customer.accountName],
											)
										: link(
												h,
												{
													href: hrefOf(
														customerRoute(orgSlug, model.customer.accountId),
													),
													className: "truncate font-medium text-fg text-sm",
												},
												[model.customer.accountName],
											),
								],
							),
							customerPicker(h, model, "Change"),
							button(
								h,
								{
									intent: "plain",
									size: "sm",
									isDisabled: model.customerLinking !== "Idle",
									onPress: Message.PressedUnlinkCustomer(),
								},
								[model.customerLinking === "Unlinking" ? "Unlinking…" : "Unlink"],
							),
						],
					),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			tabHeader(h, "Overview", "General information about this channel."),
			...(model.form === null ? [] : [settingsForm(h, model, model.form)]),
			...(model.form === null ? [] : [customerSection(h, model, shared.orgSlug ?? null)]),
		],
	),
)
