import { isInvalid, isValid, validate } from "foldkit/fieldValidation"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, infoToast, successToast } from "../../../data/actions"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { webhookNameRules } from "../name-rules"
import { ConnectProvider, CreateWebhook, RunProviderAction, WaitForConfirmReset } from "./command"
import type { Message } from "./message"
import {
	CardAction,
	type ChannelRequestFailure,
	channelRequestMessage,
	emptyCreateForm,
	type CreateForm,
	INTEGRATION_CONFIG,
	itemsOf,
	type Model,
	type Provider,
	type ProviderCard,
} from "./model"
import { reload } from "./rows"

/** The IntegrationCard and CreateWebhookForm Messages, folded into the page's `Message.match`. */

type Return = PageReturn<Model, Message>
type Handlers = { readonly [T in Message["_tag"]]: (message: Extract<Message, { _tag: T }>) => Return }

const withCard = (model: Model, provider: Provider, f: (card: ProviderCard) => ProviderCard): Model =>
	modifyFields(model, { providers: (providers) => ({ ...providers, [provider]: f(providers[provider]) }) })

const withAction = (model: Model, provider: Provider, action: CardAction): Model =>
	withCard(model, provider, (card) => ({ ...card, action }))

const withForm = (model: Model, f: (form: CreateForm) => CreateForm): Model =>
	modifyFields(model, { createForm: f })

/** The webhook the provider card manages (`webhooks.find((w) => w.name === "OpenStatus")`). */
export const providerWebhook = (model: Model, provider: Provider) =>
	itemsOf(model.webhooks).find((webhook) => webhook.name === INTEGRATION_CONFIG[provider].name) ?? null

const refetchWebhooks = (model: Model) => reload(model, "webhook")

const channelRequestToast = (reason: ChannelRequestFailure) => errorToastOf(channelRequestMessage(reason))

/** TanStack Form `canSubmit`: not submitting, and the name has not failed its rules. */
export const canCreate = (form: CreateForm) => !form.isSubmitting && !isInvalid(form.name)

/** Toggle and Delete start from a resting card; an armed "Confirm?" is a resting card too. */
const isResting = (card: ProviderCard) =>
	card.action._tag === "Idle" || card.action._tag === "ConfirmingDelete"

export const updateCards = (
	model: Model,
): Pick<
	Handlers,
	| "ClickedConnectProvider"
	| "SucceededConnectProvider"
	| "FailedConnectProvider"
	| "ClickedToggleProvider"
	| "ClickedDeleteProvider"
	| "ElapsedConfirmDelay"
	| "SucceededProviderAction"
	| "FailedProviderAction"
	| "ClickedProviderUrlInfo"
	| "ClickedDismissProviderToken"
	| "ClickedExpandCreateForm"
	| "ClickedCancelCreateForm"
	| "ChangedCreateField"
	| "SubmittedCreateForm"
	| "SucceededCreateWebhook"
	| "FailedCreateWebhook"
	| "ClickedToggleTokenVisible"
	| "ClickedDismissToken"
