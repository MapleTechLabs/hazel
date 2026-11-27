// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/settings/chat-sync` (today's `web-foldkit/src/page/settings/chat-sync`): the Slack and
 * Discord connections, the add dialog, the migration wizard, and the email support inboxes.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq, or } from "@tanstack/db"
import { Effect, Layer, Schema } from "effect"
import { liveQuery } from "../../../app/live"
import { type AppToast, ShowToast } from "../../../app/requests"
import { ChatMigration } from "../../../chat/migration/ChatMigration"
import * as Confirm from "../../../components/ConfirmAction"
import { copyOf, errorToast, successToast } from "../../../modals/feedback"
import { ChatSyncBackend } from "../../chat-sync/backend"
import {
	ChatSyncList,
	ChatSyncProvider,
	CommonReason,
	type Connection,
	CreateConnectionFailure,
	DeleteConnectionFailure,
	EmailInbox,
	EmailInboxFailure,
	emailFailureCopy,
	formatSyncedAt,
	HazelChannel,
	isChatSyncProvider,
	isRetryable,
	nameError,
	PROVIDER_ORDER,
	PROVIDERS,
	ResourceFailure,
	resourceFailureCopy,
	STATUS,
	supportAddressError,
	supportAddressOf,
	Workspace,
} from "../../chat-sync/model"

export const ChatSyncPageProps = Schema.Struct({
	organizationId: OrganizationId,
	orgSlug: Schema.String,
})
export type ChatSyncPageProps = typeof ChatSyncPageProps.Type

/** The list: loading, loaded (a refresh keeps it shown), or a first load that failed. */
export const Listing = UiSchema.TaggedEnum({
	Loading: {},
	Loaded: { list: ChatSyncList },
	Failed: { reason: CommonReason },
})
export type Listing = typeof Listing.Type

export const Workspaces = UiSchema.TaggedEnum({
	Loading: {},
	Loaded: { workspaces: Schema.Array(Workspace) },
	Failed: { reason: ResourceFailure },
})
export type Workspaces = typeof Workspaces.Type

/** The add dialog for one provider: its workspaces, the picked one, and Connect. */
export const AddDialog = Schema.Struct({
	provider: ChatSyncProvider,
	workspaces: Workspaces,
	selected: Schema.NullOr(Schema.String),
	submitting: Schema.Boolean,
})
export type AddDialog = typeof AddDialog.Type

/** The inbox dialog: a new inbox's form, an inbox's edit form, or its forwarding setup. */
export const EmailStep = UiSchema.TaggedEnum({
	Create: {},
	Edit: { inbox: EmailInbox },
	Setup: { inbox: EmailInbox, isNew: Schema.Boolean },
})
export type EmailStep = typeof EmailStep.Type

export const EmailForm = Schema.Struct({
	step: EmailStep,
	name: TextField.State,
	supportAddress: TextField.State,
	channelId: Schema.NullOr(ChannelId),
	/** Set by the first Create or Save: the fields show their errors from then on. */
	validated: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type EmailForm = typeof EmailForm.Type

export const Target = Schema.Struct({ id: SyncConnectionId, name: Schema.String })
export type Target = typeof Target.Type

export const ChatSyncPageModel = Schema.Struct({
	listing: Listing,
	channels: Schema.Array(HazelChannel),
	add: Schema.NullOr(AddDialog),
	/** The migration wizard's dialog; a new key mounts a fresh wizard. */
	migrating: Schema.Boolean,
	migrationKey: Schema.Finite,
	email: Schema.NullOr(EmailForm),
	deleteConnection: Confirm.ConfirmState(Target),
	removeInbox: Confirm.ConfirmState(Target),
})
export type ChatSyncPageModel = typeof ChatSyncPageModel.Type

export const ChatSyncPageMessage = UiSchema.TaggedEnum({
	SucceededList: { list: ChatSyncList },
	FailedList: { reason: CommonReason },
	PressedRetryList: {},
	UpdatedChannels: { channels: Schema.Array(HazelChannel) },
	CompletedCheckMigrationReturn: { pending: Schema.Boolean },
	// Connections
	SelectedAddProvider: { id: Schema.String },
	SucceededListWorkspaces: { provider: ChatSyncProvider, workspaces: Schema.Array(Workspace) },
	FailedListWorkspaces: { provider: ChatSyncProvider, reason: ResourceFailure },
	PressedRetryWorkspaces: {},
	PickedWorkspace: { value: Schema.String },
	PressedConnect: {},
	DismissedAdd: {},
	SucceededCreateConnection: {},
	FailedCreateConnection: { reason: CreateConnectionFailure },
	PressedDeleteConnection: { target: Target },
	ConfirmedDeleteConnection: {},
	CancelledDeleteConnection: {},
	SucceededDeleteConnection: {},
	FailedDeleteConnection: { reason: DeleteConnectionFailure },
	// Migration
	PressedImport: {},
	DismissedMigration: {},
	FinishedMigration: {},
	// Email inboxes
	PressedAddInbox: {},
	PressedEditInbox: { inbox: EmailInbox },
	PressedSetupGuide: { inbox: EmailInbox },
	ChangedInboxName: { payload: TextField.ChangePayload },
	ChangedSupportAddress: { payload: TextField.ChangePayload },
	PickedInboxChannel: { value: Schema.String },
	PressedSubmitInbox: {},
	DismissedInbox: {},
	SucceededCreateInbox: { inbox: EmailInbox },
	SucceededUpdateInbox: {},
	FailedSaveInbox: { reason: EmailInboxFailure },
	PressedCopyAddress: { address: Schema.String },
	CompletedCopy: {},
	PressedRemoveInbox: { target: Target },
	ConfirmedRemoveInbox: {},
	CancelledRemoveInbox: {},
	SucceededRemoveInbox: {},
	FailedRemoveInbox: { reason: DeleteConnectionFailure },
})
export type ChatSyncPageMessage = typeof ChatSyncPageMessage.Type

const M = ChatSyncPageMessage

// COMMANDS

const withBackend = <Args, A>(
	run: (backend: ChatSyncBackend["Service"], args: Args) => Effect.Effect<A>,
): Effect.Effect<(args: Args) => Effect.Effect<A>, never, ChatSyncBackend> =>
	Effect.map(Effect.service(ChatSyncBackend), (backend) => (args: Args) => run(backend, args))

export class ListChatSync extends Command.Service<ListChatSync>()("hazel/chat-sync/List", {
	args: { organizationId: OrganizationId },
	success: ChatSyncPageMessage,
}) {
	static readonly layer = this.toLayer(
		withBackend((backend, { organizationId }) =>
			backend.list(organizationId).pipe(
				Effect.match({
					onSuccess: (list) => M.SucceededList({ list }),
					onFailure: (reason) => M.FailedList({ reason }),
				}),
			),
		),
	)
}

export class CheckMigrationReturn extends Command.Service<CheckMigrationReturn>()(
	"hazel/chat-sync/CheckMigrationReturn",
	{ args: {}, success: ChatSyncPageMessage },
) {
	static readonly layer = this.toLayer(
		withBackend((backend) =>
			backend.hasMigrationReturn.pipe(
				Effect.map((pending) => M.CompletedCheckMigrationReturn({ pending })),
			),
		),
	)
}

export class ListWorkspaces extends Command.Service<ListWorkspaces>()("hazel/chat-sync/ListWorkspaces", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider },
	success: ChatSyncPageMessage,
}) {
	static readonly layer = this.toLayer(
		withBackend((backend, { organizationId, provider }) =>
			backend.listWorkspaces(organizationId, provider).pipe(
				Effect.match({
					onSuccess: (workspaces) => M.SucceededListWorkspaces({ provider, workspaces }),
					onFailure: (reason) => M.FailedListWorkspaces({ provider, reason }),
				}),
			),
		),
	)
}

