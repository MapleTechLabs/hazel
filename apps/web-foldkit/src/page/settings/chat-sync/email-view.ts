import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import {
	IconCopy,
	IconEdit,
	IconEnvelope,
	IconHashtag,
	IconPlus,
	IconTrash,
	IconWarning,
} from "../../../icons"
import { ariaButton, button } from "../../../ui/button"
import {
	dialogBody,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../../ui/dialog"
import { description, fieldError, label } from "../../../ui/field"
import { heading } from "../../../ui/heading"
import * as Modal from "../../../ui/modal"
import { textField } from "../../../ui/text-field"
import type * as ConfirmAction from "../../shared/confirm-action"
import { confirmDialog } from "./confirm-dialog"
import {
	EMAIL_CHANNEL_SEARCH_ID,
	EMAIL_INBOUND_ADDRESS_ID,
	EMAIL_NAME_ID,
	EMAIL_SUPPORT_ADDRESS_ID,
	NAME_MAX_LENGTH,
	nameError,
	supportAddressError,
} from "./email"
import { filterByName, scrollList, searchInput } from "./modal-parts"
import {
	type EmailForm,
	type EmailInbox,
	type HazelChannel,
	Message,
	type Model,
	STATUS_CONFIG,
} from "./model"

/**
 * The Email support inboxes (`docs/customers/email.md`): each forwards a support address to a Hazel
 * channel, where every email becomes a thread and replies in it go back as email.
 */

const toEmailModalMessage = (message: Modal.Message) => Message.GotEmailModalMessage({ message })
const toRemoveInboxConfirmMessage = (message: ConfirmAction.Message) =>
	Message.GotRemoveInboxConfirmMessage({ message })

const channelNameOf = (model: Model, inbox: EmailInbox): string | null =>
	inbox.hazelChannelId === null
		? null
		: (model.hazelChannels.find((channel) => channel.id === inbox.hazelChannelId)?.name ?? null)

const envelopeTile = (h: HtmlBuilder<Message>, sizeClass: string, iconClass: string): Html =>
	h.div(
		[
			h.Class(
				`flex shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-fg ring-1 ring-border ${sizeClass}`,
			),
		],
		[IconEnvelope(h, { className: iconClass })],
	)

const channelTag = (h: HtmlBuilder<Message>, name: string | null): Html =>
	h.span(
		[h.Class("inline-flex min-w-0 items-center gap-1 text-fg")],
		[
			IconHashtag(h, { className: "size-3.5 shrink-0 text-muted-fg" }),
			h.span([h.Class("truncate")], [name ?? "private channel"]),
		],
	)

const copyButton = (h: HtmlBuilder<Message>, address: string): Html =>
	button(
		h,
		{
			intent: "outline",
			size: "sq-sm",
			onPress: Message.ClickedCopyInboundAddress({ address }),
			attributes: [h.AriaLabel("Copy forwarding address"), h.Title("Copy forwarding address")],
		},
		[IconCopy(h, { className: "size-4" })],
	)

/** The address to forward to, in a mono box with its copy button. */
const forwardingAddress = (h: HtmlBuilder<Message>, inbox: EmailInbox, id?: string): Html =>
	inbox.inboundAddress === null
		? h.p(
				[h.Class("text-muted-fg text-sm")],
				["The forwarding address is not ready yet. Check back shortly."],
			)
		: h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.code(
						[
							...(id === undefined ? [] : [h.Id(id)]),
							h.Class(
								"min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-muted/40 px-3 py-2 font-mono text-fg text-sm select-all",
							),
						],
						[inbox.inboundAddress],
					),
					copyButton(h, inbox.inboundAddress),
				],
			)

// --- The section --------------------------------------------------------------------------------

