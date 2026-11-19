import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { FEATURE_FLAG_KEY } from "../../../../customers/feature-flags"
import { formatCount } from "../../../../customers/format"
import { companyLogo } from "../../../../customers/ui/identity"
import {
	IconChevronDown,
	IconChevronRight,
	IconClose,
	IconPlus,
	IconRocket,
	IconTrash,
} from "../../../../icons"
import { customerRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { checkbox } from "../../../../ui/checkbox"
import { dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import { emptyState } from "../../../../ui/empty-state"
import * as Field from "../../../../ui/field"
import { input } from "../../../../ui/input"
import { link } from "../../../../ui/link"
import { loader } from "../../../../ui/loader"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"
import type { PageViewInputs } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { customersWith, flagKeysOf, type Model } from "./model"

const SUBTITLE =
	"The boolean keys of your customers’ Clerk organization metadata. Turning a flag on or off writes to Clerk."

const CARD = "flex flex-col rounded-xl border border-border bg-bg"
const icon = { attributes: { "data-slot": "icon" } }

const KEY_ERROR_ID = "feature-flag-new-key-error"

const createForm = (h: HtmlBuilder<Message>, model: Model): Html => {
	const key = model.newKey.trim()
	const isInvalid = key !== "" && !FEATURE_FLAG_KEY.test(key)
	return h.form(
		[h.Class("flex flex-col gap-1.5"), h.OnSubmit(Message.SubmittedNewKey())],
		[
			h.div(
				[h.Class("flex gap-2")],
				[
					input(h, {
						placeholder: "new_flag_key",
						isInvalid,
						attributes: [
							h.AriaLabel("New feature flag key"),
							h.Value(model.newKey),
							h.OnInput((value) => Message.ChangedNewKey({ value })),
							...(isInvalid ? [h.AriaDescribedBy(KEY_ERROR_ID)] : []),
						],
					}),
					button(
						h,
						{ size: "sm", isDisabled: key === "" || isInvalid, attributes: [h.Type("submit")] },
						[IconPlus(h, icon), "Create flag"],
					),
				],
			),
			...(isInvalid
				? [
						h.p(
							[h.Id(KEY_ERROR_ID), h.Class("text-danger-subtle-fg text-xs")],
							[
								"Use letters, digits, _ . : or -, at most 64 characters, starting with a letter or digit.",
							],
						),
					]
				: []),
		],
	)
}

/** The "Add customers" picker: tick the customers that don't have the flag, then turn it on for all. */
const customerPicker = (h: HtmlBuilder<Message>, model: Model, key: string): Html => {
	const search = model.customerSearch.trim().toLowerCase()
	const candidates = (model.accounts ?? []).filter(
		(account) =>
			account.featureFlags[key] !== true &&
			(search === "" ||
				account.name.toLowerCase().includes(search) ||
				(account.domain ?? "").includes(search)),
	)
	const count = model.customerSelection.length
	return h.submodel({
		slotId: model.customerPopover.id,
		model: model.customerPopover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes) =>
				button(h, { intent: "outline", size: "xs", attributes: [...attributes] }, [
					IconPlus(h, icon),
					"Add customers",
				]),
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
						candidates.length === 0
							? h.p(
									[h.Class("px-2 py-3 text-muted-fg text-sm")],
									[
										(model.accounts ?? []).length === 0
											? "No customers yet."
											: search === ""
												? "Every customer already has this flag."
												: "No customer matches.",
									],
								)
							: h.div(
									[h.Class("flex max-h-64 flex-col gap-1 overflow-y-auto px-1 py-1")],
									candidates.map((account) =>
										h.div(
											[h.Key(account.id)],
											[
												checkbox(
													h,
													{
														id: `feature-flag-customer-${account.id}`,
														isSelected: model.customerSelection.includes(
															account.id,
														),
														onChange: (isSelected) =>
															Message.ToggledCustomer({
																accountId: account.id,
																isSelected,
															}),
													},
													[
														// One label cell of the checkbox grid: the logo beside the name.
														Field.label(
															h,
															{
																elementType: "span",
																className: "flex min-w-0 items-center gap-2",
															},
															[
																companyLogo(h, {
																	name: account.name,
																	logoUrl: account.logoUrl,
																	size: "xs",
																}),
																h.span([h.Class("truncate")], [account.name]),
															],
														),
													],
												),
											],
										),
									),
								),
						button(
							h,
							{ size: "sm", isDisabled: count === 0, onPress: Message.PressedAddCustomers() },
							[count <= 1 ? "Turn on" : `Turn on for ${formatCount(count)} customers`],
						),
					],
				),
			],
			placement: "bottom start",
		},
		toParentMessage: (message) => Message.GotCustomerPopoverMessage({ message }),
	})
}