export class CreateConnection extends Command.Service<CreateConnection>()(
	"hazel/chat-sync/CreateConnection",
	{
		args: {
			organizationId: OrganizationId,
			provider: ChatSyncProvider,
			externalWorkspaceId: Schema.String,
			externalWorkspaceName: Schema.String,
		},
		success: ChatSyncPageMessage,
	},
) {
	static readonly layer = this.toLayer(
		withBackend((backend, payload) =>
			backend.createConnection(payload).pipe(
				Effect.match({
					onSuccess: () => M.SucceededCreateConnection(),
					onFailure: (reason) => M.FailedCreateConnection({ reason }),
				}),
			),
		),
	)
}

export class DeleteConnection extends Command.Service<DeleteConnection>()(
	"hazel/chat-sync/DeleteConnection",
	{
		args: { organizationId: OrganizationId, syncConnectionId: SyncConnectionId, inbox: Schema.Boolean },
		success: ChatSyncPageMessage,
	},
) {
	static readonly layer = this.toLayer(
		withBackend((backend, { organizationId, syncConnectionId, inbox }) =>
			backend.deleteConnection(organizationId, syncConnectionId).pipe(
				Effect.match({
					onSuccess: () => (inbox ? M.SucceededRemoveInbox() : M.SucceededDeleteConnection()),
					onFailure: (reason) =>
						inbox ? M.FailedRemoveInbox({ reason }) : M.FailedDeleteConnection({ reason }),
				}),
			),
		),
	)
}

export class CreateEmailInbox extends Command.Service<CreateEmailInbox>()(
	"hazel/chat-sync/CreateEmailInbox",
	{
		args: {
			organizationId: OrganizationId,
			displayName: Schema.String,
			supportAddress: Schema.NullOr(Schema.String),
			hazelChannelId: ChannelId,
		},
		success: ChatSyncPageMessage,
	},
) {
	static readonly layer = this.toLayer(
		withBackend((backend, payload) =>
			backend.createEmailInbox(payload).pipe(
				Effect.match({
					onSuccess: (inbox) => M.SucceededCreateInbox({ inbox }),
					onFailure: (reason) => M.FailedSaveInbox({ reason }),
				}),
			),
		),
	)
}

export class UpdateEmailInbox extends Command.Service<UpdateEmailInbox>()(
	"hazel/chat-sync/UpdateEmailInbox",
	{
		args: {
			organizationId: OrganizationId,
			syncConnectionId: SyncConnectionId,
			displayName: Schema.String,
			supportAddress: Schema.NullOr(Schema.String),
		},
		success: ChatSyncPageMessage,
	},
) {
	static readonly layer = this.toLayer(
		withBackend((backend, payload) =>
			backend.updateEmailInbox(payload).pipe(
				Effect.match({
					onSuccess: () => M.SucceededUpdateInbox(),
					onFailure: (reason) => M.FailedSaveInbox({ reason }),
				}),
			),
		),
	)
}

