import * as Customers from "@hazel/domain/customers"
import type { CustomerSlaPolicyId } from "@hazel/schema"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, reasonToast, successToast } from "../../../../data/actions"
import type { ToastRequest } from "../../../../overlay/toasts"
import * as Modal from "../../../../ui/modal"
import * as Select from "../../../../ui/select"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import {
	CreateSlaPolicy,
	DeleteSlaPolicy,
	FetchSlaPlans,
	ReorderSlaPolicies,
	SaveBusinessHours,
	ToggleSlaPolicy,
	UpdateSlaPolicy,
} from "./commands"
import {
	businessHoursOfForm,
	draftOfForm,
	draftOfRow,
	formOfPolicy,
	newPolicyForm,
	withoutDays,
} from "./draft"
import { Message, type PolicyWriteFailure } from "./message"
import {
	CLOCKS,
	DELETE_MODAL_ID,
	type DurationUnit,
	type Editor,
	type HoursForm,
	hoursFormOf,
	type Model,
	PRIORITIES,
	type PolicyForm,
	type PolicyRow,
	policyById,
	type SlaClock,
	TIME_ZONE_SELECT_ID,
	unitSelectId,
	WARN_SELECT_ID,
} from "./model"

type Return = PageReturn<Model, Message>

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const writeFailure = (title: string, reason: PolicyWriteFailure) =>
	toast(
		errorToastOf(
			failureMessage(reason, {
				NotFound: { title, description: "The policy was deleted in the meantime." },
				Invalid: { title, description: "The order changed in the meantime. Try again." },
			}),
		),
	)

const toSelect = (selectId: string) => (message: Select.Message) =>
	Message.GotSelectMessage({ selectId, message })

// SELECTS

const UNIT_SELECTS: ReadonlyArray<readonly [string, Customers.SlaPriority, SlaClock]> = PRIORITIES.flatMap(
	(priority) => CLOCKS.map((clock) => [unitSelectId(priority, clock), priority, clock] as const),
)

/** The editor's Selects, fresh for the form it opens with. */
const editorSelects = (form: PolicyForm, isDisabled: boolean): Model["selects"] =>
	Object.fromEntries([
		[
			WARN_SELECT_ID,
			Select.init({ id: WARN_SELECT_ID, selectedKey: String(form.warnBeforePct), isDisabled }),
		],
		...UNIT_SELECTS.map(([id, priority, clock]) => [
			id,
			Select.init({ id, selectedKey: form.targets[priority][clock].unit, isDisabled }),
		]),
	])

const timeZoneSelect = (model: Model, shared: Shared): Select.Model =>
	Select.init({
		id: TIME_ZONE_SELECT_ID,
		selectedKey: hoursFormOf(model).timeZone,
		isDisabled: !isCustomersAdmin(shared) || model.isSavingHours,
	})

/** The editor's Selects rebuilt from its form: disabled while it saves. */
const withEditorSelects = (model: Model, shared: Shared): Model =>
	model.editor === null
		? model
		: {
				...model,
				selects: {
					...model.selects,
					...editorSelects(model.editor.form, !isCustomersAdmin(shared) || model.editor.isSaving),
				},
			}

const withTimeZoneSelect = (model: Model, shared: Shared): Model => ({
	...model,
	selects: { ...model.selects, [TIME_ZONE_SELECT_ID]: timeZoneSelect(model, shared) },
})

// INIT

const fetched = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	return organizationId === undefined
		? { model }
		: { model: { ...model, plans: AsyncData.Loading() }, commands: [FetchSlaPlans({ organizationId })] }
}

export const init = (_route: unknown, shared: Shared): Return => {
	const model: Model = {
		policies: null,
		settings: null,
		accounts: [],
		plans: AsyncData.Idle(),
		hoursForm: null,
		isSavingHours: false,
		isWritingList: false,
		editor: null,
		editorsOpened: 0,
		deleteModal: Modal.init(DELETE_MODAL_ID),
		deletingPolicyId: null,
		selects: {},
	}
	return fetched(withTimeZoneSelect(model, shared), shared)
}

