import * as Customers from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Equal, Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { reasonToast, successToast } from "../../../../data/actions"
import * as Select from "../../../../ui/select"
import * as Slider from "../../../../ui/slider"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { DelayHealthPreview, FetchHealthCheckDetail, FetchHealthDryRun, SaveHealthSettings } from "./commands"
import { Message } from "./message"
import {
	CHECK_ACCOUNT_ID,
	draftOf,
	type Model,
	scaledWeights,
	type SliderId,
	validDraftOf,
	withBand,
	withBandHandle,
	withScore,
	withStep,
	withWeight,
} from "./model"

type Return = PageReturn<Model, Message>
type HealthSettings = Customers.HealthSettings

/** Module scope, one per Slider: `toParentMessage` must keep its identity across renders. */
export const SLIDER_MESSAGE = {
	usage: (message) => Message.GotSliderMessage({ id: "usage", message }),
	engagement: (message) => Message.GotSliderMessage({ id: "engagement", message }),
	billing: (message) => Message.GotSliderMessage({ id: "billing", message }),
	signals: (message) => Message.GotSliderMessage({ id: "signals", message }),
	healthyMin: (message) => Message.GotSliderMessage({ id: "healthyMin", message }),
	atRiskMin: (message) => Message.GotSliderMessage({ id: "atRiskMin", message }),
} as const satisfies { readonly [Id in SliderId]: (message: Slider.Message) => Message }

export const toCheckAccountMessage = (message: Select.Message) => Message.GotCheckAccountMessage({ message })

const percentSlider = (id: SliderId) => Slider.init({ id: `health-${id}`, min: 0, max: 100, step: 1 })

export const init = (): Return => ({
	model: {
		settings: null,
		draft: null,
		lastWeight: null,
		accounts: null,
		sliders: {
			usage: percentSlider("usage"),
			engagement: percentSlider("engagement"),
			billing: percentSlider("billing"),
			signals: percentSlider("signals"),
			healthyMin: percentSlider("healthyMin"),
			atRiskMin: percentSlider("atRiskMin"),
		},
		preview: { version: 0, result: AsyncData.Idle() },
		previewMetric: "customers",
		checkAccount: Select.init({ id: CHECK_ACCOUNT_ID }),
		check: null,
		isSaving: false,
	},
})

/** No draft once it matches the saved settings again (kept while saving, in case the save rolls back). */
const settled = (model: Model): Model =>
	!model.isSaving &&
	model.draft !== null &&
	model.settings !== null &&
	Equal.equals(model.draft, model.settings.health)
		? { ...model, draft: null }
		: model

/**
 * A new draft: a new preview version. A valid one is scored once it stays still for
 * `PREVIEW_DELAY`; without changes the saved distribution shows, and an invalid one pauses the preview.
 */
const previewed = (model: Model): Return => {
	const version = model.preview.version + 1
	if (validDraftOf(model) === null)
		return { model: { ...model, preview: { version, result: AsyncData.Idle() } } }
	const { result } = model.preview
	return {
		model: {
			...model,
			preview: { version, result: Option.getOrElse(AsyncData.revalidateOrLoad(result), () => result) },
		},
		commands: [DelayHealthPreview({ version })],
	}
}

const edited = (model: Model, f: (draft: HealthSettings) => HealthSettings): Return => {
	const draft = draftOf(model)
	return draft === null ? { model } : previewed(settled({ ...model, draft: f(draft) }))
}

const editedWeight = (model: Model, key: Customers.HealthComponentKey, value: number): Return =>
	edited({ ...model, lastWeight: key }, (draft) => withWeight(draft, key, value))

const withCommands = (result: Return, commands: Return["commands"]): Return => ({
	...result,
	commands: [...(commands ?? []), ...(result.commands ?? [])],
})

const sliderChanged = (model: Model, id: SliderId, message: Slider.Message): Return => {
	const result = Slider.update(model.sliders[id], message)
	const next = { ...model, sliders: { ...model.sliders, [id]: result.model } }
	const commands = Command.mapMessages(result.commands ?? [], SLIDER_MESSAGE[id])
	const value = result.outMessage?.value
	if (value === undefined) return { model: next, commands }
	const changed =
		id === "healthyMin" || id === "atRiskMin"
			? edited(next, (draft) => withBandHandle(draft, id, value))
			: editedWeight(next, id, value)
	return withCommands(changed, commands)
}

