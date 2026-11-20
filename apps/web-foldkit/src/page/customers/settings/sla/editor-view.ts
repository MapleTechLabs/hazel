import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { segmented } from "../../../../customers/ui/filter-bar"
import { IconClock, IconPlus } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { input } from "../../../../ui/input"
import { searchField } from "../../../../ui/search-field"
import * as Select from "../../../../ui/select"
import { switchControl } from "../../../../ui/switch"
import { textField } from "../../../../ui/text-field"
import { toggleChip } from "../../../../ui/toggle-chip"
import { AppRoute, hrefOf } from "../../../../route"
import type { Shared } from "../../../contract"
import { type Crumb, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { exampleLine, HOURS_LABEL, type PolicyErrors, policyErrors } from "./draft"
import { Message } from "./message"
import {
	businessHoursOf,
	CLOCKS,
	type Editor,
	type Model,
	PRIORITIES,
	planNamesOf,
	type SlaClock,
	unitSelectId,
	WARN_OPTIONS,
	WARN_SELECT_ID,
} from "./model"
import { card, errorText, field, fieldLabel, help, removableChip, selectField } from "./parts"

/** The policy editor, in place of the list: the policy, whom it applies to, and its targets. */

type H = HtmlBuilder<Message>

const NAME_ID = "sla-policy-name"
const TAG_ID = "sla-policy-tag"
const ACCOUNT_SEARCH_ID = "sla-policy-accounts"
const MAX_ACCOUNT_RESULTS = 6

const PRIORITY_LABEL = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
} as const satisfies Record<Customers.SlaPriority, string>

const CLOCK_LABEL = {
	firstResponse: "First response",
	resolution: "Resolution",
} as const satisfies Record<SlaClock, string>

const BUSINESS_UNIT_ITEMS = [Select.item("minutes", "minutes"), Select.item("hours", "hours")]
const ALWAYS_UNIT_ITEMS = [...BUSINESS_UNIT_ITEMS, Select.item("days", "days")]
const WARN_ITEMS = WARN_OPTIONS.map((pct) =>
	Select.item(String(pct), pct === 0 ? "Only at breach" : `${pct}% before due`),
)

// THE POLICY

const policyCard = (h: H, model: Model, editor: Editor, errors: PolicyErrors, canEdit: boolean): Html => {
	const { form } = editor
	const nameError = editor.showErrors ? errors.name : undefined
	return card(h, { title: "Policy" }, [
		h.div(
			[h.Class("grid grid-cols-1 gap-5 md:grid-cols-2")],
			[
				textField(
					h,
					{
						id: NAME_ID,
						value: form.name,
						onInput: (value) => Message.ChangedName({ value }),
						isInvalid: nameError !== undefined,
						isDisabled: !canEdit || editor.isSaving,
					},
					(parts) => [
						parts.label(["Name"]),
						parts.input({ placeholder: "e.g. Enterprise" }),
						parts.fieldError([nameError ?? ""]),
					],
				),
				field(h, [
					fieldLabel(h, "Status"),
					h.div(
						[h.Class("flex h-9 items-center")],
						[
							switchControl(
								h,
								{
									id: "sla-policy-enabled",
									ariaLabel: "Policy enabled",
									isSelected: form.enabled,
									isDisabled: !canEdit || editor.isSaving,
									onChange: (enabled) => Message.ToggledEnabled({ enabled }),
								},
								form.enabled ? "On" : "Off",
							),
						],
					),
				]),
				field(h, [
					fieldLabel(h, "Hours"),
					h.div(
						[],
						[
							canEdit
								? segmented(h, {
										ariaLabel: "Hours",
										segments: [
											{ key: "business", label: HOURS_LABEL.business },
											{ key: "always", label: HOURS_LABEL.always },
										],
										selected: form.hours,
										onSelect: (hours) => Message.ClickedHours({ hours }),
										isDisabled: editor.isSaving,
									})
								: badge(h, { intent: "secondary" }, [HOURS_LABEL[form.hours]]),
						],
					),
					help(
						h,
						form.hours === "business"
							? "Targets count working time only, from the business hours."
							: "Targets count every hour of the week.",
					),
				]),
				field(h, [
					fieldLabel(h, "Warn before"),
					selectField(h, model, {
						id: WARN_SELECT_ID,
						items: WARN_ITEMS,
						ariaLabel: "Warn before",
						triggerClassName: "w-full sm:w-48",
					}),
					help(h, "A share of the target before it is due."),
				]),
			],
		),
	])
}

