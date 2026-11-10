import type * as Customers from "@hazel/domain/customers"
import type { CustomerSignalRuleId } from "@hazel/schema"
import { Match, Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, successToast } from "../../../../data/actions"
import type { ToastRequest } from "../../../../overlay/toasts"
import { AppRoute, type RouteOf } from "../../../../route"
import * as Modal from "../../../../ui/modal"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../../out-message"
import {
	CreateSignalRule,
	DeleteSignalRule,
	FetchRuleDryRun,
	ToggleSignalRule,
	UpdateSignalRule,
	WaitForRuleDryRunDelay,
} from "./commands"
import { draftOf, draftOfRule, editorStatus, formOfRule, formOfTemplate } from "./draft"
import { Message, type RuleWriteFailure } from "./message"
import {
	currencyOf,
	DELETE_MODAL_ID,
	DISCARD_MODAL_ID,
	type Editor,
	isAvailable,
	type Model,
	PICKER_MODAL_ID,
	type RuleForm,
	ruleById,
} from "./model"

export type SignalsRoute = RouteOf<
	"CustomersSettingsSignals" | "CustomersSettingsSignalNew" | "CustomersSettingsSignalRule"
>

type Return = PageReturn<Model, Message>

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const toList = (shared: Shared, request?: ToastRequest) =>
	requestedOrgNavigation(
		shared.orgSlug,
		(orgSlug) => AppRoute.CustomersSettingsSignals({ orgSlug }),
		request === undefined ? {} : { toast: request },
	)

// ROUTES

const editorOf = (version: number, ruleId: CustomerSignalRuleId | null, form: RuleForm | null): Editor => ({
	ruleId,
	form,
	version,
	preview: AsyncData.Idle(),
	exampleAccountId: null,
	isSaving: false,
	isDeleting: false,
})

const withModalsClosed = (model: Model): Model => ({
	...model,
	pickerModal: Modal.close(model.pickerModal).model,
	discardModal: Modal.close(model.discardModal).model,
	deleteModal: Modal.close(model.deleteModal).model,
})

const openPicker = (model: Model): Model => ({
	...model,
	picker: { search: "", kind: "all", selected: null },
	pickerModal: Modal.open(model.pickerModal).model,
})

/** The list, the list with the picker open (`/new` without a template), or the editor. */
const openRoute = (model: Model, route: SignalsRoute, shared: Shared): Return => {
	const version = model.lastVersion + 1
	const base = { ...withModalsClosed(model), lastVersion: version }
	return Match.valueTags(route, {
		CustomersSettingsSignals: (): Return => ({ model: { ...base, editor: null } }),
		CustomersSettingsSignalNew: ({ template }): Return =>
			Option.match(template, {
				onNone: () => ({ model: openPicker({ ...base, editor: null }) }),
				onSome: (picked) =>
					fetchPreview(
						{ ...base, editor: editorOf(version, null, formOfTemplate(picked)) },
						shared,
					),
			}),
		CustomersSettingsSignalRule: ({ ruleId }): Return => {
			const rule = ruleById(base, ruleId)
			const form = rule === undefined ? null : formOfRule(rule, currencyOf(base))
			return fetchPreview({ ...base, editor: editorOf(version, ruleId, form) }, shared)
		},
	})
}

export const init = (route: SignalsRoute, shared: Shared): Return =>
	openRoute(
		{
			rules: null,
			signals: null,
			accounts: null,
			connectedProviders: null,
			settings: null,
			metrics: [],
			editor: null,
			lastVersion: 0,
			pickerModal: Modal.init(PICKER_MODAL_ID),
			picker: { search: "", kind: "all", selected: null },
			discardModal: Modal.init(DISCARD_MODAL_ID),
			deleteModal: Modal.init(DELETE_MODAL_ID),
		},
		route,
		shared,
	)

export const routeChanged = (model: Model, route: SignalsRoute, shared: Shared): Return =>
	openRoute(model, route, shared)

