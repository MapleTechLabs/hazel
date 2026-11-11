import { ChannelId, OrganizationId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import * as Modal from "../../../ui/modal"
import { PageOutMessage } from "../../out-message"

/** Port of `components/connect/share-channel-modal.tsx`. */

// MODEL

export const Workspace = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type Workspace = typeof Workspace.Type

/** The workspace search: `Idle` below two characters or once a workspace is picked. */
export const SearchResults = AsyncData.Schema(Schema.Array(Workspace), CommonReason)

/** What can go wrong sending the invite, beyond the shared reasons. */
export const CreateInviteFailure = Schema.Union([
	Schema.Literals(["WorkspaceNotFound", "AlreadyShared", "ChannelNotFound"]),
	CommonReason,
])
export type CreateInviteFailure = typeof CreateInviteFailure.Type

export const Model = Schema.Struct({
	modal: Modal.Model,
	searchQuery: Schema.String,
	searchResults: SearchResults.schema,
	/** Bumped on every keystroke and retry; only the latest search counts (`clearTimeout`). */
	searchVersion: Schema.Number,
	selectedWorkspace: Schema.NullOr(Workspace),
	allowGuestMemberAdds: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	modal: Modal.init("share-channel"),
	searchQuery: "",
	searchResults: SearchResults.Idle(),
	searchVersion: 0,
	selectedWorkspace: null,
	allowGuestMemberAdds: false,
	isSubmitting: false,
})

// MESSAGE

export const Message = defineMessageUnion({
	ChangedWorkspaceQuery: { value: Schema.String },
	ElapsedSearchDelay: { version: Schema.Number, query: Schema.String },
	SucceededSearchWorkspaces: { version: Schema.Number, results: Schema.Array(Workspace) },
	FailedSearchWorkspaces: { version: Schema.Number, reason: CommonReason },
	ClickedRetrySearch: {},
	ClickedWorkspace: { workspace: Workspace },
	ClickedClearWorkspace: {},
	ToggledAllowGuestMemberAdds: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	ClickedSendInvite: {},
	SucceededCreateInvite: {},
	FailedCreateInvite: { reason: CreateInviteFailure },
	GotModalMessage: { message: Modal.Message },
})
export type Message = typeof Message.Type

// COMMAND

export const WaitForSearchDelay = Command.define("WaitForSearchDelay", {
	args: { version: Schema.Number, query: Schema.String },
	messages: [Message.ElapsedSearchDelay],
	execute: ({ version, query }) =>
		Effect.sleep(Duration.millis(300)).pipe(Effect.as(Message.ElapsedSearchDelay({ version, query }))),
})

export const SearchWorkspaces = Command.define("SearchWorkspaces", {
	args: { version: Schema.Number, query: Schema.String, organizationId: OrganizationId },
	messages: [Message.SucceededSearchWorkspaces, Message.FailedSearchWorkspaces],
	execute: ({ version, query, organizationId }) =>
		HazelRpc.use((rpc) => rpc("connectShare.workspace.search", { query, organizationId })).pipe(
			Effect.map((response) =>
				Message.SucceededSearchWorkspaces({
					version,
					results: response.data.map((result) => ({
						id: result.id,
						name: result.name,
						slug: result.slug,
						logoUrl: result.logoUrl,
					})),
				}),
			),
			catchCommon((reason) => Message.FailedSearchWorkspaces({ version, reason })),
		),
})

export const CreateInvite = Command.define("CreateInvite", {
	args: {
		channelId: ChannelId,
		guestOrganizationId: OrganizationId,
		slug: Schema.String,
		allowGuestMemberAdds: Schema.Boolean,
	},
	messages: [Message.SucceededCreateInvite, Message.FailedCreateInvite],
	execute: ({ channelId, guestOrganizationId, slug, allowGuestMemberAdds }) =>
		HazelRpc.use((rpc) =>
			rpc("connectShare.invite.create", {
				channelId,
				guestOrganizationId,
				target: { kind: "slug", value: slug },
				allowGuestMemberAdds,
			}),
		).pipe(
			Effect.as(Message.SucceededCreateInvite()),
			Effect.catchTags({
				ConnectWorkspaceNotFoundError: () =>
					Effect.succeed(Message.FailedCreateInvite({ reason: "WorkspaceNotFound" })),
				ConnectChannelAlreadySharedError: () =>
					Effect.succeed(Message.FailedCreateInvite({ reason: "AlreadyShared" })),
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedCreateInvite({ reason: "ChannelNotFound" })),
			}),
			catchCommon((reason) => Message.FailedCreateInvite({ reason })),
		),
})

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>
export type Context = Readonly<{ channelId: ChannelId; organizationId: OrganizationId | null }>