// APPLIES TO

const plansField = (h: H, model: Model, editor: Editor, canEdit: boolean): Html => {
	const plans = planNamesOf(model, editor.form.planNames)
	const isLoading = AsyncData.isLoading(model.plans) || AsyncData.isIdle(model.plans)
	const failed = AsyncData.isFailure(model.plans)
	// A failed fetch says so (with a retry); the plans the policy already names stay pickable.
	const status = failed
		? [
				h.div(
					[h.Class("flex flex-wrap items-center gap-2")],
					[
						...errorText(h, "sla-plans-error", "The plans could not be loaded."),
						button(h, { intent: "plain", size: "sm", onPress: Message.PressedRetryPlans() }, [
							"Retry",
						]),
					],
				),
			]
		: plans.length === 0
			? [
					help(
						h,
						isLoading
							? "Loading plans…"
							: "No plans yet: they show once a billing source has synced.",
					),
				]
			: []
	const chips =
		plans.length === 0
			? []
			: [
					h.div(
						[h.Role("group"), h.AriaLabel("Plans"), h.Class("flex flex-wrap gap-1.5")],
						plans.map((plan) =>
							toggleChip(h, {
								label: plan,
								isPressed: editor.form.planNames.includes(plan),
								isDisabled: !canEdit || editor.isSaving,
								onPress: Message.ToggledPlan({ plan }),
							}),
						),
					),
				]
	return field(h, [fieldLabel(h, "Plans"), ...status, ...chips])
}

const tagsField = (h: H, editor: Editor, canEdit: boolean): Html => {
	const { form } = editor
	return field(h, [
		fieldLabel(h, "Tags", canEdit ? TAG_ID : undefined),
		...(form.tags.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-wrap gap-1.5")],
						form.tags.map((tag) =>
							removableChip(h, {
								label: tag,
								onRemove: canEdit && !editor.isSaving ? Message.RemovedTag({ tag }) : null,
							}),
						),
					),
				]),
		...(canEdit
			? [
					h.div(
						[h.Class("flex gap-2")],
						[
							input(h, {
								className: "min-w-0 flex-1",
								placeholder: "Any of these tags, e.g. vip",
								isDisabled: editor.isSaving,
								attributes: [
									h.Id(TAG_ID),
									h.Value(form.tagInput),
									h.OnInput((value) => Message.ChangedTagInput({ value })),
									h.OnKeyDownPreventDefault((key) =>
										key === "Enter"
											? Option.some(Message.PressedAddTag())
											: Option.none(),
									),
								],
							}),
							button(
								h,
								{
									intent: "outline",
									onPress: Message.PressedAddTag(),
									isDisabled: form.tagInput.trim() === "" || editor.isSaving,
								},
								["Add"],
							),
						],
					),
				]
			: form.tags.length === 0
				? [help(h, "None")]
				: []),
	])
}

