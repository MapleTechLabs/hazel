// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Connect (or reconnect) a data source (today's `web-foldkit/.../settings/sources/dialogs.ts`
 * connect modal): the key and the matching options, then, once connected, the webhook step.
 * Connecting is one call (validate with the provider, store the key, start the backfill), so
 * "Test and connect" is the only test. The webhook URL carries the new connection's id.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import { type ConfigField, IntegrationConfig } from "@hazel/customer-integrations"
import type { CustomerConnectionCredentialsError } from "@hazel/domain/rpc"
import { CustomerProvider } from "@hazel/domain/customers"
import { CustomerConnectionId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Redacted, Schema } from "effect"
import { Session } from "../../../app/session"
import { errorToast, ModalEvents, reasonOf, successToast, toast } from "../../../modals/feedback"
import { modalServices } from "../../../modals/services"
import { providerOf, webhookUrlOf } from "../../data/providers"
import { sourceMark } from "../../ui/identity"
import { configFlag, configText, withConfigField } from "./config"
import { ConnectFailure, connectFailureMessage } from "./status"

export const ConnectSourceProps = Schema.Struct({
	session: Session,
	provider: CustomerProvider,
	/** Rotating the key of this connection; null: a new connection. */
	reconnectId: Schema.NullOr(CustomerConnectionId),
	/** The connection's config (or the provider's defaults), which the matching step edits. */
	config: IntegrationConfig,
	/** The API's origin: the webhook endpoint lives there. */
	backendUrl: Schema.String,
})
export type ConnectSourceProps = typeof ConnectSourceProps.Type

const Connected = Schema.Struct({
	connectionId: CustomerConnectionId,
	accountName: Schema.NullOr(Schema.String),
})

export const ConnectSourceModel = Schema.Struct({
	apiKey: TextField.State,
	/** Null until edited: the props' config shows. */
	config: Schema.NullOr(IntegrationConfig),
	/** The connection the key opened: the webhook URL needs its id. */
	connected: Schema.NullOr(Connected),
	webhookSecret: TextField.State,
	/** The connect (or, once connected, the secret's save) in flight, and how the last one failed. */
	isPending: Schema.Boolean,
	failure: Schema.NullOr(ConnectFailure),
})
export type ConnectSourceModel = typeof ConnectSourceModel.Type

export const ConnectSourceMessage = UiSchema.TaggedEnum({
	ChangedApiKey: { payload: TextField.ChangePayload },
	ToggledField: { key: Schema.String, checked: Schema.Boolean },
	ChangedFieldText: { key: Schema.String, payload: TextField.ChangePayload },
	PickedFieldOption: { key: Schema.String, selected: Schema.Array(Schema.String) },
	PressedConnect: {},
	SucceededConnect: { connected: Connected },
	FailedConnect: { reason: ConnectFailure },
	ChangedWebhookSecret: { payload: TextField.ChangePayload },
	PressedFinish: {},
	SucceededSaveSecret: {},
	FailedSaveSecret: { reason: ConnectFailure },
	PressedCopyUrl: { url: Schema.String },
	SettledCopy: {},
	PressedCancel: {},
	DismissedDialog: {},
})
export type ConnectSourceMessage = typeof ConnectSourceMessage.Type

// COMMANDS

/** A key or signing secret: Redacted, so Command spans show `<redacted>`. */
const Secret = Schema.Redacted(Schema.String)

/** A refused key is the user's to fix; a provider that could not be reached is worth a retry. */
const credentialsFailure = (error: CustomerConnectionCredentialsError): ConnectFailure =>
	error.retryable ? "Unreachable" : "Refused"

/** The common reasons, for whatever a connect or update names no case of its own. */
const common = (failed: (reason: ConnectFailure) => ConnectSourceMessage) =>
	// BOUNDARY: everything else reads as its common reason.
	Effect.catchCause((cause) => Effect.succeed(failed(reasonOf(cause))))

