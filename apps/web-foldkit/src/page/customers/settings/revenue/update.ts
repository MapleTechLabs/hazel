import * as Customers from "@hazel/domain/customers"
import { Equal, Match, Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { reasonToast, successToast } from "../../../../data/actions"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import {
	DelayRevenuePreview,
	FetchRevenueCatalog,
	FetchRevenuePreview,
	SaveRevenueSettings,
} from "./commands"
import { Message } from "./message"
import {
	CONFIRM_MODAL_ID,
	draftOf,
	draftOfSaved,
	normalizedDraft,
	entryKeyOf,
	isSameBasis,
	MAX_CONDITIONS,
	MAX_VALUES,
	type Model,
	type RevenueDraft,
	restatesHistory,
	type SelectTarget,
	selectIdOf,
	targetOfSelectId,
	validOf,
	withCondition,
	withField,
	withNewCondition,
	withNewRule,
	withRule,
	withRuleMoved,
	withValueToggled,
} from "./model"

type Return = PageReturn<Model, Message>

const fetchedCatalog = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	return organizationId === undefined
		? { model }
		: {
				model: { ...model, catalog: AsyncData.Loading() },
				commands: [FetchRevenueCatalog({ organizationId })],
			}
}

export const init = (_route: unknown, shared: Shared): Return =>
	fetchedCatalog(
		{
			settings: null,
			draft: null,
			catalog: AsyncData.Idle(),
			preview: { version: 0, result: AsyncData.Idle() },
			selects: {},
			valueEntries: {},
			confirmModal: Modal.init(CONFIRM_MODAL_ID),
			isSaving: false,
		},
		shared,
	)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.catalog) ? fetchedCatalog(model, shared) : { model }

/** No draft once it matches the saved rules again (kept while saving, in case the save rolls back). */
const settled = (model: Model): Model =>
	!model.isSaving &&
	model.draft !== null &&
	model.settings !== null &&
	Equal.equals(model.draft, draftOfSaved(model.settings))
		? { ...model, draft: null }
		: model

/**
 * A new draft: a new preview version. A complete one is previewed once it stays still for
 * `PREVIEW_DELAY`; an incomplete one pauses the preview.
 */
const previewed = (model: Model): Return => {
	const version = model.preview.version + 1
	const draft = draftOf(model)
	if (draft === null || validOf(draft) === null)
		return { model: { ...model, preview: { version, result: AsyncData.Idle() } } }
	const { result } = model.preview
	return {
		model: {
			...model,
			preview: { version, result: Option.getOrElse(AsyncData.revalidateOrLoad(result), () => result) },
		},
		commands: [DelayRevenuePreview({ version })],
	}
}

/** The draft after an admin's edit; null when nothing may change now. */
const editedDraft = (
	model: Model,
	shared: Shared,
	f: (draft: RevenueDraft) => RevenueDraft,
): Model | null => {
	const draft = draftOf(model)
	return draft === null || model.isSaving || !isCustomersAdmin(shared)
		? null
		: settled({ ...model, draft: f(draft) })
}

const edited = (model: Model, shared: Shared, f: (draft: RevenueDraft) => RevenueDraft): Return => {
	const next = editedDraft(model, shared, f)
	return next === null ? { model } : previewed(next)
}

const selectedKeyOf = (draft: RevenueDraft | null, target: SelectTarget): string | null => {
	if (draft === null || target._tag === "AddValue") return null
	if (target._tag === "Window") return String(draft.variableMrrMonths)
	const rule = draft.rules.find((candidate) => candidate.id === target.ruleId)
	return target._tag === "Class"
		? (rule?.classification ?? null)
		: (rule?.conditions[target.index]?.field ?? null)
}

/** The Select as the view draws it: its popup, with the selection the draft holds. */
export const selectModelOf = (model: Model, target: SelectTarget, canEdit: boolean): Select.Model => {
	const id = selectIdOf(target)
	return {
		...(model.selects[id] ?? Select.init({ id })),
		selectedKey: Option.fromNullishOr(selectedKeyOf(draftOf(model), target)),
		isDisabled: !canEdit || model.isSaving,
	}
}

const selected = (model: Model, shared: Shared, target: SelectTarget, key: string): Return =>
	Match.valueTags(target, {
		Window: () => edited(model, shared, (draft) => ({ ...draft, variableMrrMonths: Number(key) })),
		Class: ({ ruleId }) => {
			const classification = Customers.RevenueClass.literals.find((value) => value === key)
			return classification === undefined
				? { model }
				: edited(model, shared, (draft) =>
						withRule(draft, ruleId, (rule) => ({ ...rule, classification })),
					)
		},
		Field: ({ ruleId, index }) => {
			const field = Customers.RevenueConditionField.literals.find((value) => value === key)
			if (field === undefined) return { model }
			// Only a metadata condition has a typed value: another field must not inherit it.
			const entryKey = entryKeyOf(ruleId, index)
			const valueEntries =
				field === "metadata"
					? model.valueEntries
					: Object.fromEntries(
							Object.entries(model.valueEntries).filter(([key]) => key !== entryKey),
						)
			return edited({ ...model, valueEntries }, shared, (draft) =>
				withCondition(draft, ruleId, index, (condition) => withField(condition, field)),
			)
		},
		AddValue: ({ ruleId, index }) =>
			edited(model, shared, (draft) =>
				withCondition(draft, ruleId, index, (condition) =>
					condition.values.includes(key) || condition.values.length >= MAX_VALUES
						? condition
						: { ...condition, values: [...condition.values, key] },
				),
			),
	})

