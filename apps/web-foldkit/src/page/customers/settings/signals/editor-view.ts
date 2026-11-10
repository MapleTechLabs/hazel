import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { formatCount, formatDate } from "../../../../customers/format"
import { kindChip } from "../../../../customers/ui/badges"
import { IconLock, IconTrash } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import { input } from "../../../../ui/input"
import * as Modal from "../../../../ui/modal"
import type { Shared } from "../../../contract"
import { type Crumb, isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { conditionCards } from "./condition-view"
import { plainWords, renderParts } from "./describe"
import { editorStatus, type EditorStatus, scopeOf } from "./draft"
import { metricNameOf } from "./list-view"
import { Message } from "./message"
import { currencyOf, type Editor, type Model, type RuleForm } from "./model"
import { card, errorIdOf, fieldError, severityPicker, templateTile } from "./parts"
import { previewCard } from "./preview-view"
import { scopeCard } from "./scope-view"

/** The rule editor (Wonder `ati`, `mia`): the rule, its condition and scope, and the live preview. */

type H = HtmlBuilder<Message>

const NAME_ID = "signal-rule-name"

const toName = (value: string) => Message.ChangedName({ value })
const toSeverity = (severity: Customers.SignalSeverity) => Message.ClickedSeverity({ severity })
const toDiscardModal = (message: Modal.Message) => Message.GotDiscardModalMessage({ message })
const toDeleteModal = (message: Modal.Message) => Message.GotDeleteModalMessage({ message })

const plural = (count: number, word: string) => `${formatCount(count)} ${count === 1 ? word : `${word}s`}`

const listHref = (shared: Shared) =>
	hrefOf(AppRoute.CustomersSettingsSignals({ orgSlug: shared.orgSlug ?? "" }))

/**
 * With unsaved changes the "Signals" crumb asks first, like Close. The sidebar's links and the
 * browser's back button still leave without asking: the app has no navigation guard.
 */
const crumbs = (shared: Shared, isNew: boolean, hasChanges = false): ReadonlyArray<Crumb<Message>> => {
	const signals: Crumb<Message> = { label: "Signals", href: listHref(shared) }
	return [
		hasChanges ? { ...signals, onClick: Message.PressedClose() } : signals,
		{ label: isNew ? "New rule" : "Edit rule" },
	]
}

const label = (h: H, text: string, forId?: string): Html =>
	forId === undefined
		? h.span([h.Class("font-medium text-fg text-sm")], [text])
		: h.label([h.For(forId), h.Class("font-medium text-fg text-sm")], [text])

const help = (h: H, text: string): Html => h.p([h.Class("text-muted-fg text-xs")], [text])

const field = (h: H, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("flex flex-col gap-1.5")], [...children])

// HEADER

const badges = (
	h: H,
	editor: Editor,
	form: RuleForm,
	status: EditorStatus,
	nowMs: number,
): ReadonlyArray<Html> => [
	form.enabled ? badge(h, { intent: "success" }, ["On"]) : badge(h, { intent: "outline" }, ["Off"]),
	status.changes > 0
		? badge(h, { intent: "warning" }, [`${plural(status.changes, "unsaved change")}`])
		: editor.ruleId === null || status.saved === undefined
			? badge(h, { intent: "secondary" }, ["Not saved yet"])
			: h.span(
					[h.Class("text-muted-fg text-xs")],
					[
						`Saved · edited ${formatDate(new Date(status.saved.updatedAtMs), { now: new Date(nowMs) })}`,
					],
				),
]

const actions = (
	h: H,
	editor: Editor,
	form: RuleForm,
	status: EditorStatus,
	isAdmin: boolean,
): ReadonlyArray<Html> =>
	isAdmin
		? [
				button(h, { intent: "outline", onPress: Message.PressedToggleEnabled() }, [
					form.enabled ? "Turn off" : "Turn on",
				]),
				button(h, { intent: "plain", onPress: Message.PressedClose() }, [
					status.changes > 0 || editor.ruleId === null ? "Cancel" : "Close",
				]),
				button(
					h,
					{
						onPress: Message.PressedSave(),
						isDisabled: !status.canSave && !editor.isSaving,
						isPending: editor.isSaving,
					},
					[editor.ruleId === null ? "Create rule" : "Save rule"],
				),
			]
		: [button(h, { intent: "plain", onPress: Message.PressedClose() }, ["Close"])]

