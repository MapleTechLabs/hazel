import { ChannelId, OrganizationId } from "@hazel/schema"
import { Duration, Effect, Exit, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../rpc"
import * as Modal from "../../../ui/modal"
import { failureToast, successToast } from "../../../data/actions"
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

export const Model = Schema.Struct({
	modal: Modal.Model,
	searchQuery: Schema.String,
	searchResults: Schema.Array(Workspace),
	isSearching: Schema.Boolean,
	/** Bumped on every keystroke; only the latest debounced search counts (`clearTimeout`). */
	searchVersion: Schema.Number,
	selectedWorkspace: Schema.NullOr(Workspace),
	allowGuestMemberAdds: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	modal: Modal.init("share-channel"),
	searchQuery: "",
	searchResults: [],
	isSearching: false,
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
	FailedSearchWorkspaces: { version: Schema.Number },
	ClickedWorkspace: { workspace: Workspace },
	ClickedClearWorkspace: {},
	ToggledAllowGuestMemberAdds: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	ClickedSendInvite: {},
	SucceededCreateInvite: {},
	FailedCreateInvite: { title: Schema.String, description: Schema.NullOr(Schema.String) },
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
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const response = yield* client("connectShare.workspace.search", { query, organizationId })
			const results = response.data.map((result) => ({
				id: result.id,
				name: result.name,
				slug: result.slug,
				logoUrl: result.logoUrl,
			}))
			return Message.SucceededSearchWorkspaces({ version, results })
		}).pipe(Effect.catch(() => Effect.succeed(Message.FailedSearchWorkspaces({ version })))),
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
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client("connectShare.invite.create", {
					channelId,
					guestOrganizationId,
					target: { kind: "slug", value: slug },
					allowGuestMemberAdds,
				}),
			)
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededCreateInvite(),
				onFailure: (cause) => {
					const toast = failureToast(cause, "exitToast", {
						ConnectWorkspaceNotFoundError: {
							title: "Workspace not found",
							description: "No workspace matches that name or slug.",
							isRetryable: false,
						},
						ConnectChannelAlreadySharedError: {
							title: "Already shared",
							description: "This channel is already shared with that organization.",
							isRetryable: false,
						},
					})
					return Message.FailedCreateInvite({ title: toast.title, description: toast.description })
				},
			})
		}),
})

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>
export type Context = Readonly<{ channelId: ChannelId; organizationId: OrganizationId | null }>

/** `resetState()` plus closing; `onOpenChange(false)` resets as well. */
const closed = (model: Model): Model => ({ ...init(), modal: Modal.close(model.modal).model })

export const open = (model: Model): Model =>
	modifyFields(model, { modal: (modal) => Modal.open(modal).model })

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
				return { model: modifyFields(base, { searchResults: () => [], isSearching: () => false }) }
			return {
				model: modifyFields(base, { isSearching: () => true }),
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
				: { model: modifyFields(model, { searchResults: () => results, isSearching: () => false }) },
		FailedSearchWorkspaces: ({ version }) =>
			version !== model.searchVersion
				? { model }
				: { model: modifyFields(model, { searchResults: () => [], isSearching: () => false }) },
		ClickedWorkspace: ({ workspace }) =>
			workspace.slug
				? {
						model: modifyFields(model, {
							selectedWorkspace: () => workspace,
							searchQuery: () => "",
							searchResults: () => [],
						}),
					}
				: { model },
		ClickedClearWorkspace: () => ({ model: modifyFields(model, { selectedWorkspace: () => null }) }),
		ToggledAllowGuestMemberAdds: ({ isSelected }) => ({
			model: modifyFields(model, { allowGuestMemberAdds: () => isSelected }),
		}),
		ClickedCancel: () => ({ model: closed(model) }),
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
			model: closed(model),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Invite sent") }),
		}),
		FailedCreateInvite: ({ title, description }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } }),
		}),
		GotModalMessage: ({ message: modalMessage }) => {
			const next = Modal.update(model.modal, modalMessage)
			const nextModel = next.model.isOpen
				? modifyFields(model, { modal: () => next.model })
				: closed(model)
			return {
				model: nextModel,
				commands: Command.mapMessages(next.commands ?? [], (child) =>
					Message.GotModalMessage({ message: child }),
				),
			}
		},
	})
