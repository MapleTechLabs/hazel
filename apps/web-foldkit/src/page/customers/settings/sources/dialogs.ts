import type { OrganizationId } from "@hazel/schema"
import type { ChildAttribute, Html } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { providerOf, webhookUrlOf } from "../../../../customers/providers"
import { sourceMark } from "../../../../customers/ui/identity"
import { IconCheck, IconExternalLink } from "../../../../icons"
import { button } from "../../../../ui/button"
import {
	dialogBody,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../../../ui/dialog"
import * as Modal from "../../../../ui/modal"
import { Message } from "./message"
import { connectFailureMessage, type ConnectForm, connectionOf, isLive, type Model } from "./model"
import { BACKEND_URL, callout, codeChips, formField, type H, webhookUrlField } from "./parts"
import { configFieldView } from "./settings-view"

/**
 * The connect modal (Wonder `fip`, `jpg`), "Update keys" and the disconnect confirmation.
 *
 * Connecting is one call (`customers.connection.connect`: validate with the provider, store the key,
 * start the backfill), so "Test and connect" is the only test. The webhook endpoint carries the new
 * connection's id, so its step follows a successful connect.
 */

const toConnectModal = (message: Modal.Message) => Message.GotConnectModalMessage({ message })
const toKeysModal = (message: Modal.Message) => Message.GotKeysModalMessage({ message })
const toDisconnectModal = (message: Modal.Message) => Message.GotDisconnectModalMessage({ message })

const step = (h: H, index: number, isDone: boolean, title: string, children: ReadonlyArray<Html>): Html =>
	h.section(
		[h.Class("flex gap-3")],
		[
			h.span(
				[
					h.AriaHidden(true),
					h.Class(
						twMerge(
							"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-medium text-muted-fg text-xs",
							isDone && "border-transparent bg-success-subtle text-success-subtle-fg",
						),
					),
				],
				[isDone ? IconCheck(h, { className: "size-3" }) : String(index)],
			),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-2")],
				[h.h3([h.Class("font-medium text-fg text-sm")], [title]), ...children],
			),
		],
	)

const permissionsList = (h: H, form: ConnectForm): ReadonlyArray<Html> => {
	const { permissions } = providerOf(form.provider)
	return permissions.length === 0
		? []
		: [
				h.ul(
					[h.AriaLabel("Required permissions"), h.Class("flex flex-wrap gap-x-3 gap-y-1")],
					permissions.map((permission) =>
						h.li(
							[h.Class("flex items-center gap-1 text-sm")],
							[
								IconCheck(h, { className: "size-3.5 text-success" }),
								h.span([h.Class("font-medium text-fg")], [permission.resource]),
								h.span([h.Class("text-muted-fg")], [permission.access]),
							],
						),
					),
				),
			]
}

const keyStep = (h: H, form: ConnectForm): Html => {
	const descriptor = providerOf(form.provider)
	return step(h, 1, form.connected !== null, descriptor.apiKey.label, [
		h.div(
			[h.Class("flex items-center justify-between gap-3")],
			[
				h.p([h.Class("text-muted-fg text-xs")], [descriptor.apiKey.help]),
				h.a(
					[
						h.Href(descriptor.apiKey.createHref),
						h.Target("_blank"),
						h.Rel("noreferrer"),
						h.Class(
							"inline-flex shrink-0 items-center gap-1 font-medium text-primary text-xs hover:underline",
						),
					],
					[`Create key in ${descriptor.name}`, IconExternalLink(h, { className: "size-3" })],
				),
			],
		),
		...(form.connected === null
			? [
					formField(h, {
						id: "customers-connect-api-key",
						label: descriptor.apiKey.label,
						value: form.apiKey,
						placeholder: descriptor.apiKey.placeholder,
						isCode: true,
						isSecret: true,
						isDisabled: form.isPending,
						onInput: (value) => Message.ChangedApiKey({ value }),
						className: "[&>[data-slot=label]]:sr-only",
					}),
				]
			: []),
		...permissionsList(h, form),
	])
}

