import * as AsyncData from "foldkit/asyncData"
import { reasonToast } from "../../../../data/actions"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import { FetchPlans, SaveSettings } from "./commands"
import { Message } from "./message"
import type { Model, SavedSettings, SettingsChange } from "./model"

type Return = PageReturn<Model, Message>

const fetched = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	return organizationId === undefined
		? { model }
		: { model: { ...model, plans: AsyncData.Loading() }, commands: [FetchPlans({ organizationId })] }
}

/** An admin's change, saved at once; one save at a time, so saves cannot land out of order. */
const saved = (
	model: Model,
	shared: Shared,
	changeOf: (settings: SavedSettings) => SettingsChange,
): Return => {
	const organizationId = shared.organization?.id
	const { settings } = model
	if (settings === null || organizationId === undefined || model.isSaving || !isCustomersAdmin(shared))
		return { model }
	const change = changeOf(settings)
	return {
		model: { ...model, settings: { ...settings, ...change }, isSaving: true },
		commands: [SaveSettings({ organizationId, settingsId: settings.id, change })],
	}
}

export const init = (_route: unknown, shared: Shared): Return =>
	fetched({ settings: null, plans: AsyncData.Idle(), isSaving: false }, shared)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.plans) ? fetched(model, shared) : { model }

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedSettings: ({ settings }) => ({ model: { ...model, settings } }),
		ToggledAddOn: ({ plan, isAddOn }) =>
			saved(model, shared, (settings) => {
				const others = settings.addOnPlans.filter((name) => name !== plan)
				return { addOnPlans: isAddOn ? [...others, plan] : others }
			}),
		ToggledOverageInMrr: ({ isOn }) => saved(model, shared, () => ({ overageInMrr: isOn })),
		PressedRetry: () => fetched(model, shared),

		SucceededFetchPlans: ({ plans }) => ({
			model: { ...model, plans: AsyncData.Success({ data: plans }) },
		}),
		FailedFetchPlans: ({ reason }) => ({
			model: { ...model, plans: AsyncData.Failure({ error: reason }) },
		}),
		SucceededSaveSettings: () => ({ model: { ...model, isSaving: false } }),
		// The collection rolls the row back, and the settings stream with it.
		FailedSaveSettings: ({ reason }) => ({
			model: { ...model, isSaving: false },
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
	})