/** The modal renders open, and its dialog Mount takes the focus trap, isolation and scroll lock. */
export const open = (model: Model): Model =>
	modifyFields(model, { modal: (modal) => Modal.initOpen(modal.id) })

/** Starts a search for the current query now, superseding any search in flight. */
const search = (model: Model, query: string, organizationId: OrganizationId): Return => {
	const version = model.searchVersion + 1
	return {
		model: modifyFields(model, {
			searchVersion: () => version,
			searchResults: () => SearchResults.Loading(),
		}),
		commands: [SearchWorkspaces({ version, query, organizationId })],
	}
}

export const update = (model: Model, message: Message, context: Context): Return =>
	Message.match<Return>(message, {
		ChangedWorkspaceQuery: ({ value }) => {
			const version = model.searchVersion + 1
			const base = modifyFields(model, {
				searchQuery: () => value,
				selectedWorkspace: () => null,
				searchVersion: () => version,
			})
			if (value.length < 2)
				return { model: modifyFields(base, { searchResults: () => SearchResults.Idle() }) }
			return {
				model: modifyFields(base, { searchResults: () => SearchResults.Loading() }),
				commands: [WaitForSearchDelay({ version, query: value })],
			}
		},
		ElapsedSearchDelay: ({ version, query }) =>
			version !== model.searchVersion || context.organizationId === null
				? { model }
				: {
						model,
						commands: [
							SearchWorkspaces({ version, query, organizationId: context.organizationId }),
						],
					},
		SucceededSearchWorkspaces: ({ version, results }) =>
			version !== model.searchVersion
				? { model }
				: {
						model: modifyFields(model, {
							searchResults: () => SearchResults.Success({ data: results }),
						}),
					},
		FailedSearchWorkspaces: ({ version, reason }) =>
			version !== model.searchVersion
				? { model }
				: {
						model: modifyFields(model, {
							searchResults: () => SearchResults.Failure({ error: reason }),
						}),
					},
		ClickedRetrySearch: () =>
			AsyncData.isFailure(model.searchResults) && context.organizationId !== null
				? search(model, model.searchQuery, context.organizationId)
				: { model },
		ClickedWorkspace: ({ workspace }) =>
			workspace.slug
				? {
						model: modifyFields(model, {
							selectedWorkspace: () => workspace,
							searchQuery: () => "",
							searchResults: () => SearchResults.Idle(),
						}),
					}
				: { model },
		ClickedClearWorkspace: () => ({ model: modifyFields(model, { selectedWorkspace: () => null }) }),
		ToggledAllowGuestMemberAdds: ({ isSelected }) => ({
			model: modifyFields(model, { allowGuestMemberAdds: () => isSelected }),
		}),
		ClickedCancel: () => ({ model: init() }),
		ClickedSendInvite: () => {
			const selected = model.selectedWorkspace
			if (selected === null || !selected.slug || model.isSubmitting) return { model }
			return {
				model: modifyFields(model, { isSubmitting: () => true }),
				commands: [
					CreateInvite({
						channelId: context.channelId,
						guestOrganizationId: selected.id,
						slug: selected.slug,
						allowGuestMemberAdds: model.allowGuestMemberAdds,
					}),
				],
			}
		},
		SucceededCreateInvite: () => ({
			model: init(),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite sent") }),
		}),
		FailedCreateInvite: ({ reason }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						WorkspaceNotFound: {
							title: "Workspace not found",
							description: "No workspace matches that name or slug.",
						},
						AlreadyShared: {
							title: "Already shared",
							description: "This channel is already shared with that organization.",
						},
						ChannelNotFound: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
						},
					}),
				),
			}),
		}),
		GotModalMessage: ({ message: modalMessage }) => {
			const next = Modal.update(model.modal, modalMessage)
			const nextModel = next.model.isOpen ? modifyFields(model, { modal: () => next.model }) : init()
			return {
				model: nextModel,
				commands: Command.mapMessages(next.commands ?? [], (child) =>
					Message.GotModalMessage({ message: child }),
				),
			}
		},
	})