// CARDS

const plainWordsCard = (h: H, model: Model, form: RuleForm): Html =>
	h.section(
		[h.Class("flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary-subtle/40 p-4 sm:p-5")],
		[
			h.h2(
				[h.Class("font-semibold text-primary-subtle-fg text-xs uppercase tracking-wide")],
				["In plain words"],
			),
			h.p(
				[h.Class("text-fg-2 text-sm/6")],
				[
					...renderParts(
						h,
						plainWords({
							template: form.template,
							config: form.config,
							scope: scopeOf(form.scope, currencyOf(model)),
							severity: form.severity,
							currency: currencyOf(model),
							metricName: metricNameOf(model),
						}),
					),
				],
			),
		],
	)

const ruleCard = (h: H, form: RuleForm, status: EditorStatus, isAdmin: boolean): Html => {
	const meta = Customers.TEMPLATES[form.template]
	const nameError = status.errors.name
	return card(h, { title: "Rule" }, [
		h.div(
			[h.Class("grid gap-5 sm:grid-cols-2")],
			[
				field(h, [
					label(h, "Name", NAME_ID),
					input(h, {
						isInvalid: nameError !== undefined,
						isDisabled: !isAdmin,
						attributes: [
							h.Id(NAME_ID),
							h.Value(form.name),
							h.OnInput(toName),
							...(nameError === undefined ? [] : [h.AriaDescribedBy(errorIdOf(NAME_ID))]),
						],
					}),
					...fieldError(h, NAME_ID, nameError),
					help(h, "Shown as the item title in the queue."),
				]),
				field(h, [
					label(h, "Template"),
					h.div(
						[
							h.Class(
								"flex h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-fg-2 text-sm",
							),
						],
						[
							templateTile(h, form.template, "size-5 bg-transparent"),
							h.span([h.Class("min-w-0 flex-1 truncate")], [meta.name]),
							h.code([h.Class("font-mono text-muted-fg text-xs")], [form.template]),
							IconLock(h, { className: "size-3.5 text-muted-fg" }),
						],
					),
					help(h, "Fixed after creation. Start a new rule to use another template."),
				]),
				field(h, [
					label(h, "Kind"),
					h.div([], [kindChip(h, meta.kind)]),
					help(h, "Set by the template."),
				]),
				field(h, [
					label(h, "Severity"),
					h.div(
						[],
						[
							severityPicker(h, {
								selected: form.severity,
								isDisabled: !isAdmin,
								onSelect: toSeverity,
							}),
						],
					),
					help(h, "Queue rank = severity × MRR × freshness. Stronger evidence raises it a step."),
				]),
			],
		),
	])
}

const deleteCard = (h: H, editor: Editor): Html =>
	h.section(
		[
			h.Class(
				"flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg p-4 sm:p-5",
			),
		],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.h2([h.Class("font-medium text-fg text-sm")], ["Delete this rule"]),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						["Its open items in Needs attention resolve on their own."],
					),
				],
			),
			button(
				h,
				{
					intent: "outline",
					size: "sm",
					onPress: Message.PressedDelete(),
					isPending: editor.isDeleting,
				},
				[IconTrash(h, { attributes: { "data-slot": "icon" } }), "Delete rule"],
			),
		],
	)

// MODALS

const discardModal = (h: H, model: Model, status: EditorStatus): Html =>
	Modal.controlledModal(h, {
		model: model.discardModal,
		toParentMessage: toDiscardModal,
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.discardModal.id), text: "Discard changes?" },
				description: `Your ${plural(status.changes, "unsaved change")} to this rule will be lost.`,
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Keep editing"]),
				button(h, { intent: "danger", onPress: Message.PressedDiscard() }, ["Discard"]),
			]),
		],
	})