const accountsField = (h: H, model: Model, editor: Editor, canEdit: boolean): Html => {
	const { form } = editor
	const nameOf = (accountId: string) =>
		model.accounts.find((account) => account.id === accountId)?.name ?? "Unknown customer"
	const query = form.accountSearch.trim().toLowerCase()
	const results =
		query === ""
			? []
			: model.accounts
					.filter(
						(account) =>
							!form.accountIds.includes(account.id) &&
							(account.name.toLowerCase().includes(query) ||
								(account.domain?.toLowerCase().includes(query) ?? false)),
					)
					.slice(0, MAX_ACCOUNT_RESULTS)
	return field(h, [
		fieldLabel(h, "Specific customers"),
		...(form.accountIds.length === 0
			? []
			: [
					h.div(
						[h.Class("flex flex-wrap gap-1.5")],
						form.accountIds.map((accountId) =>
							removableChip(h, {
								label: nameOf(accountId),
								onRemove:
									canEdit && !editor.isSaving
										? Message.RemovedAccount({ accountId })
										: null,
							}),
						),
					),
				]),
		...(canEdit
			? [
					searchField(
						h,
						{
							id: ACCOUNT_SEARCH_ID,
							value: form.accountSearch,
							ariaLabel: "Search customers",
							isDisabled: editor.isSaving,
							onInput: (value) => Message.ChangedAccountSearch({ value }),
							onClear: Message.ClearedAccountSearch(),
						},
						(parts) => [parts.searchInput({ placeholder: "Search customers by name or domain" })],
					),
					...(query === ""
						? []
						: [
								results.length === 0
									? help(h, "No matching customers.")
									: h.ul(
											[
												h.AriaLabel("Matching customers"),
												h.Class("flex flex-col rounded-lg border border-border p-1"),
											],
											results.map((account) =>
												h.li(
													[],
													[
														button(
															h,
															{
																intent: "plain",
																size: "sm",
																className: "w-full justify-start",
																isDisabled: editor.isSaving,
																onPress: Message.AddedAccount({
																	accountId: account.id,
																}),
															},
															[
																IconPlus(h, {
																	attributes: { "data-slot": "icon" },
																}),
																h.span([h.Class("truncate")], [account.name]),
																...(account.domain === null
																	? []
																	: [
																			h.span(
																				[
																					h.Class(
																						"truncate text-muted-fg",
																					),
																				],
																				[account.domain],
																			),
																		]),
															],
														),
													],
												),
											),
										),
							]),
				]
			: form.accountIds.length === 0
				? [help(h, "None")]
				: []),
	])
}

const appliesToCard = (h: H, model: Model, editor: Editor, canEdit: boolean): Html => {
	const { form } = editor
	const isDefault = form.planNames.length === 0 && form.tags.length === 0 && form.accountIds.length === 0
	return card(
		h,
		{
			title: "Applies to",
			description: "Any one match is enough. Leave everything empty for a default policy.",
			aside: isDefault ? badge(h, { intent: "secondary" }, ["Default · any customer"]) : null,
		},
		[
			plansField(h, model, editor, canEdit),
			tagsField(h, editor, canEdit),
			accountsField(h, model, editor, canEdit),
		],
	)
}

// TARGETS

const COLUMNS =
	"grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-start"

const durationCell = (
	h: H,
	model: Model,
	editor: Editor,
	errors: PolicyErrors,
	priority: Customers.SlaPriority,
	clock: SlaClock,
	canEdit: boolean,
): Html => {
	const id = `sla-target-${priority}-${clock}`
	const error = editor.showErrors ? errors.targets[`${priority}.${clock}`] : undefined
	const label = `${PRIORITY_LABEL[priority]} ${CLOCK_LABEL[clock].toLowerCase()}`
	return h.div(
		[h.Class("flex min-w-0 flex-col gap-1")],
		[
			h.span([h.AriaHidden(true), h.Class("text-muted-fg text-xs sm:hidden")], [CLOCK_LABEL[clock]]),
			h.div(
				[h.Class("grid w-fit grid-cols-[5rem_7rem] items-center gap-2")],
				[
					input(h, {
						className: "tabular-nums",
						isInvalid: error !== undefined,
						isDisabled: !canEdit || editor.isSaving,
						attributes: [
							h.Id(id),
							h.AriaLabel(`${label} amount`),
							h.InputMode("numeric"),
							h.Value(editor.form.targets[priority][clock].amount),
							h.OnInput((value) => Message.ChangedTargetAmount({ priority, clock, value })),
							...(error === undefined ? [] : [h.AriaDescribedBy(`${id}-error`)]),
						],
					}),
					selectField(h, model, {
						id: unitSelectId(priority, clock),
						items: editor.form.hours === "business" ? BUSINESS_UNIT_ITEMS : ALWAYS_UNIT_ITEMS,
						ariaLabel: `${label} unit`,
						triggerClassName: "w-full",
					}),
				],
			),
			...errorText(h, `${id}-error`, error),
		],
	)
}