/** Copies the forwarding address and says how it went. */
export class CopyAddress extends Command.Service<CopyAddress>()("hazel/chat-sync/CopyAddress", {
	args: { address: Schema.String },
	success: ChatSyncPageMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.all([Effect.service(ChatSyncBackend), Effect.service(ShowToast)]),
			([backend, show]) =>
				({ address }) =>
					backend.copy(address).pipe(
						Effect.match({
							onSuccess: () => successToast("Forwarding address copied"),
							onFailure: (): AppToast =>
								errorToast({
									title: "Failed to copy the address",
									description: "Select the address and copy it by hand.",
								}),
						}),
						Effect.flatMap((toast) => show({ toast })),
						Effect.as(M.CompletedCopy()),
					),
		),
	)
}

export const chatSyncPageLayer = Layer.mergeAll(
	ListChatSync.layer,
	CheckMigrationReturn.layer,
	ListWorkspaces.layer,
	CreateConnection.layer,
	DeleteConnection.layer,
	CreateEmailInbox.layer,
	UpdateEmailInbox.layer,
	CopyAddress.layer,
)

// HELPERS

const toastOf = (toast: AppToast) => ShowToast.make({ toast })

/** The workspace Connect creates: the picked Discord server, or Slack's one installed workspace. */
export const chosenWorkspace = (add: AddDialog): Workspace | null => {
	if (add.workspaces._tag !== "Loaded") return null
	const { workspaces } = add.workspaces
	return PROVIDERS[add.provider].picksWorkspace
		? (workspaces.find((workspace) => workspace.id === add.selected) ?? null)
		: (workspaces[0] ?? null)
}

const formOf = (step: EmailStep, name = "", supportAddress = ""): EmailForm => ({
	step,
	name: TextField.set(TextField.empty, name),
	supportAddress: TextField.set(TextField.empty, supportAddress),
	channelId: null,
	validated: false,
	submitting: false,
})

export const isEmailFormValid = (form: EmailForm): boolean =>
	nameError(form.name.text) === null &&
	supportAddressError(form.supportAddress.text) === null &&
	(form.step._tag !== "Create" || form.channelId !== null)

const listOf = (model: ChatSyncPageModel): ChatSyncList | null =>
	model.listing._tag === "Loaded" ? model.listing.list : null

const channelNameOf = (channels: ReadonlyArray<HazelChannel>, id: ChannelId | null): string | null =>
	id === null ? null : (channels.find((channel) => channel.id === id)?.name ?? null)

/** The org's public and private channels, A to Z: the inbox picker and each inbox's channel name. */
const hazelChannels = (organizationId: OrganizationId) =>
	liveQuery<HazelChannel, ChatSyncPageMessage>(
		(data) => (q) =>
			q
				.from({ channel: data.collections.channelCollection })
				.where(({ channel }) => eq(channel.organizationId, organizationId))
				.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
				.select(({ channel }) => ({ id: channel.id, name: channel.name })),
		(rows) =>
			M.UpdatedChannels({
				channels: [...rows]
					.map((row) => ({ id: row.id, name: row.name }))
					.sort((a, b) => a.name.localeCompare(b.name)),
			}),
	)

const ChatSyncPageDef = Hazel.component({
	name: "ChatSyncPage",
	props: ChatSyncPageProps,
	model: ChatSyncPageModel,
	message: ChatSyncPageMessage,
	// After Back, requests that were in flight are not running any more.
	restore: (model) => ({
		...model,
		add: model.add === null ? null : { ...model.add, submitting: false },
		email: model.email === null ? null : { ...model.email, submitting: false },
		deleteConnection: Confirm.failed(model.deleteConnection),
		removeInbox: Confirm.failed(model.removeInbox),
	}),
})

/** Lists again after a change, keeping the shown list meanwhile. */
const reload = <R>(
	step: { readonly run: (command: ReturnType<typeof ListChatSync.make>) => R },
	organizationId: OrganizationId,
): R => step.run(ListChatSync.make({ organizationId }))

/** Create or Save: the fields show their errors until they pass, then the request runs. */
const submitInbox = ChatSyncPageDef.update(($) => {
	const form = $.model.email
	if (form === null || form.submitting || form.step._tag === "Setup") return $.model
	if (!isEmailFormValid(form)) return $.evolve({ email: () => ({ ...form, validated: true }) })
	const submitting = { ...form, validated: true, submitting: true }
	const displayName = form.name.text.trim()
	const supportAddress = supportAddressOf(form.supportAddress.text)
	const { organizationId } = $.props
	if (form.step._tag === "Edit")
		return $.evolve({ email: () => submitting }).run(
			UpdateEmailInbox.make({
				organizationId,
				syncConnectionId: form.step.inbox.id,
				displayName,
				supportAddress,
			}),
		)
	if (form.channelId === null) return $.model
	return $.evolve({ email: () => submitting }).run(
		CreateEmailInbox.make({
			organizationId,
			displayName,
			supportAddress,
			hazelChannelId: form.channelId,
		}),
	)
})

/** Opens the inbox dialog on a form; a running save keeps its own. */
const openInbox = (form: EmailForm) =>
	ChatSyncPageDef.update(($) =>
		$.model.email?.submitting === true ? $.model : $.evolve({ email: () => form }),
	)