const deleteModal = (h: H, model: Model, editor: Editor, form: RuleForm): Html => {
	const open = (model.signals ?? []).filter(
		(signal) =>
			signal.ruleId === editor.ruleId && (signal.status === "open" || signal.status === "snoozed"),
	).length
	return Modal.controlledModal(h, {
		model: model.deleteModal,
		toParentMessage: toDeleteModal,
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => [
			dialogHeader(h, {
				title: { id: Modal.titleId(model.deleteModal.id), text: "Delete this rule?" },
				description: `“${form.name}” stops checking accounts. ${open === 0 ? "It has no open items." : `Its ${plural(open, "open item")} in Needs attention resolve automatically.`} This can't be undone.`,
			}),
			dialogFooter(h, [
				dialogClose(h, closeAttributes, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.PressedConfirmDelete() }, ["Delete rule"]),
			]),
		],
	})
}

// STATES

const placeholder = (h: H, shared: Shared, title: string, text: string, withLink: boolean): Html =>
	settingsPage(h, [
		settingsHeader(h, { title, crumbs: crumbs(shared, false) }),
		h.div(
			[
				h.Class(
					"flex flex-col items-center gap-2 rounded-xl border border-border bg-bg px-5 py-12 text-center",
				),
			],
			[
				h.p([h.Class("text-muted-fg text-sm")], [text]),
				...(withLink
					? [
							h.a(
								[
									h.Href(listHref(shared)),
									h.Class("font-medium text-primary text-sm hover:underline"),
								],
								["Back to signals"],
							),
						]
					: []),
			],
		),
	])

export const editorView = (h: H, model: Model, editor: Editor, shared: Shared): Html => {
	const form = editor.form
	if (form === null) {
		const isGone = model.rules !== null && !editor.isDeleting
		return isGone
			? placeholder(h, shared, "Rule not found", "This rule was deleted, or the link is wrong.", true)
			: placeholder(h, shared, "Loading rule…", "Loading the rule…", false)
	}
	if (
		editor.ruleId !== null &&
		model.rules !== null &&
		!editor.isDeleting &&
		!model.rules.some((rule) => rule.id === editor.ruleId)
	) {
		return placeholder(h, shared, "Rule not found", "This rule was deleted in the meantime.", true)
	}
	const isAdmin = isCustomersAdmin(shared)
	const status = editorStatus(model, editor, form)
	const context = {
		model,
		form,
		errors: status.errors,
		isAdmin,
		orgSlug: shared.orgSlug ?? "",
		nowMs: shared.nowMs,
	}
	return h.div(
		[h.Class("h-full")],
		[
			settingsPage(h, [
				settingsHeader(h, {
					title: form.name.trim() === "" ? Customers.TEMPLATES[form.template].name : form.name,
					crumbs: crumbs(shared, editor.ruleId === null, status.changes > 0),
					leading: templateTile(h, form.template, "size-9"),
					badges: badges(h, editor, form, status, shared.nowMs),
					actions: actions(h, editor, form, status, isAdmin),
				}),
				...(isAdmin ? [] : [readOnlyNotice(h, "signal rules")]),
				h.div(
					[h.Class("grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]")],
					[
						h.div(
							[h.Class("flex min-w-0 flex-col gap-5")],
							[
								plainWordsCard(h, model, form),
								ruleCard(h, form, status, isAdmin),
								...conditionCards(h, context),
								scopeCard(h, { model, form, errors: status.errors, isAdmin }),
								...(isAdmin && editor.ruleId !== null ? [deleteCard(h, editor)] : []),
							],
						),
						previewCard(h, { model, editor, form, status, orgSlug: shared.orgSlug ?? "" }),
					],
				),
			]),
			discardModal(h, model, status),
			...(editor.ruleId === null ? [] : [deleteModal(h, model, editor, form)]),
		],
	)
}