/** Validates the key, stores it and starts the backfill; with `reconnectId` it rotates that key. */
export class ConnectSource extends Command.Service<ConnectSource>()("hazel/customers/ConnectSource", {
	args: {
		organizationId: OrganizationId,
		provider: CustomerProvider,
		reconnectId: Schema.NullOr(CustomerConnectionId),
		apiKey: Secret,
		config: IntegrationConfig,
	},
	success: ConnectSourceMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ organizationId, provider, reconnectId, apiKey, config }) => {
					const failed = (reason: ConnectFailure) => ConnectSourceMessage.FailedConnect({ reason })
					const connected = (data: {
						readonly id: CustomerConnectionId
						readonly externalAccountName: string | null
					}) =>
						ConnectSourceMessage.SucceededConnect({
							connected: { connectionId: data.id, accountName: data.externalAccountName },
						})
					const key = Redacted.value(apiKey)
					const own = {
						CustomerProviderUnavailableError: () => Effect.succeed(failed("ComingSoon")),
						CustomerConnectionCredentialsError: (error: CustomerConnectionCredentialsError) =>
							Effect.succeed(failed(credentialsFailure(error))),
						CustomersInvalidRequestError: () => Effect.succeed(failed("Invalid")),
					}
					const request = Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
						reconnectId === null
							? rpc("customers.connection.connect", {
									organizationId,
									provider,
									apiKey: key,
									webhookSecret: null,
									config,
								}).pipe(
									Effect.map(({ data }) => connected(data)),
									Effect.catchTags(own),
								)
							: rpc("customers.connection.update", {
									organizationId,
									connectionId: reconnectId,
									apiKey: key,
									config,
								}).pipe(
									Effect.map(({ data }) => connected(data)),
									Effect.catchTags({
										...own,
										CustomersNotFoundError: () => Effect.succeed(failed("NotFound")),
									}),
								),
					)
					return run(request.pipe(common(failed)))
				},
		),
	)
}

/** The last step: the webhook's signing secret, once the endpoint exists. */
export class SaveWebhookSecret extends Command.Service<SaveWebhookSecret>()(
	"hazel/customers/SaveWebhookSecret",
	{
		args: { organizationId: OrganizationId, connectionId: CustomerConnectionId, webhookSecret: Secret },
		success: ConnectSourceMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ run }) => ({ organizationId, connectionId, webhookSecret }) => {
			const failed = (reason: ConnectFailure) => ConnectSourceMessage.FailedSaveSecret({ reason })
			return run(
				Effect.flatMap(Effect.service(HazelRpc), (rpc) =>
					rpc("customers.connection.update", {
						organizationId,
						connectionId,
						webhookSecret: Redacted.value(webhookSecret),
					}),
				).pipe(
					Effect.andThen(toast(successToast("Signing secret saved"))),
					Effect.as(ConnectSourceMessage.SucceededSaveSecret()),
					Effect.catchTags({
						CustomersNotFoundError: () => Effect.succeed(failed("NotFound")),
						CustomersInvalidRequestError: () => Effect.succeed(failed("Invalid")),
						CustomerProviderUnavailableError: () => Effect.succeed(failed("ComingSoon")),
						CustomerConnectionCredentialsError: (error) =>
							Effect.succeed(failed(credentialsFailure(error))),
					}),
					common(failed),
				),
			)
		}),
	)
}

export class CopyWebhookUrl extends Command.Service<CopyWebhookUrl>()("hazel/customers/CopyWebhookUrl", {
	args: { url: Schema.String },
	success: ConnectSourceMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const clipboard = yield* Clipboard
			const { run } = yield* modalServices
			return ({ url }) =>
				run(
					clipboard.write(url).pipe(
						Effect.matchEffect({
							onSuccess: () => toast(successToast("Webhook URL copied")),
							onFailure: () =>
								toast(
									errorToast({
										title: "Couldn't copy the URL",
										description: "Select it and copy it by hand.",
									}),
								),
						}),
						Effect.as(ConnectSourceMessage.SettledCopy()),
					),
				)
		}),
	)
}

// VIEW