const inboxRow = (h: HtmlBuilder<Message>, model: Model, inbox: EmailInbox): Html => {
	const status = STATUS_CONFIG[inbox.status]
	return h.keyed("li")(
		inbox.id,
		[h.Class("flex flex-col gap-3 p-4"), h.DataAttribute("testid", "email-inbox")],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-3")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col gap-1")],
						[
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									heading(h, { variant: "subsection", className: "truncate" }, [
										inbox.displayName,
									]),
									h.span(
										[h.Class("flex items-center gap-1.5")],
										[
											h.span([h.Class(`size-1.5 rounded-full ${status.dotClass}`)]),
											h.span([h.Class(`text-xs ${status.textClass}`)], [status.label]),
										],
									),
								],
							),
							h.div(
								[
									h.Class(
										"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-fg text-xs",
									),
								],
								[
									channelTag(h, channelNameOf(model, inbox)),
									h.span([h.Attribute("aria-hidden", "true")], ["·"]),
									h.span(
										[h.Class("truncate")],
										[
											inbox.supportAddress === null
												? "Replies come from the forwarding address"
												: `Replies to ${inbox.supportAddress}`,
										],
									),
								],
							),
							...(inbox.errorMessage === null
								? []
								: [h.p([h.Class("text-danger text-xs")], [inbox.errorMessage])]),
						],
					),
					h.div(
						[h.Class("flex shrink-0 items-center gap-1")],
						[
							button(
								h,
								{
									intent: "plain",
									size: "sm",
									onPress: Message.ClickedEmailSetup({ inbox }),
								},
								["Setup guide"],
							),
							button(
								h,
								{
									intent: "plain",
									size: "sq-sm",
									onPress: Message.ClickedEditEmailInbox({ inbox }),
									attributes: [h.AriaLabel("Edit inbox"), h.Title("Edit inbox")],
								},
								[IconEdit(h, { className: "size-4" })],
							),
							button(
								h,
								{
									intent: "plain",
									size: "sq-sm",
									onPress: Message.ClickedRemoveEmailInbox({
										target: { id: inbox.id, name: inbox.displayName },
									}),
									attributes: [h.AriaLabel("Remove inbox"), h.Title("Remove inbox")],
								},
								[IconTrash(h, { className: "size-4" })],
							),
						],
					),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-1.5")],
				[
					h.span([h.Class("text-muted-fg text-xs")], ["Forward your support address to"]),
					forwardingAddress(h, inbox),
				],
			),
		],
	)
}

const addInboxButton = (h: HtmlBuilder<Message>): Html =>
	button(h, { intent: "outline", size: "sm", onPress: Message.ClickedAddEmailInbox() }, [
		IconPlus(h, { className: "size-4" }),
		"Add inbox",
	])

/** The Email card: what it does, Add inbox, and each inbox. */
export const emailSection = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.section(
		[
			h.AriaLabelledBy("chat-sync-email-heading"),
			h.Class("mt-6 flex flex-col overflow-hidden rounded-xl border border-border bg-bg"),
		],
		[
			h.div(
				[h.Class("flex items-start justify-between gap-4 p-5")],
				[
					h.div(
						[h.Class("flex items-start gap-3")],
						[
							envelopeTile(h, "size-10", "size-5"),
							h.div(
								[h.Class("flex flex-col gap-1")],
								[
									heading(
										h,
										{ variant: "section", attributes: [h.Id("chat-sync-email-heading")] },
										["Email"],
									),
									h.p(
										[h.Class("max-w-prose text-muted-fg text-sm")],
										[
											"Forward your support address to a Hazel channel. Each email becomes a thread; replies in the thread go back as email.",
										],
									),
								],
							),
						],
					),
					addInboxButton(h),
				],
			),
			model.emailInboxes.length === 0
				? h.p(
						[h.Class("border-border border-t bg-bg-muted/30 px-5 py-4 text-muted-fg text-sm")],
						["No inboxes yet."],
					)
				: h.ul(
						[h.Class("divide-y divide-border border-border border-t")],
						model.emailInboxes.map((inbox) => inboxRow(h, model, inbox)),
					),
		],
	)

// --- The modal ----------------------------------------------------------------------------------

const isSaving = (form: EmailForm) => form.submission._tag === "Submitting"

const nameField = (h: HtmlBuilder<Message>, form: EmailForm): Html => {
	const error = form.isValidated ? nameError(form.name) : null
	return textField(
		h,
		{
			id: EMAIL_NAME_ID,
			value: form.name,
			onInput: (value) => Message.ChangedEmailName({ value }),
			isInvalid: error !== null,
			isDisabled: isSaving(form),
			isRequired: true,
		},
		(parts) => [
			parts.label(["Name"]),
			parts.input({
				placeholder: "Acme Support",
				attributes: [
					h.Attribute("autocomplete", "off"),
					h.Attribute("maxlength", String(NAME_MAX_LENGTH)),
				],
			}),
			parts.description(["Replies are sent from this name."]),
			parts.fieldError([error ?? ""]),
		],
	)
}