const webhookStep = (
	h: H,
	form: ConnectForm,
	organizationId: OrganizationId | null,
	index: number,
): Html | null => {
	const descriptor = providerOf(form.provider)
	const webhook = descriptor.webhook
	if (webhook === null) return null
	const connected = form.connected
	return step(h, index, false, "Webhook endpoint", [
		...(connected === null || organizationId === null
			? [
					h.p(
						[h.Class("text-muted-fg text-xs")],
						["The endpoint URL appears once the key works: it carries the new connection's id."],
					),
				]
			: [
					h.p([h.Class("text-muted-fg text-xs")], [webhook.instructions]),
					webhookUrlField(
						h,
						webhookUrlOf(BACKEND_URL, form.provider, organizationId, connected.connectionId),
					),
					h.div(
						[h.Class("flex flex-wrap items-center gap-2")],
						[
							h.span([h.Class("text-muted-fg text-xs")], ["Events to send"]),
							codeChips(h, webhook.events),
						],
					),
					formField(h, {
						id: "customers-connect-webhook-secret",
						label: webhook.secretLabel,
						description:
							"Optional now: without it Hazel can't verify webhooks and relies on the hourly sync.",
						value: form.webhookSecret,
						placeholder: webhook.secretPlaceholder,
						isCode: true,
						isSecret: true,
						isDisabled: form.isPending,
						onInput: (value) => Message.ChangedWebhookSecret({ value }),
					}),
				]),
	])
}

const matchingStep = (h: H, form: ConnectForm, index: number): Html | null => {
	const { configFields, name } = providerOf(form.provider)
	return configFields.length === 0
		? null
		: step(h, index, form.connected !== null, `Match ${name} records to accounts`, [
				h.div(
					[h.Class("flex flex-col gap-3 rounded-lg border border-border p-3")],
					configFields.map((field) =>
						configFieldView(h, {
							field,
							config: form.config,
							target: "connect",
							isDisabled: form.isPending || form.connected !== null,
						}),
					),
				),
			])
}

const connectContent = (
	h: H,
	model: Model,
	form: ConnectForm,
	organizationId: OrganizationId | null,
	closeAttributes: ReadonlyArray<ChildAttribute>,
): ReadonlyArray<Html> => {
	const descriptor = providerOf(form.provider)
	const hasWebhook = descriptor.webhook !== null
	const verb = form.reconnectId === null ? "Connect" : "Reconnect"
	const steps = [
		keyStep(h, form),
		matchingStep(h, form, 2),
		webhookStep(h, form, organizationId, descriptor.configFields.length === 0 ? 2 : 3),
	].filter((part): part is Html => part !== null)
	const failure =
		form.failure === null
			? []
			: [
					callout(h, {
						message: connectFailureMessage(form.failure, form.provider),
						tone: form.failure === "ComingSoon" ? "info" : "danger",
					}),
				]
	const connected = form.connected
	return [
		dialogHeader(h, {}, [
			h.div(
				[h.Class("flex items-start gap-3")],
				[
					sourceMark(h, form.provider, { size: "md" }),
					h.div(
						[h.Class("flex min-w-0 flex-col gap-1")],
						[
							dialogTitle(
								h,
								{ id: Modal.titleId(model.connectModal.id) },
								`${verb} ${descriptor.name}`,
							),
							dialogDescription(h, descriptor.accessNote),
						],
					),
				],
			),
		]),
		dialogBody(h, [
			h.div(
				[h.Class("flex flex-col gap-5")],
				[
					...steps,
					...(connected === null
						? []
						: [
								callout(h, {
									tone: "success",
									message: {
										title: "Connection works",
										description: `${connected.accountName === null ? "Connected" : `Connected to ${connected.accountName}`}. The backfill started; records appear as they sync.`,
									},
								}),
							]),
					...failure,
				],
			),
		]),
		dialogFooter(
			h,
			connected === null
				? [
						h.span(
							[h.Class("mr-auto text-muted-fg text-xs")],
							[
								form.reconnectId === null
									? "Connecting starts the backfill."
									: "The new key takes over at once.",
							],
						),
						dialogClose(h, closeAttributes, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isPending: form.isPending,
								isDisabled: form.apiKey.trim() === "",
								onPress: Message.SubmittedConnect(),
							},
							[form.failure === null ? "Test and connect" : "Test again"],
						),
					]
				: [
						button(
							h,
							{
								intent: "primary",
								isPending: form.isPending,
								onPress: Message.SubmittedWebhookSecret(),
							},
							[
								hasWebhook && form.webhookSecret.trim() !== ""
									? "Save secret and finish"
									: "Done",
							],
						),
					],
		),
	]
}

export const connectDialog = (h: H, model: Model, organizationId: OrganizationId | null): Html =>
	Modal.controlledModal(h, {
		model: model.connectModal,
		toParentMessage: toConnectModal,
		size: "xl",
		toContent: (closeAttributes) =>
			model.connectForm === null
				? []
				: connectContent(h, model, model.connectForm, organizationId, closeAttributes),
	})

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
										callout(h, {
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