/** The organization (or the member's role) arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return => {
	const next = model.hoursForm === null ? withTimeZoneSelect(model, shared) : model
	return AsyncData.isIdle(next.plans) ? fetched(next, shared) : { model: next }
}

// BUSINESS HOURS

const editedHours = (model: Model, shared: Shared, change: (form: HoursForm) => HoursForm): Return =>
	!isCustomersAdmin(shared) || model.isSavingHours
		? { model }
		: { model: { ...model, hoursForm: change(hoursFormOf(model)) } }

const savedHours = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	const businessHours = model.hoursForm === null ? undefined : businessHoursOfForm(model.hoursForm)
	if (
		organizationId === undefined ||
		model.settings === null ||
		businessHours === undefined ||
		model.isSavingHours ||
		!isCustomersAdmin(shared)
	)
		return { model }
	return {
		model: withTimeZoneSelect({ ...model, isSavingHours: true }, shared),
		commands: [
			SaveBusinessHours({ organizationId, settingsId: model.settings.settingsId, businessHours }),
		],
	}
}

// THE LIST

/** The list's switch: the saved policy with `enabled` flipped, one list write at a time. */
const toggled = (model: Model, shared: Shared, policyId: CustomerSlaPolicyId, enabled: boolean): Return => {
	const organizationId = shared.organization?.id
	const policy = policyById(model, policyId)
	if (
		organizationId === undefined ||
		policy === undefined ||
		model.isWritingList ||
		!isCustomersAdmin(shared)
	)
		return { model }
	return {
		model: {
			...model,
			isWritingList: true,
			policies: (model.policies ?? []).map((row) => (row.id === policyId ? { ...row, enabled } : row)),
		},
		commands: [ToggleSlaPolicy({ organizationId, policyId, policy: draftOfRow({ ...policy, enabled }) })],
	}
}

/** Moves a policy one place; the server takes the whole order. */
const moved = (model: Model, shared: Shared, policyId: CustomerSlaPolicyId, offset: -1 | 1): Return => {
	const organizationId = shared.organization?.id
	const policies = model.policies ?? []
	const from = policies.findIndex((policy) => policy.id === policyId)
	const to = from + offset
	if (
		organizationId === undefined ||
		from === -1 ||
		to < 0 ||
		to >= policies.length ||
		model.isWritingList ||
		!isCustomersAdmin(shared)
	)
		return { model }
	const order = [...policies]
	const [policy] = order.splice(from, 1)
	if (policy === undefined) return { model }
	order.splice(to, 0, policy)
	return {
		model: {
			...model,
			isWritingList: true,
			policies: order.map((row, position): PolicyRow => ({ ...row, position })),
		},
		commands: [ReorderSlaPolicies({ organizationId, policyIds: order.map((row) => row.id) })],
	}
}

const deleteConfirmed = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	const policyId = model.deletingPolicyId
	const closed = { ...model, deleteModal: Modal.close(model.deleteModal).model, deletingPolicyId: null }
	if (organizationId === undefined || policyId === null || !isCustomersAdmin(shared))
		return { model: closed }
	return {
		model: {
			...closed,
			policies: (model.policies ?? []).filter((policy) => policy.id !== policyId),
			editor: model.editor?.policyId === policyId ? null : model.editor,
		},
		commands: [DeleteSlaPolicy({ organizationId, policyId })],
	}
}

// THE EDITOR

const opened = (
	model: Model,
	shared: Shared,
	policyId: CustomerSlaPolicyId | null,
	form: PolicyForm,
): Return => ({
	model: {
		...model,
		editor: { policyId, token: model.editorsOpened + 1, form, showErrors: false, isSaving: false },
		editorsOpened: model.editorsOpened + 1,
		selects: { ...model.selects, ...editorSelects(form, !isCustomersAdmin(shared)) },
	},
})

const edited = (model: Model, shared: Shared, change: (form: PolicyForm) => PolicyForm): Return => {
	const editor = model.editor
	if (editor === null || editor.isSaving || !isCustomersAdmin(shared)) return { model }
	return { model: { ...model, editor: { ...editor, form: change(editor.form) } } }
}

const withTarget = (
	form: PolicyForm,
	priority: Customers.SlaPriority,
	clock: SlaClock,
	change: Partial<PolicyForm["targets"]["medium"]["firstResponse"]>,
): PolicyForm => ({
	...form,
	targets: {
		...form.targets,
		[priority]: { ...form.targets[priority], [clock]: { ...form.targets[priority][clock], ...change } },
	},
})

const toggledIn = (list: ReadonlyArray<string>, value: string): ReadonlyArray<string> =>
	list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const withTag = (form: PolicyForm): PolicyForm => {
	const tag = form.tagInput.trim().slice(0, 50)
	return tag === "" || form.tags.includes(tag) || form.tags.length >= 50
		? { ...form, tagInput: "" }
		: { ...form, tags: [...form.tags, tag], tagInput: "" }
}