const ConnectSourceDef = Hazel.component({
	name: "ConnectSourceModal",
	props: ConnectSourceProps,
	model: ConnectSourceModel,
	message: ConnectSourceMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, isPending: false }),
})

type H = Parameters<Parameters<typeof ConnectSourceDef.make>[0]["view"]>[0]

const configOf = (h: H, model: ConnectSourceModel): IntegrationConfig => model.config ?? h.props.config

/** A numbered step: its title over its content. */
const step = (h: H, index: number, isDone: boolean, title: string, ...children: ReadonlyArray<unknown>) =>
	// HAZEL-GAP(p4-numbered-step): today a 20pt ringed number (a check once done) leads each step.
	h.stack
		.key(`step:${index}`)
		.axis("horizontal")
		.density("cozy")
		.align("start")
		.children(
			h.badge
				.pill()
				.tone(isDone ? "success" : "neutral")
				.style(isDone ? "solid" : "outline")
				.label(String(index)),
			h.stack
				.density("compact")
				.children(h.heading.level("3").children(title), ...(children as Array<never>)),
		)

const permissions = (h: H) => {
	const { permissions: list } = providerOf(h.props.provider)
	return list.length === 0
		? null
		: h.stack
				.axis("horizontal")
				.density("cozy")
				.wrap()
				.children(
					...list.map((permission) =>
						h.stack
							.axis("horizontal")
							.density("tight")
							.align("center")
							.children(
								h.icon.name("check"),
								h.text.role("label").strong().children(permission.resource),
								h.text.role("label").tone("muted").children(permission.access),
							),
					),
				)
}

const keyStep = (h: H, model: ConnectSourceModel) => {
	const descriptor = providerOf(h.props.provider)
	return step(
		h,
		1,
		model.connected !== null,
		descriptor.apiKey.label,
		h.stack
			.density("snug")
			.align("start")
			.children(
				h.text.role("caption").tone("muted").children(descriptor.apiKey.help),
				h.link.label(`Create key in ${descriptor.name}`).href(descriptor.apiKey.createHref),
			),
		model.connected === null
			? // HAZEL-GAP(p4-field-label-hidden): today the field's label is for screen readers only.
				h.textField
					.label(descriptor.apiKey.label)
					.placeholder(descriptor.apiKey.placeholder)
					.value(model.apiKey)
					.secret()
					.monospace()
					.disabled(model.isPending)
					.on("change", (payload) => ConnectSourceMessage.ChangedApiKey({ payload }))
			: null,
		permissions(h),
	)
}

const configField = (h: H, field: ConfigField, config: IntegrationConfig, disabled: boolean) =>
	Match.value(field).pipe(
		Match.tag("Toggle", (field) =>
			h.toggle
				.key(field.key)
				.label(field.label)
				.description(field.description)
				.checked(configFlag(config, field.key))
				.disabled(disabled)
				.on("change", ({ checked }) =>
					ConnectSourceMessage.ToggledField({ key: field.key, checked }),
				),
		),
		Match.tag("Select", (field) =>
			h.choiceGroup
				.key(field.key)
				.label(field.label)
				.description(field.description)
				.style("segmented")
				.options(field.options.map((option) => ({ value: option.value, label: option.label })))
				.selected([configText(config, field.key)])
				.disabled(disabled)
				.on("change", ({ selected }) =>
					ConnectSourceMessage.PickedFieldOption({ key: field.key, selected }),
				),
		),
		Match.tag("Text", (field) =>
			h.textField
				.key(field.key)
				.label(field.label)
				.description(field.description)
				.placeholder(field.placeholder)
				.value(TextField.set(TextField.empty, configText(config, field.key)))
				.monospace(field.isCode)
				.disabled(disabled)
				.on("change", (payload) =>
					ConnectSourceMessage.ChangedFieldText({ key: field.key, payload }),
				),
		),
		Match.exhaustive,
	)