export const ChatSyncPageNoDeps = ChatSyncPageDef.make({
	init: ($) =>
		$.set({
			listing: Listing.Loading(),
			channels: [],
			add: null,
			migrating: false,
			migrationKey: 0,
			email: null,
			deleteConnection: Confirm.closed,
			removeInbox: Confirm.closed,
		})
			.run(ListChatSync.make({ organizationId: $.props.organizationId }))
			.run(CheckMigrationReturn.make({})),
	update: {
		SucceededList: ($, { list }) => $.evolve({ listing: () => Listing.Loaded({ list }) }),
		// A failed refresh keeps the shown list and says so; a failed first load replaces the spinner.
		FailedList: ($, { reason }) =>
			$.model.listing._tag === "Loaded"
				? $.run(toastOf(errorToast(copyOf(reason, {}))))
				: $.evolve({ listing: () => Listing.Failed({ reason }) }),
		PressedRetryList: ($) =>
			reload($.evolve({ listing: () => Listing.Loading() }), $.props.organizationId),
		UpdatedChannels: ($, { channels }) => $.evolve({ channels: () => channels }),
		// Back from a provider's OAuth that the wizard started: it opens again and resumes.
		CompletedCheckMigrationReturn: ($, { pending }) =>
			pending ? $.evolve({ migrating: () => true }) : $.model,
		SelectedAddProvider: ($, { id }) => {
			if (!isChatSyncProvider(id)) return $.model
			const add = $.model.add
			if (add !== null && add.provider === id) return $.model
			return $.evolve({
				add: () => ({
					provider: id,
					workspaces: Workspaces.Loading(),
					selected: null,
					submitting: false,
				}),
			}).run(ListWorkspaces.make({ organizationId: $.props.organizationId, provider: id }))
		},
		SucceededListWorkspaces: ($, { provider, workspaces }) =>
			$.model.add?.provider !== provider
				? $.model
				: $.evolve({
						add: (add) => add && { ...add, workspaces: Workspaces.Loaded({ workspaces }) },
					}),
		FailedListWorkspaces: ($, { provider, reason }) =>
			$.model.add?.provider !== provider
				? $.model
				: $.evolve({ add: (add) => add && { ...add, workspaces: Workspaces.Failed({ reason }) } }),
		PressedRetryWorkspaces: ($) => {
			const add = $.model.add
			if (add === null) return $.model
			return $.evolve({ add: () => ({ ...add, workspaces: Workspaces.Loading() }) }).run(
				ListWorkspaces.make({ organizationId: $.props.organizationId, provider: add.provider }),
			)
		},
		PickedWorkspace: ($, { value }) => $.evolve({ add: (add) => add && { ...add, selected: value } }),
		PressedConnect: ($) => {
			const add = $.model.add
			const workspace = add === null ? null : chosenWorkspace(add)
			if (add === null || workspace === null || add.submitting) return $.model
			return $.evolve({ add: () => ({ ...add, submitting: true }) }).run(
				CreateConnection.make({
					organizationId: $.props.organizationId,
					provider: add.provider,
					externalWorkspaceId: workspace.id,
					externalWorkspaceName: workspace.name,
				}),
			)
		},
		DismissedAdd: ($) => ($.model.add?.submitting === true ? $.model : $.evolve({ add: () => null })),
		SucceededCreateConnection: ($) => {
			const name = $.model.add === null ? "Chat" : PROVIDERS[$.model.add.provider].name
			return reload($.evolve({ add: () => null }), $.props.organizationId).run(
				toastOf(successToast(`${name} connection created`)),
			)
		},
		FailedCreateConnection: ($, { reason }) => {
			const add = $.model.add
			if (add === null) return $.model
			const { name, copy } = PROVIDERS[add.provider]
			return $.evolve({ add: () => ({ ...add, submitting: false }) }).run(
				toastOf(
					errorToast(
						copyOf(reason, {
							AlreadyExists: {
								title: "Connection already exists",
								description: copy.alreadyConnected,
							},
							NotConnected: {
								title: `${name} not connected`,
								description: copy.createNotConnected,
							},
						}),
					),
				),
			)
		},
		PressedDeleteConnection: ($, { target }) =>
			$.evolve({ deleteConnection: (state) => Confirm.ask(state, target) }),
		ConfirmedDeleteConnection: ($) => {
			const confirmed = Confirm.confirm($.model.deleteConnection)
			if (confirmed === undefined) return $.model
			const [running, target] = confirmed
			return $.evolve({ deleteConnection: () => running }).run(
				DeleteConnection.make({
					organizationId: $.props.organizationId,
					syncConnectionId: target.id,
					inbox: false,
				}),
			)
		},
		CancelledDeleteConnection: ($) => $.evolve({ deleteConnection: Confirm.cancel }),
		SucceededDeleteConnection: ($) =>
			reload($.evolve({ deleteConnection: () => Confirm.closed }), $.props.organizationId).run(
				toastOf(successToast("Connection deleted")),
			),
		FailedDeleteConnection: ($, { reason }) =>
			$.evolve({ deleteConnection: Confirm.failed }).run(
				toastOf(
					errorToast(
						copyOf(reason, {
							NotFound: {
								title: "Connection not found",
								description: "This connection may have already been deleted.",
							},
						}),
					),
				),
			),
		PressedImport: ($) =>
			$.model.migrating ? $.model : $.evolve({ migrating: () => true, migrationKey: (key) => key + 1 }),
		// Closing it mid-way drops the wizard's progress: the next one mounts fresh.
		DismissedMigration: ($) => $.evolve({ migrating: () => false }),
		FinishedMigration: ($) => reload($.evolve({ migrating: () => false }), $.props.organizationId),
		PressedAddInbox: ($) => $.combine(openInbox(formOf(EmailStep.Create()))),
		PressedEditInbox: ($, { inbox }) =>
			$.combine(
				openInbox(formOf(EmailStep.Edit({ inbox }), inbox.displayName, inbox.supportAddress ?? "")),
			),
		PressedSetupGuide: ($, { inbox }) =>
			$.combine(openInbox(formOf(EmailStep.Setup({ inbox, isNew: false })))),
		ChangedInboxName: ($, { payload }) =>
			$.evolve({ email: (form) => form && { ...form, name: TextField.changed(form.name, payload) } }),
		ChangedSupportAddress: ($, { payload }) =>
			$.evolve({
				email: (form) =>
					form && { ...form, supportAddress: TextField.changed(form.supportAddress, payload) },
			}),
		PickedInboxChannel: ($, { value }) =>
			$.evolve({
				email: (form) => {
					const channel = $.model.channels.find((each) => each.id === value)
					return form && channel !== undefined && !form.submitting
						? { ...form, channelId: channel.id }
						: form
				},
			}),
		PressedSubmitInbox: ($) => $.combine(submitInbox),
		// A running save keeps its form, so its answer lands.
		DismissedInbox: ($) =>
			$.model.email?.submitting === true ? $.model : $.evolve({ email: () => null }),
		// The dialog moves on to the forwarding setup; closed meanwhile, the toast is enough.
		SucceededCreateInbox: ($, { inbox }) =>
			reload(
				$.evolve({
					email: (form) => (form === null ? null : formOf(EmailStep.Setup({ inbox, isNew: true }))),
					listing: (listing) =>
						listing._tag !== "Loaded"
							? listing
							: Listing.Loaded({
									list: {
										...listing.list,
										emailInboxes: [
											...listing.list.emailInboxes.filter(
												(each) => each.id !== inbox.id,
											),
											inbox,
										],
									},
								}),
				}),
				$.props.organizationId,
			).run(toastOf(successToast("Email inbox created"))),
		SucceededUpdateInbox: ($) =>
			reload($.evolve({ email: () => null }), $.props.organizationId).run(
				toastOf(successToast("Inbox updated")),
			),
		FailedSaveInbox: ($, { reason }) =>
			$.evolve({ email: (form) => form && { ...form, submitting: false } }).run(
				toastOf(errorToast(emailFailureCopy(reason))),
			),
		PressedCopyAddress: ($, { address }) => $.run(CopyAddress.make({ address })),
		CompletedCopy: ($) => $.model,
		PressedRemoveInbox: ($, { target }) =>
			$.evolve({ removeInbox: (state) => Confirm.ask(state, target) }),
		ConfirmedRemoveInbox: ($) => {
			const confirmed = Confirm.confirm($.model.removeInbox)
			if (confirmed === undefined) return $.model
			const [running, target] = confirmed
			return $.evolve({ removeInbox: () => running }).run(
				DeleteConnection.make({
					organizationId: $.props.organizationId,
					syncConnectionId: target.id,
					inbox: true,
				}),
			)
		},
		CancelledRemoveInbox: ($) => $.evolve({ removeInbox: Confirm.cancel }),
		SucceededRemoveInbox: ($) => {
			const removed = Confirm.targetOf($.model.removeInbox)
			return reload(
				$.evolve({
					removeInbox: () => Confirm.closed,
					listing: (listing) =>
						listing._tag !== "Loaded" || removed === undefined
							? listing
							: Listing.Loaded({
									list: {
										...listing.list,
										emailInboxes: listing.list.emailInboxes.filter(
											(each) => each.id !== removed.id,
										),
									},
								}),
				}),
				$.props.organizationId,
			).run(toastOf(successToast("Inbox removed")))
		},
		FailedRemoveInbox: ($, { reason }) =>
			$.evolve({ removeInbox: Confirm.failed }).run(
				toastOf(
					errorToast(
						copyOf(reason, {
							NotFound: {
								title: "Inbox not found",
								description: "This inbox may have already been removed.",
							},
						}),
					),
				),
			),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channels", [props.organizationId], ([organizationId]) =>
			hazelChannels(organizationId),
		),
	],
	view: (h, model) => {
		const { orgSlug } = h.props
		const list = listOf(model)
		return h.stack
			.key("chat-sync")
			.density("relaxed")
			.children(
				header(h, list !== null),
				...body(h, model, orgSlug),
				addDialog(h, model.add, orgSlug),
				Confirm.confirmDialog(h, model.deleteConnection, {
					key: "delete-connection",
					title: "Delete connection",
					description: `Are you sure you want to delete the connection to ${Confirm.targetOf(model.deleteConnection)?.name ?? ""}? This will also remove all linked channels. This action cannot be undone.`,
					confirmLabel: "Delete connection",
					runningLabel: "Deleting...",
					confirmed: M.ConfirmedDeleteConnection(),
					cancelled: M.CancelledDeleteConnection(),
				}),
				migrationDialog(h, model, orgSlug),
				emailDialog(h, model),
				Confirm.confirmDialog(h, model.removeInbox, {
					key: "remove-inbox",
					title: "Remove inbox",
					description: `Remove ${Confirm.targetOf(model.removeInbox)?.name ?? ""}? Emails forwarded to its address stop arriving. Its threads stay in the channel.`,
					confirmLabel: "Remove inbox",
					runningLabel: "Removing...",
					confirmed: M.ConfirmedRemoveInbox(),
					cancelled: M.CancelledRemoveInbox(),
				}),
			)
	},
})