const supportAddressField = (h: HtmlBuilder<Message>, form: EmailForm): Html => {
	const error = form.isValidated ? supportAddressError(form.supportAddress) : null
	return textField(
		h,
		{
			id: EMAIL_SUPPORT_ADDRESS_ID,
			value: form.supportAddress,
			onInput: (value) => Message.ChangedEmailSupportAddress({ value }),
			isInvalid: error !== null,
			isDisabled: isSaving(form),
		},
		(parts) => [
			parts.label(["Support address ", h.span([h.Class("font-normal text-muted-fg")], ["(optional)"])]),
			parts.input({
				placeholder: "support@acme.com",
				attributes: [
					h.Type("email"),
					h.Attribute("autocomplete", "off"),
					h.Attribute("spellcheck", "false"),
				],
			}),
			parts.description(["The address customers write to. Replies carry it as Reply-To."]),
			parts.fieldError([error ?? ""]),
		],
	)
}

const channelRow = (h: HtmlBuilder<Message>, channel: HazelChannel): Html =>
	h.keyed("div")(
		channel.id,
		[],
		[
			ariaButton(
				h,
				{
					onPress: Message.ClickedEmailChannel({ channel }),
					className:
						"group flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-secondary focus-visible:bg-secondary",
				},
				[
					IconHashtag(h, { className: "size-4 shrink-0 text-muted-fg group-hover:text-fg" }),
					h.span([h.Class("truncate text-fg")], [channel.name]),
				],
			),
		],
	)

const CHANNEL_ERROR_ID = `${EMAIL_CHANNEL_SEARCH_ID}-error`

const channelField = (h: HtmlBuilder<Message>, model: Model, form: EmailForm): Html => {
	const isMissing = form.isValidated && form.channel === null
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[
			label(h, { elementType: "span" }, ["Channel"]),
			...(form.channel === null
				? [
						searchInput(h, {
							id: EMAIL_CHANNEL_SEARCH_ID,
							placeholder: "Search channels...",
							value: form.channelSearch,
							isFocused: form.isChannelSearchFocused,
							onInput: (value) => Message.ChangedEmailChannelSearch({ value }),
							onFocus: Message.FocusedEmailChannelSearch(),
							onBlur: Message.BlurredEmailChannelSearch(),
						}),
						scrollList(
							h,
							"max-h-44",
							"No channels found",
							filterByName(model.hazelChannels, form.channelSearch).map((channel) =>
								channelRow(h, channel),
							),
						),
					]
				: [
						h.div(
							[
								h.Class(
									"flex h-11 items-center gap-2.5 rounded-lg border border-border bg-secondary/30 pr-1.5 pl-3",
								),
							],
							[
								IconHashtag(h, { className: "size-4 shrink-0 text-fg" }),
								h.span(
									[h.Class("min-w-0 flex-1 truncate font-medium text-fg text-sm")],
									[form.channel.name],
								),
								button(
									h,
									{
										intent: "plain",
										size: "xs",
										isDisabled: isSaving(form),
										onPress: Message.ClickedChangeEmailChannel(),
									},
									["Change"],
								),
							],
						),
					]),
			isMissing
				? fieldError(h, { id: CHANNEL_ERROR_ID }, ["Pick the channel emails arrive in."])
				: description(h, {}, ["Each email becomes a thread in this channel."]),
		],
	)
}

const formContent = (
	h: HtmlBuilder<Message>,
	model: Model,
	form: EmailForm,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const isEdit = form.step._tag === "Edit"
	const saving = isSaving(form)
	return [
		dialogHeader(h, {}, [
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					envelopeTile(h, "size-10", "size-5"),
					dialogTitle(
						h,
						{ id: Modal.titleId(model.emailModal.id) },
						isEdit ? "Edit inbox" : "Add email inbox",
					),
				],
			),
			dialogDescription(
				h,
				isEdit
					? "Change the name replies are sent from, or the address they carry as Reply-To."
					: "Forward your support address to a Hazel channel. Each email becomes a thread; replies in the thread go back as email.",
			),
		]),
		dialogBody(
			h,
			[
				nameField(h, form),
				supportAddressField(h, form),
				...(form.step._tag === "Create" ? [channelField(h, model, form)] : []),
			],
			"flex flex-col gap-5",
		),
		dialogFooter(h, [
			dialogClose(h, closeAttributes, ["Cancel"], "secondary"),
			button(
				h,
				{
					intent: "primary",
					onPress: Message.ClickedSubmitEmailInbox(),
					isDisabled: saving,
					isPending: saving,
				},
				[saving ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save" : "Create inbox"],
			),
		]),
	]
}