const matchingStep = (h: H, model: ConnectSourceModel) => {
	const { configFields, name } = providerOf(h.props.provider)
	const config = configOf(h, model)
	const disabled = model.isPending || model.connected !== null
	return configFields.length === 0
		? null
		: step(
				h,
				2,
				model.connected !== null,
				`Match ${name} records to accounts`,
				h.frame.children(
					h.stack
						.density("cozy")
						.children(...configFields.map((field) => configField(h, field, config, disabled))),
				),
			)
}

const webhookStep = (h: H, model: ConnectSourceModel) => {
	const descriptor = providerOf(h.props.provider)
	const webhook = descriptor.webhook
	if (webhook === null) return null
	const index = descriptor.configFields.length === 0 ? 2 : 3
	const organization = h.props.session.organization
	const connected = model.connected
	if (connected === null || organization === null)
		return step(
			h,
			index,
			false,
			"Webhook endpoint",
			h.text
				.role("caption")
				.tone("muted")
				.children("The endpoint URL appears once the key works: it carries the new connection's id."),
		)
	const url = webhookUrlOf(h.props.backendUrl, h.props.provider, organization.id, connected.connectionId)
	return step(
		h,
		index,
		false,
		"Webhook endpoint",
		h.text.role("caption").tone("muted").children(webhook.instructions),
		// HAZEL-GAP(p4-code-field): today the URL is a monospace code box with a labelled Copy button.
		h.textField
			.label("Webhook URL")
			.value(TextField.set(TextField.empty, url))
			.readOnly()
			.monospace()
			.copyable()
			.on("copy", ConnectSourceMessage.PressedCopyUrl({ url })),
		h.stack
			.axis("horizontal")
			.density("snug")
			.align("center")
			.wrap()
			.children(
				h.text.role("caption").tone("muted").children("Events to send"),
				// HAZEL-GAP(p4-badge-code): today each event is a monospace chip.
				...webhook.events.map((event) => h.badge.style("quiet").label(event)),
			),
		h.textField
			.label(webhook.secretLabel)
			.description(
				"Optional now: without it Hazel can't verify webhooks and relies on the hourly sync.",
			)
			.placeholder(webhook.secretPlaceholder)
			.value(model.webhookSecret)
			.secret()
			.monospace()
			.disabled(model.isPending)
			.on("change", (payload) => ConnectSourceMessage.ChangedWebhookSecret({ payload })),
	)
}

const close = ModalEvents.RequestedClose()

/** Closing waits while a request runs: its answer would be lost, or a second one start. */
const closeUnlessPending = ConnectSourceDef.update(($) => ($.model.isPending ? $.model : $.emit(close)))

const connectNow = ConnectSourceDef.update(($) => {
	const organization = $.props.session.organization
	const apiKey = $.model.apiKey.text.trim()
	if (organization === null || $.model.isPending || apiKey === "") return $.model
	return $.evolve({ isPending: () => true, failure: () => null }).run(
		ConnectSource.make({
			organizationId: organization.id,
			provider: $.props.provider,
			reconnectId: $.props.reconnectId,
			apiKey: Redacted.make(apiKey),
			config: $.model.config ?? $.props.config,
		}),
	)
})

/** Done: saves the signing secret first when one was pasted. */
const finish = ConnectSourceDef.update(($) => {
	const organization = $.props.session.organization
	const connected = $.model.connected
	if (organization === null || connected === null || $.model.isPending) return $.model
	const secret = $.model.webhookSecret.text.trim()
	if (secret === "") return $.emit(close)
	return $.evolve({ isPending: () => true, failure: () => null }).run(
		SaveWebhookSecret.make({
			organizationId: organization.id,
			connectionId: connected.connectionId,
			webhookSecret: Redacted.make(secret),
		}),
	)
})

const editConfig = (key: string, value: string | boolean) =>
	ConnectSourceDef.update(($) =>
		$.evolve({
			config: () => withConfigField($.model.config ?? $.props.config, key, value),
			failure: () => null,
		}),
	)