/** The page with its Commands, over the host's `ChatSyncBackend`, `ChatMigrationBackend` and `ShowToast`. */
export const ChatSyncPage = ChatSyncPageNoDeps.pipe(Component.provide(chatSyncPageLayer))

// VIEW

type H = Parameters<Parameters<typeof ChatSyncPageDef.make>[0]["view"]>[0]

const addMenu = (h: H, key: string) =>
	h.menu
		.key(key)
		.label("Add third-party connection")
		.entries([
			{
				entries: PROVIDER_ORDER.map((provider) => ({
					id: provider,
					label: PROVIDERS[provider].name,
					icon: PROVIDERS[provider].icon,
				})),
			},
		])
		.trigger(h.button.label("Add third-party connection").icon("plus").trailingIcon("chevron-down"))
		.on("select", ({ id }) => M.SelectedAddProvider({ id }))

// HAZEL-GAP(p4-screen-page-column): today's `pageHeader` is a title-size heading and subtitle with
// its actions in a wrapping row; no primitive draws a page's header in a content column.
const header = (h: H, loaded: boolean) =>
	h.stack
		.key("header")
		.density("regular")
		.children(
			h.stack
				.density("tight")
				.children(
					h.heading.children("Chat sync"),
					h.text
						.role("label")
						.tone("muted")
						.children("Sync messages between Hazel and external platforms."),
				),
			loaded
				? h.stack
						.axis("horizontal")
						.wrap()
						.density("compact")
						.children(
							h.button
								.key("import")
								.label("Import from Slack or Discord")
								.icon("download")
								.variant("outline")
								.on("press", M.PressedImport()),
							addMenu(h, "add"),
						)
				: null,
		)