const selectChanged = (model: Model, shared: Shared, selectId: string, message: Select.Message): Return => {
	const target = targetOfSelectId(selectId)
	if (target === null) return { model }
	// An "add a value" picker has no selection to step through with the arrow keys.
	if (
		target._tag === "AddValue" &&
		message._tag === "PressedTriggerKey" &&
		(message.key === "ArrowLeft" || message.key === "ArrowRight")
	)
		return { model }
	const result = Select.update(selectModelOf(model, target, isCustomersAdmin(shared)), message)
	const next = { ...model, selects: { ...model.selects, [selectId]: result.model } }
	const commands = Command.mapMessages(result.commands ?? [], (inner) =>
		Message.GotSelectMessage({ selectId, message: inner }),
	)
	if (result.outMessage === undefined) return { model: next, commands }
	const changed = selected(next, shared, target, result.outMessage.key)
	return { ...changed, commands: [...commands, ...(changed.commands ?? [])] }
}

/** The typed value joins the condition, and the input empties for the next one. */
const entrySubmitted = (model: Model, shared: Shared, ruleId: string, index: number): Return => {
	const key = entryKeyOf(ruleId, index)
	const value = (model.valueEntries[key] ?? "").trim()
	if (value === "") return { model }
	const { [key]: _submitted, ...valueEntries } = model.valueEntries
	return edited({ ...model, valueEntries }, shared, (draft) =>
		withCondition(draft, ruleId, index, (condition) =>
			condition.values.includes(value) || condition.values.length >= MAX_VALUES
				? condition
				: { ...condition, values: [...condition.values, value] },
		),
	)
}

/** Entries are by condition position: removing a condition must not hand its text to the next one. */
const withoutEntriesOf = (model: Model, ruleId: string): Model => ({
	...model,
	valueEntries: Object.fromEntries(
		Object.entries(model.valueEntries).filter(([key]) => !key.startsWith(`${ruleId}:`)),
	),
})

/** A condition is gone: its text goes, and the entries after it follow their conditions up one. */
const withoutEntryOf = (model: Model, ruleId: string, removed: number): Model => ({
	...model,
	valueEntries: Object.fromEntries(
		Object.entries(model.valueEntries).flatMap(([key, text]) => {
			if (!key.startsWith(`${ruleId}:`)) return [[key, text]]
			const index = Number(key.slice(ruleId.length + 1))
			return index === removed ? [] : [[entryKeyOf(ruleId, index > removed ? index - 1 : index), text]]
		}),
	),
})

/** What is still typed in a value input joins its condition: Save means what the page shows. */
const withEntriesCommitted = (model: Model): Model => {
	if (model.draft === null) return model
	const rules = model.draft.rules.map((rule) => ({
		...rule,
		conditions: rule.conditions.map((condition, index) => {
			const value = (model.valueEntries[entryKeyOf(rule.id, index)] ?? "").trim()
			return condition.field !== "metadata" ||
				value === "" ||
				condition.values.includes(value) ||
				condition.values.length >= MAX_VALUES
				? condition
				: { ...condition, values: [...condition.values, value] }
		}),
	}))
	return { ...model, draft: { ...model.draft, rules }, valueEntries: {} }
}