const setupStep = (
	h: HtmlBuilder<Message>,
	title: string,
	steps: ReadonlyArray<ReadonlyArray<Html | string>>,
): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			heading(h, { variant: "subsection" }, [title]),
			h.ol(
				[
					h.Class(
						"flex list-decimal flex-col gap-1.5 pl-5 text-muted-fg text-sm marker:text-muted-fg",
					),
				],
				steps.map((step) => h.li([], [...step])),
			),
		],
	)

const strong = (h: HtmlBuilder<Message>, text: string): Html =>
	h.span([h.Class("font-medium text-fg")], [text])

const setupContent = (
	h: HtmlBuilder<Message>,
	model: Model,
	inbox: EmailInbox,
	isNew: boolean,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const channel = `#${channelNameOf(model, inbox) ?? "the channel"}`
	const support = inbox.supportAddress ?? "your support address"
	return [
		dialogHeader(h, {}, [
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					envelopeTile(h, "size-10", "size-5"),
					dialogTitle(
						h,
						{ id: Modal.titleId(model.emailModal.id) },
						isNew ? `${inbox.displayName} is ready` : `Set up ${inbox.displayName}`,
					),
				],
			),
			dialogDescription(h, [
				"Forward ",
				strong(h, support),
				" to the address below. New emails arrive as threads in ",
				strong(h, channel),
				".",
			]),
		]),
		dialogBody(
			h,
			[
				h.div(
					[h.Class("flex flex-col gap-1.5")],
					[
						label(h, { elementType: "span" }, ["Forwarding address"]),
						forwardingAddress(h, inbox, EMAIL_INBOUND_ADDRESS_ID),
					],
				),
				setupStep(h, "Google Workspace", [
					[
						"In Gmail, open ",
						strong(h, "Settings → See all settings → Forwarding and POP/IMAP"),
						".",
					],
					["Choose ", strong(h, "Add a forwarding address"), " and paste the address above."],
					[
						"Gmail sends a confirmation email. It appears as a thread in ",
						strong(h, channel),
						"; open its link to confirm.",
					],
					["Turn on ", strong(h, "Forward a copy of incoming mail"), " to the address and save."],
				]),
				setupStep(h, "Microsoft 365", [
					[
						"In the Exchange admin center, open ",
						strong(h, "Mail flow → Rules"),
						" and add a rule for messages sent to ",
						strong(h, support),
						".",
					],
					["Set it to redirect (or Bcc) the message to the address above, then save the rule."],
				]),
			],
			"flex flex-col gap-6",
		),
		dialogFooter(h, [dialogClose(h, closeAttributes, ["Done"], "primary")]),
	]
}

const emailModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.emailModal,
		toParentMessage: toEmailModalMessage,
		size: "md",
		toContent: (closeAttributes) => {
			const form = model.emailForm
			return form.step._tag === "Setup"
				? setupContent(h, model, form.step.inbox, form.step.isNew, closeAttributes)
				: formContent(h, model, form, closeAttributes)
		},
	})

const removeInboxModal = (h: HtmlBuilder<Message>, model: Model): Html =>
	confirmDialog(h, {
		slotId: "remove-email-inbox",
		confirm: model.removeInboxConfirm,
		icon: IconWarning(h, { className: "size-6 text-danger" }),
		title: "Remove inbox",
		description: (target) => [
			"Remove",
			target.name,
			"? Emails forwarded to its address stop arriving. Its threads stay in the channel.",
		],
		confirmLabel: "Remove inbox",
		pendingLabel: "Removing...",
		onConfirm: Message.ClickedConfirmRemoveEmailInbox(),
		toParentMessage: toRemoveInboxConfirmMessage,
	})

/** The inbox form / setup modal and the remove confirmation. */
export const emailModals = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Html> => [
	emailModal(h, model),
	removeInboxModal(h, model),
]