const body = (h: H, model: ChatSyncPageModel, orgSlug: string) =>
	Listing.match(model.listing, {
		Loading: () => [h.progress.key("loading").style("spinner").label("Loading connections...")],
		Failed: ({ reason }) => {
			const copy = copyOf(reason, {})
			return [
				h.emptyState
					.key("failed")
					.title("Failed to load connections")
					.description(copy.description ?? copy.title)
					.action(
						isRetryable(reason)
							? h.button
									.label("Try again")
									.variant("secondary")
									.on("press", M.PressedRetryList())
							: null,
					),
			]
		},
		Loaded: ({ list }) => [
			list.connections.length === 0
				? h.emptyState
						.key("empty")
						.icon("refresh")
						.title("No sync connections yet")
						.description(
							"Connect an external platform to start syncing messages with Hazel channels.",
						)
						.action(addMenu(h, "add-empty"))
				: // HAZEL-GAP(p4-grid-wide-columns): today's grid is 3 columns from `xl`; `grid` keeps 2.
					h.grid
						.key("connections")
						.columns("2")
						.children(
							...list.connections.map((connection) => connectionCard(h, connection, orgSlug)),
						),
			emailSection(h, list.emailInboxes, model.channels),
		],
	})

const connectionHref = (orgSlug: string, connection: Connection) =>
	`/${orgSlug}/settings/chat-sync/${connection.id}`

/** A connection: the provider mark, the name and status, the ids; Manage and Delete under it. */
const connectionCard = (h: H, connection: Connection, orgSlug: string) => {
	const provider = PROVIDERS[connection.provider]
	const status = STATUS[connection.status]
	// HAZEL-GAP(p4-card-press): today the whole card is the link to the connection, its footer's
	// Manage and delete revealed on hover; a `frame` is not pressable, so Manage is a link.
	// HAZEL-GAP(p4-card-footer-band): today's footer is a muted band with a chevron, not a hairline row.
	return h.frame
		.key(connection.id)
		.surface("tile")
		.footer(
			h.link.label("Manage").tone("muted").href(connectionHref(orgSlug, connection)),
			h.spacer,
			h.button
				.label("Delete connection")
				.icon("trash")
				.iconOnly()
				.variant("ghost")
				.size("small")
				.on(
					"press",
					M.PressedDeleteConnection({
						target: { id: connection.id, name: connection.displayName },
					}),
				),
		)
		.children(
			h.stack.density("regular").children(
				h.stack
					.axis("horizontal")
					.align("center")
					.density("cozy")
					.children(
						// HAZEL-GAP(p4-icon-tile-brand): today's logo is the brand's colour mark on a white, ringed 48pt tile.
						h.iconTile.name(provider.icon),
						h.stack
							.density("tight")
							.children(
								h.heading.level("3").children(connection.displayName),
								h.text.role("caption").dot().tone(status.tone).children(status.label),
							),
					),
				h.stack.density("tight").children(
					h.text
						.role("caption")
						.tone("muted")
						.children(
							`${provider.name} · ${provider.workspaceIdLabel}: ${connection.externalWorkspaceId}`,
						),
					connection.lastSyncedAtMs === null
						? null
						: h.text
								.role("caption")
								.tone("muted")
								.children(`Last synced: ${formatSyncedAt(connection.lastSyncedAtMs)}`),
				),
			),
		)
}

// EMAIL