/** The selected flag's customers: each links to its page; admins take it off or add more. */
const flagCustomers = (
	h: HtmlBuilder<Message>,
	model: Model,
	key: string,
	orgSlug: string,
	canEdit: boolean,
): Html => {
	const customers = customersWith(model, key)
	return h.div(
		[h.Class("flex flex-col gap-1 bg-secondary/30 px-4 py-3 sm:px-5")],
		[
			...(customers.length === 0
				? [h.p([h.Class("py-1 text-muted-fg text-sm")], ["No customer has this flag on."])]
				: customers.map((account) =>
						h.div(
							[h.Key(account.id), h.Class("flex min-h-9 items-center gap-2")],
							[
								companyLogo(h, { name: account.name, logoUrl: account.logoUrl }),
								link(
									h,
									{
										href: hrefOf(customerRoute(orgSlug, account.id)),
										className: "min-w-0 flex-1 truncate text-fg text-sm",
									},
									[account.name],
								),
								...(canEdit
									? [
											button(
												h,
												{
													intent: "plain",
													size: "sq-xs",
													onPress: Message.PressedRemoveCustomer({
														accountId: account.id,
													}),
													attributes: [
														h.AriaLabel(`Turn ${key} off for ${account.name}`),
													],
												},
												[IconClose(h, icon)],
											),
										]
									: []),
							],
						),
					)),
			...(canEdit ? [h.div([h.Class("pt-1")], [customerPicker(h, model, key)])] : []),
		],
	)
}

const flagRow = (
	h: HtmlBuilder<Message>,
	model: Model,
	key: string,
	orgSlug: string,
	canEdit: boolean,
): Html => {
	const isOpen = model.selectedKey === key
	const count = customersWith(model, key).length
	return h.li(
		[h.Key(key), h.Class("flex flex-col")],
		[
			h.div(
				[h.Class("flex items-center gap-2 px-2 py-1.5 sm:px-3")],
				[
					button(
						h,
						{
							intent: "plain",
							size: "sm",
							className: "min-w-0 flex-1 justify-start",
							onPress: Message.PressedFlag({ key }),
							attributes: [h.Attribute("aria-expanded", isOpen ? "true" : "false")],
						},
						[
							(isOpen ? IconChevronDown : IconChevronRight)(h, icon),
							h.span([h.Class("min-w-0 flex-1 truncate text-left font-mono")], [key]),
							h.span(
								[h.Class("shrink-0 text-muted-fg text-xs")],
								[count === 1 ? "1 customer" : `${formatCount(count)} customers`],
							),
						],
					),
					...(canEdit
						? [
								button(
									h,
									{
										intent: "plain",
										size: "sq-xs",
										onPress: Message.PressedDeleteFlag({ key }),
										attributes: [h.AriaLabel(`Delete ${key}`)],
									},
									[IconTrash(h, icon)],
								),
							]
						: []),
				],
			),
			...(isOpen ? [flagCustomers(h, model, key, orgSlug, canEdit)] : []),
		],
	)
}

const flagsCard = (h: HtmlBuilder<Message>, model: Model, orgSlug: string, canEdit: boolean): Html => {
	const keys = flagKeysOf(model)
	if (keys.length === 0)
		return emptyState(h, {
			title: "No feature flags yet",
			icon: (className) => IconRocket(h, { className }),
			description:
				"Flags show up here once a Clerk organization has a boolean in its public metadata, or when you create one.",
			className: CARD,
		})
	return h.ul(
		[h.Class(`${CARD} divide-y divide-border`)],
		keys.map((key) => flagRow(h, model, key, orgSlug, canEdit)),
	)
}

const deleteDialog = (h: HtmlBuilder<Message>, model: Model): Html => {
	const key = model.deletingKey ?? ""
	const count = model.accounts?.filter((account) => Object.hasOwn(account.featureFlags, key)).length ?? 0
	return Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: (message) => Message.GotDeleteModalMessage({ message }),
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				// A key is one word up to 64 characters: it breaks rather than widening the dialog.
				className: "wrap-anywhere",
				title: { id: Modal.titleId(model.deleteModal.id), text: `Delete ${key}?` },
				description:
					count === 0
						? "No customer has it, so nothing changes in Clerk."
						: `It's removed from the Clerk metadata of ${count === 1 ? "1 customer" : `${formatCount(count)} customers`}. This can't be undone.`,
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDelete() }, ["Delete flag"]),
			]),
		],
	})
}

/** Feature flags settings: every flag, opening to its customers; admins create, delete and assign. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const canEdit = isCustomersAdmin(shared)
	const orgSlug = shared.orgSlug ?? ""
	return settingsPage(h, [
		settingsHeader(h, { title: "Feature flags", subtitle: SUBTITLE }),
		...(canEdit ? [createForm(h, model)] : [readOnlyNotice(h, "feature flags")]),
		model.accounts === null
			? h.div(
					[h.Class("flex justify-center py-16")],
					[loader(h, { ariaLabel: "Loading feature flags" })],
				)
			: flagsCard(h, model, orgSlug, canEdit),
		deleteDialog(h, model),
	])
})
