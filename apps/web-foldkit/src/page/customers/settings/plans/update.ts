import * as AsyncData from "foldkit/asyncData"
import { reasonToast } from "../../../../data/actions"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import { FetchPlans, SaveAddOnPlans } from "./commands"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

const fetched = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	return organizationId === undefined
		? { model }
		: { model: { ...model, plans: AsyncData.Loading() }, commands: [FetchPlans({ organizationId })] }
}

export const init = (_route: unknown, shared: Shared): Return =>
	fetched({ settings: null, plans: AsyncData.Idle(), isSaving: false }, shared)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.plans) ? fetched(model, shared) : { model }

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedSettings: ({ settings }) => ({ model: { ...model, settings } }),
		ToggledAddOn: ({ plan, isAddOn }) => {
			const organizationId = shared.organization?.id
			const { settings } = model
			if (
				settings === null ||
				organizationId === undefined ||
				model.isSaving ||
				!isCustomersAdmin(shared)
			)
				return { model }
			const others = settings.addOnPlans.filter((name) => name !== plan)
			const addOnPlans = isAddOn ? [...others, plan] : others
			return {
				model: { ...model, settings: { ...settings, addOnPlans }, isSaving: true },
				commands: [SaveAddOnPlans({ organizationId, settingsId: settings.id, addOnPlans })],
			}
		},
		PressedRetry: () => fetched(model, shared),

		SucceededFetchPlans: ({ plans }) => ({
			model: { ...model, plans: AsyncData.Success({ data: plans }) },
		}),
		FailedFetchPlans: ({ reason }) => ({
			model: { ...model, plans: AsyncData.Failure({ error: reason }) },
		}),
		SucceededSaveAddOnPlans: () => ({ model: { ...model, isSaving: false } }),
		// The collection rolls the row back, and the settings stream with it.
		FailedSaveAddOnPlans: ({ reason }) => ({
			model: { ...model, isSaving: false },
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
	})