const inboxRow = (h: H, inbox: EmailInbox, channels: ReadonlyArray<HazelChannel>) => {
	const status = STATUS[inbox.status]
	const channel = channelNameOf(channels, inbox.hazelChannelId) ?? "private channel"
	return h.stack
		.key(inbox.id)
		.density("compact")
		.children(
			h.stack
				.axis("horizontal")
				.align("start")
				.density("cozy")
				.children(
					h.stack.density("tight").children(
						h.stack
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								h.heading.level("3").children(inbox.displayName),
								h.text.role("caption").dot().tone(status.tone).children(status.label),
							),
						// HAZEL-GAP(p4-item-subtitle-icons): today's meta line leads with a hashtag glyph.
						h.text
							.role("caption")
							.tone("muted")
							.truncate()
							.children(
								`# ${channel} · ${
									inbox.supportAddress === null
										? "Replies come from the forwarding address"
										: `Replies to ${inbox.supportAddress}`
								}`,
							),
						inbox.errorMessage === null
							? null
							: h.text.role("caption").tone("danger").children(inbox.errorMessage),
					),
					h.spacer,
					h.stack
						.axis("horizontal")
						.align("center")
						.density("tight")
						.children(
							h.button
								.label("Setup guide")
								.variant("ghost")
								.size("small")
								.on("press", M.PressedSetupGuide({ inbox })),
							h.button
								.label("Edit inbox")
								.icon("edit")
								.iconOnly()
								.variant("ghost")
								.size("small")
								.on("press", M.PressedEditInbox({ inbox })),
							h.button
								.label("Remove inbox")
								.icon("trash")
								.iconOnly()
								.variant("ghost")
								.size("small")
								.on(
									"press",
									M.PressedRemoveInbox({
										target: { id: inbox.id, name: inbox.displayName },
									}),
								),
						),
				),
			forwardingAddress(h, inbox, "Forward your support address to"),
		)
}

/** The address to forward to, read-only with its copy button. */
// HAZEL-GAP(p4-copy-field): today is a mono box with a separate copy button under a 12px caption.
const forwardingAddress = (h: H, inbox: EmailInbox, label: string) =>
	inbox.inboundAddress === null
		? h.text.tone("muted").children("The forwarding address is not ready yet. Check back shortly.")
		: h.textField
				.label(label)
				.value(TextField.set(TextField.empty, inbox.inboundAddress))
				.readOnly()
				.monospace()
				.copyable()
				.on("copy", M.PressedCopyAddress({ address: inbox.inboundAddress }))

/** The Email card: what it does, Add inbox, and each inbox. */
const emailSection = (h: H, inboxes: ReadonlyArray<EmailInbox>, channels: ReadonlyArray<HazelChannel>) =>
	h.frame
		.key("email")
		.surface("flush")
		.children(
			h.stack
				.axis("horizontal")
				.align("start")
				.density("regular")
				.inset("page")
				.children(
					h.iconTile.name("envelope"),
					h.stack
						.density("tight")
						.children(
							h.heading.level("2").children("Email"),
							h.text
								.tone("muted")
								.children(
									"Forward your support address to a Hazel channel. Each email becomes a thread; replies in the thread go back as email.",
								),
						),
					h.spacer,
					h.button
						.label("Add inbox")
						.icon("plus")
						.variant("outline")
						.size("small")
						.on("press", M.PressedAddInbox()),
				),
			h.divider,
			inboxes.length === 0
				? h.stack.inset("page").children(h.text.tone("muted").children("No inboxes yet."))
				: h.stack.density("none").children(
						...inboxes.flatMap((inbox, index) => [
							index === 0 ? null : h.divider.key(`divider-${inbox.id}`),
							h.stack
								.key(`row-${inbox.id}`)
								.inset("page")
								.children(inboxRow(h, inbox, channels)),
						]),
					),
		)

// DIALOGS

const addBody = (h: H, add: AddDialog, orgSlug: string) => {
	const provider = PROVIDERS[add.provider]
	return Workspaces.match(add.workspaces, {
		Loading: () =>
			h.progress.style("spinner").label(`Loading ${provider.name} ${provider.workspacesResource}...`),
		Failed: ({ reason }) => {
			const copy = resourceFailureCopy(add.provider, reason, provider.workspacesResource)
			const action =
				reason === "NotConnected"
					? h.link
							.label(`Open ${provider.name} Integration`)
							.href(`/${orgSlug}/settings/integrations/${provider.integrationId}`)
					: isRetryable(reason)
						? h.button
								.label("Try again")
								.variant("secondary")
								.size("small")
								.on("press", M.PressedRetryWorkspaces())
						: null
			return h.banner
				.tone(reason === "NotConnected" ? "info" : "warning")
				.title(copy.title)
				.description(copy.description ?? "")
				.actions(action)
		},
		Loaded: ({ workspaces }) =>
			provider.picksWorkspace
				? h.select
						.label(provider.workspaceTitle)
						.placeholder("Search servers...")
						.searchable()
						.options(
							workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
						)
						.value(add.selected ?? "")
						.on("change", ({ value }) => M.PickedWorkspace({ value }))
				: h.textField
						.label(provider.workspaceTitle)
						.value(TextField.set(TextField.empty, workspaces[0]?.name ?? ""))
						.readOnly()
						.description(
							`Hazel is installed in this workspace. To sync another one, reconnect ${provider.name} in Integrations.`,
						),
	})
}

const addDialog = (h: H, add: AddDialog | null, orgSlug: string) => {
	const provider = add === null ? null : PROVIDERS[add.provider]
	const canConnect = add !== null && chosenWorkspace(add) !== null && !add.submitting
	return h.dialog
		.key("add-connection")
		.open(add !== null)
		.title(provider === null ? "" : `Connect ${provider.workspaceTitle}`)
		.on("dismiss", M.DismissedAdd())
		.children(add === null ? null : addBody(h, add, orgSlug))
		.actions(
			h.button.key("cancel").label("Cancel").variant("outline").on("press", M.DismissedAdd()),
			h.button
				.key("connect")
				.label(add?.submitting === true ? "Connecting..." : "Connect")
				.loading(add?.submitting === true)
				.disabled(!canConnect)
				.on("press", M.PressedConnect()),
		)
}