/** The organization arrived after the editor opened: its first preview. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	model.editor !== null && AsyncData.isIdle(model.editor.preview) ? fetchPreview(model, shared) : { model }

// THE PREVIEW

const withEditor = (model: Model, change: (editor: Editor) => Editor): Model =>
	model.editor === null ? model : { ...model, editor: change(model.editor) }

/** Dry-runs the current draft (its version tags the answer); nothing while it is invalid. */
const fetchPreview = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (editor === null || editor.form === null || organizationId === undefined) return { model }
	return Option.match(draftOf(editor.form, currencyOf(model)), {
		onNone: () => ({ model }),
		onSome: (draft) => ({
			model: withEditor(model, (current) => ({
				...current,
				preview: Option.getOrElse(AsyncData.revalidateOrLoad(current.preview), () => current.preview),
			})),
			commands: [
				FetchRuleDryRun({ organizationId, version: editor.version, draft, ruleId: editor.ruleId }),
			],
		}),
	})
}

/** The example account: the one picked, while it still matches, else the first match with a series. */
const exampleOf = (editor: Editor, result: Customers.RuleDryRunResult): Editor["exampleAccountId"] =>
	result.topMatches.some((match) => match.accountId === editor.exampleAccountId)
		? editor.exampleAccountId
		: (result.topMatches.find((match) => match.evidence._tag === "series")?.accountId ?? null)

// EDITING

/** Applies an edit, bumps the version, and (when the draft holds) restarts the preview's pause. */
const edit = (model: Model, change: (form: RuleForm) => RuleForm): Return => {
	const editor = model.editor
	if (editor === null || editor.form === null) return { model }
	const form = change(editor.form)
	const version = model.lastVersion + 1
	return {
		model: { ...model, lastVersion: version, editor: { ...editor, form, version } },
		commands: Option.isSome(draftOf(form, currencyOf(model)))
			? [WaitForRuleDryRunDelay({ version })]
			: [],
	}
}

const toggled = <A>(items: ReadonlyArray<A>, item: A): ReadonlyArray<A> =>
	items.includes(item) ? items.filter((each) => each !== item) : [...items, item]

const editConfig = (model: Model, key: string, value: RuleForm["config"][string]): Return =>
	edit(model, (form) => ({ ...form, config: { ...form.config, [key]: value } }))

const editScope = (model: Model, change: (scope: RuleForm["scope"]) => RuleForm["scope"]): Return =>
	edit(model, (form) => ({ ...form, scope: change(form.scope) }))

const limitMetricsOf = (form: RuleForm): ReadonlyArray<string> => {
	const keys = form.config.metricKeys
	return Array.isArray(keys) ? keys : []
}

// SAVING AND DELETING

const save = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const organizationId = shared.organization?.id
	if (editor === null || editor.form === null || organizationId === undefined) return { model }
	const status = editorStatus(model, editor, editor.form)
	if (!status.canSave) return { model }
	return Option.match(status.draft, {
		onNone: () => ({ model }),
		onSome: (rule) => ({
			model: withEditor(model, (current) => ({ ...current, isSaving: true })),
			commands: [
				editor.ruleId === null
					? CreateSignalRule({ organizationId, rule })
					: UpdateSignalRule({ organizationId, ruleId: editor.ruleId, rule }),
			],
		}),
	})
}

const close = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const hasChanges =
		editor !== null && editor.form !== null && editorStatus(model, editor, editor.form).changes > 0
	return hasChanges
		? { model: { ...model, discardModal: Modal.open(model.discardModal).model } }
		: { model, outMessage: toList(shared) }
}

const writeFailure = (title: string, reason: RuleWriteFailure) =>
	toast(
		errorToastOf(
			failureMessage(reason, {
				NotFound: { title, description: "The rule was deleted in the meantime." },
				Invalid: { title, description: "Check the rule's settings and try again." },
			}),
		),
	)

// LIST

const withRuleEnabled = (model: Model, ruleId: CustomerSignalRuleId, enabled: boolean): Model => ({
	...model,
	rules: model.rules?.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule)) ?? null,
})

/** Flips the switch at once (the collection confirms or rolls back) and saves the rule with it. */
const toggleRule = (model: Model, shared: Shared, ruleId: CustomerSignalRuleId, enabled: boolean): Return => {
	const rule = ruleById(model, ruleId)
	const organizationId = shared.organization?.id
	if (rule === undefined || organizationId === undefined) return { model }
	return {
		model: withRuleEnabled(model, ruleId, enabled),
		commands: [ToggleSignalRule({ organizationId, ruleId, rule: draftOfRule(rule, enabled) })],
	}
}