const savedPolicy = (model: Model, shared: Shared, editor: Editor): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined || editor.isSaving || !isCustomersAdmin(shared)) return { model }
	// A tag still in the box counts.
	const form = withTag(editor.form)
	const policy = draftOfForm(form)
	if (policy === undefined) return { model: { ...model, editor: { ...editor, form, showErrors: true } } }
	return {
		model: withEditorSelects(
			{ ...model, editor: { ...editor, form, showErrors: true, isSaving: true } },
			shared,
		),
		commands: [
			editor.policyId === null
				? CreateSlaPolicy({ organizationId, policy, token: editor.token })
				: UpdateSlaPolicy({ organizationId, policyId: editor.policyId, policy, token: editor.token }),
		],
	}
}

/** A Select chose: the time zone, the warning share, or a target's unit. */
const selected = (model: Model, shared: Shared, selectId: string, key: string): Return => {
	if (selectId === TIME_ZONE_SELECT_ID)
		return editedHours(model, shared, (form) => ({ ...form, timeZone: key }))
	if (selectId === WARN_SELECT_ID)
		return edited(model, shared, (form) => ({ ...form, warnBeforePct: Number(key) }))
	const unit = UNIT_SELECTS.find(([id]) => id === selectId)
	return unit === undefined
		? { model }
		: edited(model, shared, (form) => withTarget(form, unit[1], unit[2], { unit: key as DurationUnit }))
}