const migrationDialog = (h: H, model: ChatSyncPageModel, orgSlug: string) =>
	h.dialog
		.key("chat-migration-dialog")
		.open(model.migrating)
		.on("dismiss", M.DismissedMigration())
		.children(
			model.migrating
				? ChatMigration(h, {
						key: `chat-migration-${model.migrationKey}`,
						props: {
							organizationId: h.props.organizationId,
							returnTo: `/${orgSlug}/settings/chat-sync`,
							canSkip: false,
						},
						onEmit: {
							Finished: () => M.FinishedMigration(),
							Skipped: () => M.DismissedMigration(),
						},
					})
				: null,
		)

const setupSteps = (h: H, title: string, steps: ReadonlyArray<string>) =>
	h.stack.density("compact").children(
		h.heading.level("3").children(title),
		// HAZEL-GAP(p4-ordered-list): today's steps are a numbered list with strong runs inside.
		...steps.map((step, index) => h.text.tone("muted").children(`${index + 1}. ${step}`)),
	)

const setupContent = (h: H, inbox: EmailInbox, channels: ReadonlyArray<HazelChannel>) => {
	const channel = `#${channelNameOf(channels, inbox.hazelChannelId) ?? "the channel"}`
	const support = inbox.supportAddress ?? "your support address"
	return [
		forwardingAddress(h, inbox, "Forwarding address"),
		setupSteps(h, "Google Workspace", [
			"In Gmail, open Settings → See all settings → Forwarding and POP/IMAP.",
			"Choose Add a forwarding address and paste the address above.",
			`Gmail sends a confirmation email. It appears as a thread in ${channel}; open its link to confirm.`,
			"Turn on Forward a copy of incoming mail to the address and save.",
		]),
		setupSteps(h, "Microsoft 365", [
			`In the Exchange admin center, open Mail flow → Rules and add a rule for messages sent to ${support}.`,
			"Set it to redirect (or Bcc) the message to the address above, then save the rule.",
		]),
	]
}

const formContent = (h: H, form: EmailForm, channels: ReadonlyArray<HazelChannel>) => {
	const nameProblem = form.validated ? nameError(form.name.text) : null
	const addressProblem = form.validated ? supportAddressError(form.supportAddress.text) : null
	const channelMissing = form.validated && form.channelId === null
	return [
		h.textField
			.key("name")
			.label("Name")
			.placeholder("Acme Support")
			.required()
			.description("Replies are sent from this name.")
			.error(nameProblem ?? undefined)
			.disabled(form.submitting)
			.value(form.name)
			.on("change", (payload) => M.ChangedInboxName({ payload })),
		h.textField
			.key("support-address")
			.label("Support address (optional)")
			.placeholder("support@acme.com")
			.inputKind("email")
			.description("The address customers write to. Replies carry it as Reply-To.")
			.error(addressProblem ?? undefined)
			.disabled(form.submitting)
			.value(form.supportAddress)
			.on("change", (payload) => M.ChangedSupportAddress({ payload })),
		form.step._tag !== "Create"
			? null
			: h.stack
					.key("channel")
					.density("tight")
					.children(
						h.select
							.label("Channel")
							.placeholder("Search channels...")
							.searchable()
							.disabled(form.submitting)
							.options(
								channels.map((channel) => ({
									value: channel.id,
									label: `# ${channel.name}`,
								})),
							)
							.value(form.channelId ?? "")
							.on("change", ({ value }) => M.PickedInboxChannel({ value })),
						// HAZEL-GAP(p4-select-error): `select` has no description or error; a caption stands in.
						h.text
							.role("caption")
							.tone(channelMissing ? "danger" : "muted")
							.children(
								channelMissing
									? "Pick the channel emails arrive in."
									: "Each email becomes a thread in this channel.",
							),
					),
	]
}

const emailDialog = (h: H, model: ChatSyncPageModel) => {
	const form = model.email
	const step = form?.step ?? null
	const isEdit = step?._tag === "Edit"
	const saving = form?.submitting === true
	const title =
		step === null
			? ""
			: EmailStep.match(step, {
					Create: () => "Add email inbox",
					Edit: () => "Edit inbox",
					Setup: ({ inbox, isNew }) =>
						isNew ? `${inbox.displayName} is ready` : `Set up ${inbox.displayName}`,
				})
	const description =
		step === null
			? ""
			: EmailStep.match(step, {
					Create: () =>
						"Forward your support address to a Hazel channel. Each email becomes a thread; replies in the thread go back as email.",
					Edit: () =>
						"Change the name replies are sent from, or the address they carry as Reply-To.",
					Setup: ({ inbox }) =>
						`Forward ${inbox.supportAddress ?? "your support address"} to the address below. New emails arrive as threads in #${channelNameOf(model.channels, inbox.hazelChannelId) ?? "the channel"}.`,
				})
	return h.dialog
		.key("email-inbox")
		.open(form !== null)
		.title(title)
		.description(description)
		.on("dismiss", M.DismissedInbox())
		.children(
			...(form === null || step === null
				? []
				: step._tag === "Setup"
					? setupContent(h, step.inbox, model.channels)
					: formContent(h, form, model.channels)),
		)
		.actions(
			...(step?._tag === "Setup"
				? [h.button.key("done").label("Done").on("press", M.DismissedInbox())]
				: [
						h.button
							.key("cancel")
							.label("Cancel")
							.variant("outline")
							.on("press", M.DismissedInbox()),
						h.button
							.key("submit")
							.label(
								saving
									? isEdit
										? "Saving..."
										: "Creating..."
									: isEdit
										? "Save"
										: "Create inbox",
							)
							.loading(saving)
							.disabled(saving)
							.on("press", M.PressedSubmitInbox()),
					]),
		)
}