const targetsCard = (h: H, model: Model, editor: Editor, errors: PolicyErrors, canEdit: boolean): Html => {
	const example = exampleLine(editor.form, businessHoursOf(model))
	return card(
		h,
		{
			title: "Targets",
			description:
				editor.form.hours === "business"
					? "Per issue priority, counted in working hours only."
					: "Per issue priority, around the clock.",
		},
		[
			h.div(
				[h.Role("table"), h.AriaLabel("Targets"), h.Class("flex flex-col")],
				[
					h.div(
						[h.Role("row"), h.Class(`${COLUMNS} hidden border-border border-b pb-2 sm:grid`)],
						[
							h.span(
								[h.Role("columnheader"), h.Class("font-medium text-muted-fg text-xs")],
								["Priority"],
							),
							...CLOCKS.map((clock) =>
								h.span(
									[h.Role("columnheader"), h.Class("font-medium text-muted-fg text-xs")],
									[CLOCK_LABEL[clock]],
								),
							),
						],
					),
					...PRIORITIES.map((priority) =>
						h.div(
							[
								h.Role("row"),
								h.Class(`${COLUMNS} border-border border-b py-3 last:border-b-0`),
							],
							[
								h.span(
									[h.Role("rowheader"), h.Class("font-medium text-fg text-sm sm:pt-2")],
									[PRIORITY_LABEL[priority]],
								),
								...CLOCKS.map((clock) =>
									h.div(
										[h.Role("cell")],
										[durationCell(h, model, editor, errors, priority, clock, canEdit)],
									),
								),
							],
						),
					),
				],
			),
			...(example === undefined
				? []
				: [
						h.p(
							[
								h.Class(
									"flex items-start gap-1.5 rounded-lg bg-secondary/40 px-3 py-2 text-fg-2 text-sm",
								),
							],
							[IconClock(h, { className: "mt-0.5 size-3.5 shrink-0 text-muted-fg" }), example],
						),
					]),
		],
	)
}

// PAGE

export const editorView = (h: H, model: Model, editor: Editor, shared: Shared, canEdit: boolean): Html => {
	const errors = policyErrors(editor.form)
	const isNew = editor.policyId === null
	const crumbs: ReadonlyArray<Crumb<Message>> = [
		// Plain text while a save is in flight: its answer closes the editor.
		editor.isSaving
			? { label: "Support SLAs" }
			: {
					label: "Support SLAs",
					href: hrefOf(AppRoute.CustomersSettingsSla({ orgSlug: shared.orgSlug ?? "" })),
					onClick: Message.PressedCloseEditor(),
				},
		{ label: isNew ? "New policy" : canEdit ? "Edit policy" : "Policy" },
	]
	return settingsPage(h, [
		settingsHeader(h, {
			title: isNew ? "New policy" : editor.form.name || "Policy",
			crumbs,
			actions: canEdit
				? [
						button(
							h,
							{
								intent: "plain",
								onPress: Message.PressedCloseEditor(),
								isDisabled: editor.isSaving,
							},
							["Cancel"],
						),
						button(h, { onPress: Message.PressedSavePolicy(), isPending: editor.isSaving }, [
							isNew ? "Create policy" : "Save policy",
						]),
					]
				: [button(h, { intent: "plain", onPress: Message.PressedCloseEditor() }, ["Close"])],
		}),
		...(canEdit ? [] : [readOnlyNotice(h, "SLA policies")]),
		policyCard(h, model, editor, errors, canEdit),
		appliesToCard(h, model, editor, canEdit),
		targetsCard(h, model, editor, errors, canEdit),
	])
}