export const ConnectSourceModalNoDeps = ConnectSourceDef.make({
	init: () => ({
		apiKey: TextField.empty,
		config: null,
		connected: null,
		webhookSecret: TextField.empty,
		isPending: false,
		failure: null,
	}),
	update: {
		ChangedApiKey: ($, { payload }) =>
			$.evolve({ apiKey: (state) => TextField.changed(state, payload), failure: () => null }),
		ToggledField: ($, { key, checked }) => $.combine(editConfig(key, checked)),
		ChangedFieldText: ($, { key, payload }) => $.combine(editConfig(key, payload.value)),
		PickedFieldOption: ($, { key, selected }) =>
			selected[0] === undefined ? $.model : $.combine(editConfig(key, selected[0])),
		PressedConnect: ($) => $.combine(connectNow),
		SucceededConnect: ($, { connected }) =>
			$.evolve({ apiKey: () => TextField.empty, isPending: () => false, connected: () => connected }),
		FailedConnect: ($, { reason }) => $.evolve({ isPending: () => false, failure: () => reason }),
		ChangedWebhookSecret: ($, { payload }) =>
			$.evolve({ webhookSecret: (state) => TextField.changed(state, payload), failure: () => null }),
		PressedFinish: ($) => $.combine(finish),
		SucceededSaveSecret: ($) => $.emit(close),
		FailedSaveSecret: ($, { reason }) => $.evolve({ isPending: () => false, failure: () => reason }),
		PressedCopyUrl: ($, { url }) => $.run(CopyWebhookUrl.make({ url })),
		SettledCopy: ($) => $.model,
		PressedCancel: ($) => $.combine(closeUnlessPending),
		DismissedDialog: ($) => $.combine(closeUnlessPending),
	},
	view: (h: H, model) => {
		const { provider, reconnectId } = h.props
		const descriptor = providerOf(provider)
		const connected = model.connected
		const hasWebhook = descriptor.webhook !== null
		const failure = model.failure
		return (
			h.dialog
				.open(true)
				// HAZEL-GAP(p4-dialog-leading): today the source's mark sits beside the title, the panel is `xl`.
				.title(`${reconnectId === null ? "Connect" : "Reconnect"} ${descriptor.name}`)
				.description(descriptor.accessNote)
				.on("dismiss", ConnectSourceMessage.DismissedDialog())
				.children(
					h.stack.density("loose").children(
						sourceMark(h, provider, { size: "md" }),
						keyStep(h, model),
						matchingStep(h, model),
						webhookStep(h, model),
						connected === null
							? null
							: h.banner
									.tone("success")
									.title("Connection works")
									.description(
										`${connected.accountName === null ? "Connected" : `Connected to ${connected.accountName}`}. The backfill started; records appear as they sync.`,
									),
						failure === null
							? null
							: h.banner
									.tone(failure === "ComingSoon" ? "info" : "danger")
									.title(connectFailureMessage(failure, provider).title)
									.description(connectFailureMessage(failure, provider).description ?? ""),
						connected === null
							? // HAZEL-GAP(p4-dialog-footer-note): today this note sits at the footer's start.
								h.text
									.role("caption")
									.tone("muted")
									.children(
										reconnectId === null
											? "Connecting starts the backfill."
											: "The new key takes over at once.",
									)
							: null,
					),
				)
				.actions(
					...(connected === null
						? [
								h.button
									.label("Cancel")
									.variant("outline")
									.on("press", ConnectSourceMessage.PressedCancel()),
								h.button
									.label(failure === null ? "Test and connect" : "Test again")
									.loading(model.isPending)
									.disabled(model.apiKey.text.trim() === "")
									.on("press", ConnectSourceMessage.PressedConnect()),
							]
						: [
								h.button
									.label(
										hasWebhook && model.webhookSecret.text.trim() !== ""
											? "Save secret and finish"
											: "Done",
									)
									.loading(model.isPending)
									.on("press", ConnectSourceMessage.PressedFinish()),
							]),
				)
		)
	},
})

/** The modal with its Commands, on the app's RPC client, clipboard and requests. */
export const ConnectSourceModal = ConnectSourceModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(ConnectSource.layer, SaveWebhookSecret.layer, CopyWebhookUrl.layer)),
)