const saved = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	const valid = model.draft === null ? null : validOf(model.draft)
	if (
		valid === null ||
		organizationId === undefined ||
		model.settings === null ||
		model.isSaving ||
		!isCustomersAdmin(shared)
	)
		return { model }
	return {
		model: {
			...model,
			// As it is sent: the saved rules, once synced, settle it.
			draft: model.draft === null ? null : normalizedDraft(model.draft),
			isSaving: true,
			confirmModal: Modal.close(model.confirmModal).model,
		},
		commands: [
			SaveRevenueSettings({
				organizationId,
				settingsId: model.settings.id,
				rules: valid.rules,
				variableMrrMonths: valid.variableMrrMonths,
			}),
		],
	}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedSettings: ({ settings }) => {
			const next = settled({ ...model, settings })
			// The saved rules are the preview's "current": a change to them (first sync, another admin) moves it.
			return settings !== null && (model.settings === null || !isSameBasis(model.settings, settings))
				? previewed(next)
				: { model: next }
		},

		GotSelectMessage: ({ selectId, message: selectMessage }) =>
			selectChanged(model, shared, selectId, selectMessage),
		PressedAddRule: () =>
			(draftOf(model)?.rules.length ?? 0) >= Customers.MAX_REVENUE_RULES
				? { model }
				: edited(model, shared, withNewRule),
		// A name is not part of the basis: nothing to preview again.
		ChangedRuleName: ({ ruleId, name }) => ({
			model:
				editedDraft(model, shared, (draft) =>
					withRule(draft, ruleId, (rule) => ({ ...rule, name })),
				) ?? model,
		}),
		PressedMoveRule: ({ ruleId, step }) =>
			edited(model, shared, (draft) => withRuleMoved(draft, ruleId, step)),
		PressedDeleteRule: ({ ruleId }) =>
			edited(withoutEntriesOf(model, ruleId), shared, (draft) => ({
				...draft,
				rules: draft.rules.filter((rule) => rule.id !== ruleId),
			})),
		PressedAddCondition: ({ ruleId }) =>
			edited(model, shared, (draft) =>
				withRule(draft, ruleId, (rule) =>
					rule.conditions.length >= MAX_CONDITIONS ? rule : withNewCondition(rule),
				),
			),
		PressedRemoveCondition: ({ ruleId, index }) =>
			edited(withoutEntryOf(model, ruleId, index), shared, (draft) =>
				withRule(draft, ruleId, (rule) => ({
					...rule,
					conditions: rule.conditions.filter((_, at) => at !== index),
				})),
			),
		ToggledValue: ({ ruleId, index, value }) =>
			edited(model, shared, (draft) =>
				withCondition(draft, ruleId, index, (condition) => withValueToggled(condition, value)),
			),
		ChangedMetadataKey: ({ ruleId, index, key }) =>
			edited(model, shared, (draft) =>
				withCondition(draft, ruleId, index, (condition) => ({ ...condition, key })),
			),
		ChangedValueEntry: ({ ruleId, index, text }) => ({
			model: { ...model, valueEntries: { ...model.valueEntries, [entryKeyOf(ruleId, index)]: text } },
		}),
		SubmittedValueEntry: ({ ruleId, index }) => entrySubmitted(model, shared, ruleId, index),

		PressedDiscard: () =>
			model.isSaving ? { model } : previewed({ ...model, draft: null, valueEntries: {} }),
		// A change of the basis rewrites history: that gets a confirmation. A rename saves as is.
		PressedSave: () => {
			const committed = withEntriesCommitted(model)
			if (committed.draft === null || validOf(committed.draft) === null || model.isSaving)
				return { model }
			if (!restatesHistory(committed)) return saved(committed, shared)
			// The confirmation shows the preview of what will be saved, typed values included.
			const next = Equal.equals(committed.draft, model.draft)
				? { model: committed }
				: previewed(committed)
			return {
				...next,
				model: { ...next.model, confirmModal: Modal.open(next.model.confirmModal).model },
			}
		},
		PressedConfirmSave: () => saved(model, shared),
		GotConfirmModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.confirmModal, modalMessage)
			return {
				model: { ...model, confirmModal: result.model },
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotConfirmModalMessage({ message: inner }),
				),
			}
		},
		PressedRetryPreview: () => previewed(model),
		PressedRetryCatalog: () => fetchedCatalog(model, shared),

		ElapsedRevenuePreviewDelay: ({ version }) => {
			const draft = draftOf(model)
			const valid = draft === null ? null : validOf(draft)
			const organizationId = shared.organization?.id
			return version !== model.preview.version || valid === null || organizationId === undefined
				? { model }
				: { model, commands: [FetchRevenuePreview({ organizationId, ...valid, version })] }
		},
		SucceededFetchRevenuePreview: ({ version, result }) =>
			version === model.preview.version
				? {
						model: {
							...model,
							preview: {
								...model.preview,
								result: AsyncData.settle(model.preview.result, Result.succeed(result)),
							},
						},
					}
				: { model },
		FailedFetchRevenuePreview: ({ version, reason }) =>
			version === model.preview.version
				? {
						model: {
							...model,
							preview: {
								...model.preview,
								result: AsyncData.settle(model.preview.result, Result.fail(reason)),
							},
						},
					}
				: { model },
		SucceededFetchRevenueCatalog: ({ catalog }) => ({
			model: { ...model, catalog: AsyncData.Success({ data: catalog }) },
		}),
		FailedFetchRevenueCatalog: ({ reason }) => ({
			model: { ...model, catalog: AsyncData.Failure({ error: reason }) },
		}),
		SucceededSaveRevenueSettings: () => ({
			...previewed(settled({ ...model, isSaving: false, valueEntries: {} })),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(
					"Revenue settings saved",
					"The next compute restates MRR under them if the rules or window changed.",
				),
			}),
		}),
		// The collection rolls the row back; the draft stays, to try again.
		FailedSaveRevenueSettings: ({ reason }) => ({
			model: { ...model, isSaving: false },
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
	})
