import { modifyFields } from "foldkit/struct"
import { successToast } from "../../../data/actions"
import type { PageReturn } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { ConnectProvider, CreateWebhook, RunProviderAction, WaitForConfirmReset } from "./command"
import type { Message } from "./message"
import { reload } from "./rows"
import {
	type CreateForm,
	INTEGRATION_CONFIG,
	isNameValid,
	type Model,
	type Provider,
	type ProviderCard,
} from "./model"

/** The IntegrationCard and CreateWebhookForm Messages, folded into the page's `Message.match`. */

type Return = PageReturn<Model, Message>
type Handlers = { readonly [T in Message["_tag"]]: (message: Extract<Message, { _tag: T }>) => Return }

const errorToast = (title: string, description: string | null) =>
	PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } })

const withCard = (model: Model, provider: Provider, f: (card: ProviderCard) => ProviderCard): Model =>
	modifyFields(model, { providers: (providers) => ({ ...providers, [provider]: f(providers[provider]) }) })

const withForm = (model: Model, f: (form: CreateForm) => CreateForm): Model =>
	modifyFields(model, { createForm: f })

/** The webhook the provider card manages (`webhooks.find((w) => w.name === "OpenStatus")`). */
export const providerWebhook = (model: Model, provider: Provider) =>
	model.webhooks.items.find((webhook) => webhook.name === INTEGRATION_CONFIG[provider].name) ?? null

const refetchWebhooks = (model: Model) => reload(model, "webhook")

const emptyForm: CreateForm = {
	isExpanded: false,
	name: "",
	description: "",
	avatarUrl: "",
	isNameDirty: false,
	isSubmitting: false,
	created: null,
	isTokenVisible: false,
}

/** TanStack Form `canSubmit` with the `1<string<101` name rule (validated once the field changed). */
export const canCreate = (form: CreateForm) =>
	!form.isSubmitting && !(form.isNameDirty && !isNameValid(form.name))

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
		model.providers[provider].isCreating
			? { model }
			: {
					model: withCard(model, provider, (card) => ({ ...card, isCreating: true })),
					commands: [ConnectProvider({ channelId: model.channelId, provider })],
				},
	SucceededConnectProvider: ({ provider, token }) => {
		const next = withCard(model, provider, (card) => ({
			...card,
			isCreating: false,
			createdToken: token,
		}))
		return {
			...refetchWebhooks(next),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(`${INTEGRATION_CONFIG[provider].name} connected`),
			}),
		}
	},
	FailedConnectProvider: ({ provider, title, description }) => ({
		model: withCard(model, provider, (card) => ({ ...card, isCreating: false })),
		outMessage: errorToast(title, description),
	}),
	ClickedToggleProvider: ({ provider }) => {
		const webhook = providerWebhook(model, provider)
		return webhook === null || model.providers[provider].isToggling
			? { model }
			: {
					model: withCard(model, provider, (card) => ({ ...card, isToggling: true })),
					commands: [
						RunProviderAction({ provider, webhookId: webhook.id, isEnabled: !webhook.isEnabled }),
					],
				}
	},
	// First press arms "Confirm?" for 3 s; the second deletes.
	ClickedDeleteProvider: ({ provider }) => {
		const webhook = providerWebhook(model, provider)
		const card = model.providers[provider]
		if (webhook === null || card.isDeleting) return { model }
		if (!card.confirmDelete) {
			const version = card.confirmVersion + 1
			return {
				model: withCard(model, provider, (current) => ({
					...current,
					confirmDelete: true,
					confirmVersion: version,
				})),
				commands: [WaitForConfirmReset({ provider, version })],
			}
		}
		return {
			model: withCard(model, provider, (current) => ({ ...current, isDeleting: true })),
			commands: [RunProviderAction({ provider, webhookId: webhook.id, isEnabled: null })],
		}
	},
	ElapsedConfirmDelay: ({ provider, version }) => ({
		model: withCard(model, provider, (card) =>
			card.confirmVersion === version ? { ...card, confirmDelete: false } : card,
		),
	}),
	SucceededProviderAction: ({ provider, successMessage, isDelete }) => {
		const next = withCard(model, provider, (card) =>
			isDelete ? { ...card, isDeleting: false, confirmDelete: false } : { ...card, isToggling: false },
		)
		return {
			...refetchWebhooks(next),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}
	},
	FailedProviderAction: ({ provider, isDelete, title, description }) => ({
		model: withCard(model, provider, (card) =>
			isDelete ? { ...card, isDeleting: false } : { ...card, isToggling: false },
		),
		outMessage: errorToast(title, description),
	}),
	ClickedProviderUrlInfo: () => ({
		model,
		outMessage: PageOutMessage.RequestedToast({
			toast: { intent: "info", title: "Delete and reconnect to get a new URL", description: null },
		}),
	}),
	ClickedDismissProviderToken: ({ provider }) => ({
		model: withCard(model, provider, (card) => ({ ...card, createdToken: null })),
	}),
	ClickedExpandCreateForm: () => ({ model: withForm(model, (form) => ({ ...form, isExpanded: true })) }),
	ClickedCancelCreateForm: () => ({ model: withForm(model, (form) => ({ ...form, isExpanded: false })) }),
	ChangedCreateField: ({ field, value }) => ({
		model: withForm(model, (form) => ({
			...form,
			[field]: value,
			isNameDirty: form.isNameDirty || field === "name",
		})),
	}),
	SubmittedCreateForm: () => {
		const form = model.createForm
		if (!canCreate(form) || !isNameValid(form.name)) return { model }
		return {
			model: withForm(model, (current) => ({ ...current, isSubmitting: true })),
			commands: [
				CreateWebhook({
					channelId: model.channelId,
					name: form.name,
					description: form.description,
					avatarUrl: form.avatarUrl,
				}),
			],
		}
	},
	SucceededCreateWebhook: ({ token, webhookUrl }) => {
		const next = withForm(model, (form) => ({
			...form,
			isSubmitting: false,
			created: { token, webhookUrl },
		}))
		return {
			...refetchWebhooks(next),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Webhook created successfully"),
			}),
		}
	},
	FailedCreateWebhook: ({ title, description }) => ({
		model: withForm(model, (form) => ({ ...form, isSubmitting: false })),
		outMessage: errorToast(title, description),
	}),
	ClickedToggleTokenVisible: () => ({
		model: withForm(model, (form) => ({ ...form, isTokenVisible: !form.isTokenVisible })),
	}),
	// `setCreatedWebhook(null); setIsExpanded(false); form.reset()`
	ClickedDismissToken: () => ({ model: withForm(model, () => emptyForm) }),
})