/** Picks the account whose breakdown "Check one customer" shows, and loads its saved one. */
const checked = (model: Model, shared: Shared, accountId: CustomerAccountId): Return => {
	const organizationId = shared.organization?.id
	const next: Model = {
		...model,
		checkAccount: { ...model.checkAccount, selectedKey: Option.some(accountId) },
		check: { accountId, saved: AsyncData.Loading() },
	}
	return organizationId === undefined
		? { model: next }
		: { model: next, commands: [FetchHealthCheckDetail({ organizationId, accountId })] }
}

const checkAccountChanged = (model: Model, shared: Shared, message: Select.Message): Return => {
	const result = Select.update(model.checkAccount, message)
	const next = { ...model, checkAccount: result.model }
	const commands = Command.mapMessages(result.commands ?? [], toCheckAccountMessage)
	const accountId = model.accounts?.find((account) => account.id === result.outMessage?.key)?.id
	return accountId === undefined || accountId === model.check?.accountId
		? { model: next, commands }
		: withCommands(checked(next, shared, accountId), commands)
}

/** The dry run answered: the picker defaults to the first customer it moves. */
const dryRunSucceeded = (model: Model, shared: Shared, result: Customers.HealthDryRunResult): Return => {
	const next: Model = {
		...model,
		preview: {
			...model.preview,
			result: AsyncData.settle(model.preview.result, Result.succeed(result)),
		},
	}
	const first = result.samples[0]
	return model.check === null && first !== undefined
		? checked(next, shared, first.accountId)
		: { model: next }
}

const discarded = (model: Model): Return => previewed({ ...model, draft: null, lastWeight: null })

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedSettings: ({ settings }) => ({ model: settled({ ...model, settings }) }),
		UpdatedAccounts: ({ accounts }) => ({ model: { ...model, accounts } }),

		ChangedWeight: ({ key, value }) => editedWeight(model, key, value),
		ChangedBand: ({ band, value }) => edited(model, (draft) => withBand(draft, band, value)),
		ChangedStep: ({ list, index, field, value }) =>
			edited(model, (draft) => withStep(draft, list, index, field, value)),
		ChangedScore: ({ field, value }) => edited(model, (draft) => withScore(draft, field, value)),
		GotSliderMessage: ({ id, message }) => sliderChanged(model, id, message),
		PressedScaleWeights: () =>
			edited({ ...model, lastWeight: null }, (draft) => ({
				...draft,
				weights: scaledWeights(draft.weights),
			})),
		PressedResetDefaults: () =>
			edited({ ...model, lastWeight: null }, () => Customers.DEFAULT_HEALTH_SETTINGS),
		PressedDiscard: () => discarded(model),
		PressedSave: () => {
			const health = validDraftOf(model)
			const organizationId = shared.organization?.id
			if (health === null || organizationId === undefined || model.settings === null || model.isSaving)
				return { model }
			return {
				model: { ...model, isSaving: true },
				commands: [SaveHealthSettings({ organizationId, settingsId: model.settings.id, health })],
			}
		},
		PressedRetryPreview: () => previewed(model),
		ClickedPreviewMetric: ({ metric }) => ({ model: { ...model, previewMetric: metric } }),
		GotCheckAccountMessage: ({ message }) => checkAccountChanged(model, shared, message),

		ElapsedHealthPreviewDelay: ({ version }) => {
			const draft = validDraftOf(model)
			const organizationId = shared.organization?.id
			return version !== model.preview.version || draft === null || organizationId === undefined
				? { model }
				: { model, commands: [FetchHealthDryRun({ organizationId, draft, version })] }
		},
		SucceededFetchHealthDryRun: ({ version, result }) =>
			version === model.preview.version ? dryRunSucceeded(model, shared, result) : { model },
		FailedFetchHealthDryRun: ({ version, reason }) =>
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
		SucceededFetchHealthCheckDetail: ({ accountId, health }) =>
			model.check?.accountId === accountId
				? { model: { ...model, check: { accountId, saved: AsyncData.Success({ data: health }) } } }
				: { model },
		FailedFetchHealthCheckDetail: ({ accountId, reason }) =>
			model.check?.accountId === accountId
				? { model: { ...model, check: { accountId, saved: AsyncData.Failure({ error: reason }) } } }
				: { model },
		SucceededSaveHealthSettings: () => ({
			...previewed(settled({ ...model, isSaving: false })),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Health score saved", "Customers are rescored on the next compute."),
			}),
		}),
		FailedSaveHealthSettings: ({ reason }) => ({
			model: { ...model, isSaving: false },
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
	})