> => ({
	ClickedConnectProvider: ({ provider }) =>
		model.providers[provider].action._tag === "Idle"
			? {
					model: withAction(model, provider, CardAction.Connecting()),
					commands: [ConnectProvider({ channelId: model.channelId, provider })],
				}
			: { model },
	SucceededConnectProvider: ({ provider, token }) => ({
		...refetchWebhooks(
			withCard(model, provider, (card) => ({
				...card,
				action: CardAction.Idle(),
				createdToken: token,
			})),
		),
		outMessage: PageOutMessage.RequestedToast({
			toast: successToast(`${INTEGRATION_CONFIG[provider].name} connected`),
		}),
	}),
	FailedConnectProvider: ({ provider, reason }) => ({
		model: withAction(model, provider, CardAction.Idle()),
		outMessage: PageOutMessage.RequestedToast({ toast: channelRequestToast(reason) }),
	}),
	ClickedToggleProvider: ({ provider }) => {
		const webhook = providerWebhook(model, provider)
		return webhook === null || !isResting(model.providers[provider])
			? { model }
			: {
					model: withAction(model, provider, CardAction.Toggling()),
					commands: [
						RunProviderAction({
							provider,
							webhookId: webhook.id,
							channelId: model.channelId,
							isEnabled: !webhook.isEnabled,
						}),
					],
				}
	},
	// First press arms "Confirm?" for 3 s; the second deletes.
	ClickedDeleteProvider: ({ provider }) => {
		const webhook = providerWebhook(model, provider)
		const card = model.providers[provider]
		if (webhook === null) return { model }
		if (card.action._tag === "ConfirmingDelete")
			return {
				model: withAction(model, provider, CardAction.Deleting()),
				commands: [
					RunProviderAction({
						provider,
						webhookId: webhook.id,
						channelId: model.channelId,
						isEnabled: null,
					}),
				],
			}
		if (card.action._tag !== "Idle") return { model }
		const version = card.confirmVersion + 1
		return {
			model: withCard(model, provider, (current) => ({
				...current,
				action: CardAction.ConfirmingDelete(),
				confirmVersion: version,
			})),
			commands: [WaitForConfirmReset({ provider, version })],
		}
	},
	ElapsedConfirmDelay: ({ provider, version }) => ({
		model: withCard(model, provider, (card) =>
			card.action._tag === "ConfirmingDelete" && card.confirmVersion === version
				? { ...card, action: CardAction.Idle() }
				: card,
		),
	}),
	SucceededProviderAction: ({ provider, successMessage }) => ({
		...refetchWebhooks(withAction(model, provider, CardAction.Idle())),
		outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
	}),
	FailedProviderAction: ({ provider, reason }) => ({
		model: withAction(model, provider, CardAction.Idle()),
		outMessage: PageOutMessage.RequestedToast({
			toast: errorToastOf(
				failureMessage(reason, {
					NotFound: {
						title: "Webhook not found",
						description: "This webhook may have been deleted.",
					},
				}),
			),
		}),
	}),
	ClickedProviderUrlInfo: () => ({
		model,
		outMessage: PageOutMessage.RequestedToast({
			toast: infoToast("Delete and reconnect to get a new URL"),
		}),
	}),
	ClickedDismissProviderToken: ({ provider }) => ({
		model: withCard(model, provider, (card) => ({ ...card, createdToken: null })),
	}),
	ClickedExpandCreateForm: () => ({ model: withForm(model, (form) => ({ ...form, isExpanded: true })) }),
	ClickedCancelCreateForm: () => ({ model: withForm(model, (form) => ({ ...form, isExpanded: false })) }),
	ChangedCreateField: ({ field, value }) => ({
		model: withForm(model, (form) =>
			field === "name"
				? { ...form, name: validate(webhookNameRules)(value) }
				: { ...form, [field]: value },
		),
	}),
	SubmittedCreateForm: () => {
		const form = model.createForm
		if (form.isSubmitting) return { model }
		// Submitting an untouched name shows its rule's message instead of sending.
		const name = validate(webhookNameRules)(form.name.value)
		if (!isValid(webhookNameRules)(name))
			return { model: withForm(model, (current) => ({ ...current, name })) }
		return {
			model: withForm(model, (current) => ({ ...current, name, isSubmitting: true })),
			commands: [
				CreateWebhook({
					channelId: model.channelId,
					name: name.value,
					description: form.description,
					avatarUrl: form.avatarUrl,
				}),
			],
		}
	},
	SucceededCreateWebhook: ({ token, webhookUrl }) => ({
		...refetchWebhooks(
			withForm(model, (form) => ({ ...form, isSubmitting: false, created: { token, webhookUrl } })),
		),
		outMessage: PageOutMessage.RequestedToast({ toast: successToast("Webhook created successfully") }),
	}),
	FailedCreateWebhook: ({ reason }) => ({
		model: withForm(model, (form) => ({ ...form, isSubmitting: false })),
		outMessage: PageOutMessage.RequestedToast({ toast: channelRequestToast(reason) }),
	}),
	ClickedToggleTokenVisible: () => ({
		model: withForm(model, (form) => ({ ...form, isTokenVisible: !form.isTokenVisible })),
	}),
	// `setCreatedWebhook(null); setIsExpanded(false); form.reset()`
	ClickedDismissToken: () => ({ model: withForm(model, () => emptyCreateForm) }),
})