/** The rules arrived after the editor opened on one: fill its form and preview it. */
const hydrateEditor = (model: Model, shared: Shared): Return => {
	const editor = model.editor
	const rule = ruleById(model, editor?.ruleId ?? null)
	if (editor === null || editor.form !== null || rule === undefined) return { model }
	return fetchPreview(
		{ ...model, editor: { ...editor, form: formOfRule(rule, currencyOf(model)) } },
		shared,
	)
}

const updateModal = (
	model: Model,
	field: "pickerModal" | "discardModal" | "deleteModal",
	message: Modal.Message,
	toMessage: (message: Modal.Message) => Message,
): Return => {
	const result = Modal.update(model[field], message)
	return {
		model: { ...model, [field]: result.model },
		commands: Command.mapMessages(result.commands ?? [], toMessage),
	}
}

const toPickerModal = (message: Modal.Message) => Message.GotPickerModalMessage({ message })
const toDiscardModal = (message: Modal.Message) => Message.GotDiscardModalMessage({ message })
const toDeleteModal = (message: Modal.Message) => Message.GotDeleteModalMessage({ message })

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedRules: ({ rules }) => hydrateEditor({ ...model, rules }, shared),
		UpdatedSignals: ({ signals }) => ({ model: { ...model, signals } }),
		UpdatedAccounts: ({ accounts }) => ({ model: { ...model, accounts } }),
		UpdatedConnectedProviders: ({ providers }) => ({
			model: { ...model, connectedProviders: providers },
		}),
		UpdatedSettings: ({ settings }) => ({ model: { ...model, settings } }),
		UpdatedMetrics: ({ metrics }) => ({ model: { ...model, metrics } }),

		ToggledRule: ({ ruleId, enabled }) => toggleRule(model, shared, ruleId, enabled),
		SucceededToggleRule: () => ({ model }),
		FailedToggleRule: ({ ruleId, enabled, reason }) => ({
			model: withRuleEnabled(model, ruleId, !enabled),
			outMessage: writeFailure(`Couldn't turn the rule ${enabled ? "on" : "off"}`, reason),
		}),

		PressedNewSignal: () => ({ model: openPicker(model) }),
		GotPickerModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "pickerModal", modalMessage, toPickerModal),
		ChangedPickerSearch: ({ value }) => ({
			model: { ...model, picker: { ...model.picker, search: value } },
		}),
		ClearedPickerSearch: () => ({ model: { ...model, picker: { ...model.picker, search: "" } } }),
		ClickedPickerKind: ({ kind }) => ({ model: { ...model, picker: { ...model.picker, kind } } }),
		ClickedTemplate: ({ template }) =>
			isAvailable(model, template)
				? { model: { ...model, picker: { ...model.picker, selected: template } } }
				: { model },
		PressedSetUpTemplate: () => {
			const template = model.picker.selected
			return template === null
				? { model }
				: {
						model,
						outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
							AppRoute.CustomersSettingsSignalNew({ orgSlug, template: Option.some(template) }),
						),
					}
		},

		ChangedName: ({ value }) => edit(model, (form) => ({ ...form, name: value })),
		ClickedSeverity: ({ severity }) => edit(model, (form) => ({ ...form, severity })),
		ChangedConfigNumber: ({ key, value }) => editConfig(model, key, value),
		ToggledConfigFlag: ({ key, isOn }) => editConfig(model, key, isOn),
		ClickedMetric: ({ metricKey }) => editConfig(model, "metricKey", metricKey),
		ToggledLimitMetric: ({ metricKey }) =>
			edit(model, (form) => ({
				...form,
				config: { ...form.config, metricKeys: toggled(limitMetricsOf(form), metricKey) },
			})),
		ClearedLimitMetrics: () => editConfig(model, "metricKeys", []),
		AddedScopeCondition: ({ condition }) =>
			editScope(model, (scope) =>
				condition === "stage"
					? { ...scope, stages: scope.stages ?? [] }
					: condition === "plan"
						? { ...scope, plans: scope.plans ?? [] }
						: condition === "mrr"
							? { ...scope, minMrr: scope.minMrr ?? "0" }
							: scope,
			),
		RemovedScopeCondition: ({ condition }) =>
			editScope(model, (scope) =>
				condition === "stage"
					? { ...scope, stages: null }
					: condition === "plan"
						? { ...scope, plans: null }
						: condition === "mrr"
							? { ...scope, minMrr: null }
							: { ...scope, tags: [] },
			),
		ToggledScopeStage: ({ stage }) =>
			editScope(model, (scope) => ({ ...scope, stages: toggled(scope.stages ?? [], stage) })),
		ToggledScopePlan: ({ plan }) =>
			editScope(model, (scope) => ({ ...scope, plans: toggled(scope.plans ?? [], plan) })),
		ChangedScopeMrr: ({ value }) => editScope(model, (scope) => ({ ...scope, minMrr: value })),
		ToggledPayingOnly: ({ isOn }) => editScope(model, (scope) => ({ ...scope, payingOnly: isOn })),
		PressedToggleEnabled: () => edit(model, (form) => ({ ...form, enabled: !form.enabled })),

		PressedSave: () => save(model, shared),
		SucceededCreateRule: ({ ruleId }) => {
			const created = successToast("Rule created", "It runs on the next hourly check.")
			// Only the editor that is still saving opens the new rule; one left meanwhile just says so.
			return model.editor?.isSaving === true && model.editor.ruleId === null
				? {
						model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
						outMessage: requestedOrgNavigation(
							shared.orgSlug,
							(orgSlug) => AppRoute.CustomersSettingsSignalRule({ orgSlug, ruleId }),
							{ replace: true, toast: created },
						),
					}
				: { model, outMessage: toast(created) }
		},
		FailedCreateRule: ({ reason }) => ({
			model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
			outMessage: writeFailure("Couldn't create the rule", reason),
		}),
		SucceededUpdateRule: () => ({
			model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
			outMessage: toast(successToast("Rule saved", "It runs on the next hourly check.")),
		}),
		FailedUpdateRule: ({ reason }) => ({
			model: withEditor(model, (editor) => ({ ...editor, isSaving: false })),
			outMessage: writeFailure("Couldn't save the rule", reason),
		}),
		PressedClose: () => close(model, shared),
		GotDiscardModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "discardModal", modalMessage, toDiscardModal),
		PressedDiscard: () => ({
			model: { ...model, discardModal: Modal.close(model.discardModal).model },
			outMessage: toList(shared),
		}),
		PressedDelete: () => ({ model: { ...model, deleteModal: Modal.open(model.deleteModal).model } }),
		GotDeleteModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "deleteModal", modalMessage, toDeleteModal),
		PressedConfirmDelete: () => {
			const ruleId = model.editor?.ruleId ?? null
			const organizationId = shared.organization?.id
			if (ruleId === null || organizationId === undefined) return { model }
			return {
				model: withEditor(
					{ ...model, deleteModal: Modal.close(model.deleteModal).model },
					(editor) => ({ ...editor, isDeleting: true }),
				),
				commands: [DeleteSignalRule({ organizationId, ruleId })],
			}
		},
		SucceededDeleteRule: () => ({
			model,
			outMessage: toList(shared, successToast("Rule deleted", "Its open items were resolved.")),
		}),
		FailedDeleteRule: ({ reason }) => ({
			model: withEditor(model, (editor) => ({ ...editor, isDeleting: false })),
			outMessage: writeFailure("Couldn't delete the rule", reason),
		}),

		ElapsedRuleDryRunDelay: ({ version }) =>
			model.editor?.version === version ? fetchPreview(model, shared) : { model },
		SucceededFetchDryRun: ({ version, result }) =>
			model.editor?.version === version
				? {
						model: withEditor(model, (editor) => ({
							...editor,
							preview: AsyncData.settle(editor.preview, Result.succeed(result)),
							exampleAccountId: exampleOf(editor, result),
						})),
					}
				: { model },
		FailedFetchDryRun: ({ version, reason }) =>
			model.editor?.version === version
				? {
						model: withEditor(model, (editor) => ({
							...editor,
							preview: AsyncData.settle(editor.preview, Result.fail(reason)),
						})),
					}
				: { model },
		PressedRetryPreview: () => fetchPreview(model, shared),
		ChangedExampleAccount: ({ accountId }) => ({
			model: withEditor(model, (editor) => ({
				...editor,
				exampleAccountId: Option.match(AsyncData.getData(editor.preview), {
					onNone: () => editor.exampleAccountId,
					onSome: (result) =>
						result.topMatches.find((match) => match.accountId === accountId)?.accountId ??
						editor.exampleAccountId,
				}),
			})),
		}),
	})
