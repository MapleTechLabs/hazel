import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema, Stream } from "effect"
import { Command, Submodel, Subscription } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../rpc"
import type { Shared } from "../../page/contract"
import { AppRoute, orgHrefOf } from "../../route"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalSubscriptionInput } from "./contract"
import { findExistingDmChannel, organizationUsersStream } from "./create-dm-data"
import { Message, Model, SEARCH_ID } from "./create-dm-model"
import { view } from "./create-dm-view"
import { initFrame, isFrameClosed } from "./frame"

/** `components/modals/create-dm-modal.tsx` (legacy `useModal("create-dm")`). */

const FocusSearch = Command.define("FocusSearch", {
	args: {},
	messages: [Message.CompletedFocusSearch],
	execute: () => Dom.focus(`#${SEARCH_ID}`).pipe(Effect.ignoreCause, Effect.as(Message.CompletedFocusSearch())),
})

/** Legacy `onSubmit`: reuse an existing DM with exactly these people, else `channel.createDm`. */
const StartConversation = Command.define("StartConversation", {
	args: {
		organizationId: OrganizationId,
		currentUserId: UserId,
		participantIds: Schema.Array(UserId),
		type: Schema.Literals(["single", "direct"]),
		name: Schema.NullOr(Schema.String),
	},
	messages: [Message.FoundExistingDm, Message.SucceededCreateDm, Message.FailedCreateDm],
	execute: ({ organizationId, currentUserId, participantIds, type, name }) =>
		Effect.gen(function* () {
			const existing = yield* findExistingDmChannel(currentUserId, participantIds, organizationId)
			if (existing !== null) return Message.FoundExistingDm({ channelId: existing })
			const client = yield* HazelRpc
			const result = yield* client("channel.createDm", {
				organizationId,
				participantIds: [...participantIds],
				type,
				name: name ?? undefined,
			})
			return Message.SucceededCreateDm({ channelId: result.data.id })
		}).pipe(Effect.catchCause((cause) => Effect.succeed(Message.FailedCreateDm({ toast: toastForCause(cause) })))),
})

type Return = ModalReturn<Model, Message>

const chatHref = (shared: Shared, channelId: ChannelId) =>
	orgHrefOf(shared.orgSlug, (orgSlug) => AppRoute.ChatChannel({ orgSlug, channelId })) ?? undefined

const submitted = (model: Model, shared: Shared): Return => {
	const ids = model.selectedUserIds
	if (ids.length === 0 || model.isSubmitting || !shared.currentUser || !shared.organization || !shared.orgSlug)
		return { model }
	const type = ids.length === 1 ? "single" : "direct"
	const names = model.organizationUsers
		.filter((user) => ids.includes(user.id))
		.map((user) => user.firstName)
		.slice(0, 3)
		.join(", ")
	return {
		model: modifyFields(model, { isSubmitting: () => true }),
		commands: [
			StartConversation({
				organizationId: shared.organization.id,
				currentUserId: shared.currentUser.id,
				participantIds: ids,
				type,
				name: type === "direct" ? names : null,
			}),
		],
	}
}

const successMessage = (model: Model) => {
	const target = model.organizationUsers.find((user) => user.id === model.selectedUserIds[0])
	return model.selectedUserIds.length === 1
		? `Started conversation with ${target?.firstName}`
		: `Created group conversation with ${model.selectedUserIds.length} people`
}

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		// `autoFocus`: after the frame has portaled and focused its dialog.
		GotFrameMessage: ({ message }) =>
			isFrameClosed(model.frame, message)
				? { model, outMessage: closed }
				: message._tag === "CompletedPortalModal"
					? { model, commands: [FocusSearch({})] }
					: { model },
		ChangedSearch: ({ value }) => ({ model: modifyFields(model, { searchQuery: () => value }) }),
		FocusedSearch: () => ({ model: modifyFields(model, { isSearchFocused: () => true }) }),
		BlurredSearch: () => ({ model: modifyFields(model, { isSearchFocused: () => false }) }),
		ClickedUser: ({ userId }) => ({
			model: modifyFields(model, {
				selectedUserIds: (ids) => (ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]),
			}),
		}),
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedStartConversation: () => submitted(model, shared),
		UpdatedOrganizationUsers: ({ users }) => ({ model: modifyFields(model, { organizationUsers: () => users }) }),
		FoundExistingDm: ({ channelId }) => ({ model, outMessage: completed({ href: chatHref(shared, channelId) }) }),
		SucceededCreateDm: ({ channelId }) => ({
			model,
			outMessage: completed({ href: chatHref(shared, channelId), toast: successToast(successMessage(model)) }),
		}),
		FailedCreateDm: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
		CompletedFocusSearch: () => ({ model }),
	})

const subscriptions = Subscription.make<ModalSubscriptionInput<Model>, Message>()((entry) => ({
	organizationUsers: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: (input) => ({ organizationId: input.shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: organizationUsersStream(organizationId, (users) => Message.UpdatedOrganizationUsers({ users })),
		},
	),
}))

export const modal = defineModal(
	"CreateDm",
	{ request: Requests.CreateDm, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame("create-dm-modal"),
				searchQuery: "",
				isSearchFocused: false,
				selectedUserIds: [],
				organizationUsers: [],
				isSubmitting: false,
			},
		}),
		update,
		view,
		subscriptions,
	},
)
