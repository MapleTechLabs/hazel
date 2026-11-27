import type { Html } from "foldkit/html"
import { providerOf } from "../../../../customers/providers"
import { button } from "../../../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../../../ui/dialog"
import * as Modal from "../../../../ui/modal"
import { Message } from "./message"
import { connectFailureMessage, connectionOf, isLive, type Model } from "./model"
import { formField, type H, messageCallout } from "./parts"

/** "Update keys" and the disconnect confirmation (connecting is the native modal). */

const toKeysModal = (message: Modal.Message) => Message.GotKeysModalMessage({ message })
const toDisconnectModal = (message: Modal.Message) => Message.GotDisconnectModalMessage({ message })

// KEYS

export const keysDialog = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.keysModal,
		toParentMessage: toKeysModal,
		size: "md",
		toContent: (closeAttributes) => {
			const form = model.keysForm
			const connection = model.connections?.find((row) => row.id === form?.connectionId)
			if (form === null || connection === undefined) return []
			const descriptor = providerOf(connection.provider)
			const isEmpty = form.apiKey.trim() === "" && form.webhookSecret.trim() === ""
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.keysModal.id), text: `Update ${descriptor.name} keys` },
					description:
						"Paste a new key, a new signing secret, or both. A blank field keeps the current one.",
				}),
				dialogBody(h, [
					h.div(
						[h.Class("flex flex-col gap-4")],
						[
							formField(h, {
								id: "customers-keys-api-key",
								label: descriptor.apiKey.label,
								description: `${descriptor.name} checks a new key before it is stored.`,
								value: form.apiKey,
								placeholder: descriptor.apiKey.placeholder,
								isCode: true,
								isSecret: true,
								isDisabled: form.isPending,
								onInput: (value) => Message.ChangedKeysApiKey({ value }),
							}),
							...(descriptor.webhook === null
								? []
								: [
										formField(h, {
											id: "customers-keys-webhook-secret",
											label: descriptor.webhook.secretLabel,
											description: connection.hasWebhookSecret
												? "One is set."
												: "None is set yet.",
											value: form.webhookSecret,
											placeholder: descriptor.webhook.secretPlaceholder,
											isCode: true,
											isSecret: true,
											isDisabled: form.isPending,
											onInput: (value) => Message.ChangedKeysWebhookSecret({ value }),
										}),
									]),
							...(form.failure === null
								? []
								: [
										messageCallout(h, {
											message: connectFailureMessage(form.failure, connection.provider),
										}),
									]),
						],
					),
				]),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(
						h,
						{
							intent: "primary",
							isPending: form.isPending,
							isDisabled: isEmpty,
							onPress: Message.SubmittedKeys(),
						},
						["Save"],
					),
				]),
			]
		},
	})

// DISCONNECT

export const disconnectDialog = (h: H, model: Model): Html =>
	Modal.controlledModal(h, {
		model: model.disconnectModal,
		toParentMessage: toDisconnectModal,
		role: "alertdialog",
		size: "sm",
		toContent: (closeAttributes) => {
			const connection = model.provider === null ? undefined : connectionOf(model, model.provider)
			if (connection === undefined || !isLive(connection)) return []
			const name = providerOf(connection.provider).name
			return [
				dialogHeader(h, {
					title: { id: Modal.titleId(model.disconnectModal.id), text: `Disconnect ${name}?` },
					description: `Hazel stops syncing and drops the stored keys. Accounts, contacts and history stay, marked stale. Reconnect any time to resume.`,
				}),
				dialogFooter(h, [
					dialogClose(h, closeAttributes, ["Cancel"]),
					button(
						h,
						{
							intent: "danger",
							isPending: model.isDisconnecting,
							onPress: Message.ConfirmedDisconnect({ connectionId: connection.id }),
						},
						["Disconnect"],
					),
				]),
			]
		},
	})