const selectChanged = (model: Model, shared: Shared, selectId: string, message: Select.Message): Return => {
	const current = model.selects[selectId]
	if (current === undefined) return { model }
	const result = Select.update(current, message)
	const next = { ...model, selects: { ...model.selects, [selectId]: result.model } }
	const commands = Command.mapMessages(result.commands ?? [], toSelect(selectId))
	if (result.outMessage === undefined) return { model: next, commands }
	const changed = selected(next, shared, selectId, result.outMessage.key)
	// A refused edit (saving, or read-only): the Select goes back to what the form holds.
	const refused = changed.model === next
	const reverted = !refused
		? changed.model
		: selectId === TIME_ZONE_SELECT_ID
			? withTimeZoneSelect(next, shared)
			: withEditorSelects(next, shared)
	return { ...changed, model: reverted, commands: [...commands, ...(changed.commands ?? [])] }
}

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedPolicies: ({ policies }) => ({ model: { ...model, policies } }),
		UpdatedSettings: ({ settings }) => {
			const next = { ...model, settings }
			return { model: model.hoursForm === null ? withTimeZoneSelect(next, shared) : next }
		},
		UpdatedAccounts: ({ accounts }) => ({ model: { ...model, accounts } }),
		SucceededFetchPlans: ({ plans }) => ({
			model: { ...model, plans: AsyncData.Success({ data: plans }) },
		}),
		FailedFetchPlans: ({ reason }) => ({
			model: { ...model, plans: AsyncData.Failure({ error: reason }) },
		}),
		PressedRetryPlans: () => (AsyncData.isLoading(model.plans) ? { model } : fetched(model, shared)),
		GotSelectMessage: ({ selectId, message: selectMessage }) =>
			selectChanged(model, shared, selectId, selectMessage),

		ToggledDay: ({ day }) =>
			editedHours(model, shared, (form) => ({
				...form,
				days: form.days.includes(day)
					? form.days.filter((other) => other !== day)
					: [...form.days, day],
			})),
		ChangedStart: ({ value }) => editedHours(model, shared, (form) => ({ ...form, start: value })),
		ChangedEnd: ({ value }) => editedHours(model, shared, (form) => ({ ...form, end: value })),
		PressedSaveHours: () => savedHours(model, shared),
		PressedResetHours: () =>
			model.isSavingHours
				? { model }
				: { model: withTimeZoneSelect({ ...model, hoursForm: null }, shared) },
		SucceededSaveHours: () => ({
			model: withTimeZoneSelect({ ...model, hoursForm: null, isSavingHours: false }, shared),
			outMessage: toast(
				successToast("Business hours saved", "New deadlines use them; running ones keep theirs."),
			),
		}),
		FailedSaveHours: ({ reason }) => ({
			model: withTimeZoneSelect({ ...model, isSavingHours: false }, shared),
			outMessage: toast(reasonToast(reason)),
		}),

		ToggledPolicy: ({ policyId, enabled }) => toggled(model, shared, policyId, enabled),
		SucceededTogglePolicy: () => ({ model: { ...model, isWritingList: false } }),
		// The collection rolls the row back, and the policies stream with it.
		FailedTogglePolicy: ({ reason }) => ({
			model: { ...model, isWritingList: false },
			outMessage: writeFailure("Couldn't change the policy", reason),
		}),
		PressedMove: ({ policyId, offset }) => moved(model, shared, policyId, offset),
		SucceededReorder: () => ({ model: { ...model, isWritingList: false } }),
		FailedReorder: ({ reason }) => ({
			model: { ...model, isWritingList: false },
			outMessage: writeFailure("Couldn't reorder the policies", reason),
		}),
		PressedDelete: ({ policyId }) =>
			!isCustomersAdmin(shared) || policyById(model, policyId) === undefined
				? { model }
				: {
						model: {
							...model,
							deletingPolicyId: policyId,
							deleteModal: Modal.open(model.deleteModal).model,
						},
					},
		GotDeleteModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.deleteModal, modalMessage)
			return {
				model: { ...model, deleteModal: result.model },
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotDeleteModalMessage({ message: inner }),
				),
			}
		},
		PressedConfirmDelete: () => deleteConfirmed(model, shared),
		SucceededDeletePolicy: () => ({
			model,
			outMessage: toast(
				successToast("Policy deleted", "Open issues keep the targets they started with."),
			),
		}),
		FailedDeletePolicy: ({ reason }) => ({
			model,
			outMessage: writeFailure("Couldn't delete the policy", reason),
		}),

		PressedNewPolicy: () =>
			isCustomersAdmin(shared) ? opened(model, shared, null, newPolicyForm()) : { model },
		PressedEdit: ({ policyId }) => {
			const policy = policyById(model, policyId)
			return policy === undefined ? { model } : opened(model, shared, policyId, formOfPolicy(policy))
		},
		// Waits for a save in flight: its answer closes the editor or shows why not.
		PressedCloseEditor: () =>
			model.editor?.isSaving === true ? { model } : { model: { ...model, editor: null } },
		ChangedName: ({ value }) => edited(model, shared, (form) => ({ ...form, name: value })),
		ToggledEnabled: ({ enabled }) => edited(model, shared, (form) => ({ ...form, enabled })),
		ClickedHours: ({ hours }) => {
			const next = edited(model, shared, (form) =>
				hours === "business"
					? { ...form, hours, targets: withoutDays(form.targets) }
					: { ...form, hours },
			)
			const editor = next.model.editor
			// The unit pickers show the converted units.
			return editor === null || next.model === model
				? next
				: {
						model: {
							...next.model,
							selects: { ...next.model.selects, ...editorSelects(editor.form, false) },
						},
					}
		},
		ToggledPlan: ({ plan }) =>
			edited(model, shared, (form) => ({ ...form, planNames: toggledIn(form.planNames, plan) })),
		ChangedTagInput: ({ value }) => edited(model, shared, (form) => ({ ...form, tagInput: value })),
		PressedAddTag: () => edited(model, shared, withTag),
		RemovedTag: ({ tag }) =>
			edited(model, shared, (form) => ({ ...form, tags: form.tags.filter((other) => other !== tag) })),
		ChangedAccountSearch: ({ value }) =>
			edited(model, shared, (form) => ({ ...form, accountSearch: value })),
		ClearedAccountSearch: () => edited(model, shared, (form) => ({ ...form, accountSearch: "" })),
		AddedAccount: ({ accountId }) =>
			edited(model, shared, (form) =>
				form.accountIds.includes(accountId)
					? form
					: { ...form, accountIds: [...form.accountIds, accountId], accountSearch: "" },
			),
		RemovedAccount: ({ accountId }) =>
			edited(model, shared, (form) => ({
				...form,
				accountIds: form.accountIds.filter((other) => other !== accountId),
			})),
		ChangedTargetAmount: ({ priority, clock, value }) =>
			edited(model, shared, (form) => withTarget(form, priority, clock, { amount: value })),
		PressedSavePolicy: () =>
			model.editor === null ? { model } : savedPolicy(model, shared, model.editor),
		// The toast names what the save did, whichever editor is open now; only its own editor closes.
		SucceededSavePolicy: ({ token, isNew }) => {
			const isOpen = model.editor?.token === token
			return {
				model: isOpen ? { ...model, editor: null } : model,
				outMessage: toast(
					successToast(
						isNew ? "Policy created" : "Policy saved",
						"It applies to issues opened from now on.",
					),
				),
			}
		},
		FailedSavePolicy: ({ token, reason }) => ({
			model:
				model.editor === null || model.editor.token !== token
					? model
					: withEditorSelects({ ...model, editor: { ...model.editor, isSaving: false } }, shared),
			outMessage: writeFailure("Couldn't save the policy", reason),
		}),
	})
