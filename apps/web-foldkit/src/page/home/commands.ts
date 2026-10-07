import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Exit, Schema } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import { getUserFriendlyError } from "~/lib/error-messages"
import { HazelRpc } from "../../rpc"
import { searchFieldIds } from "../../ui/search-field"
import { dmChannelRows, findExistingDmChannel } from "./dm"
import { Message } from "./message"
import { SEARCH_ID } from "./model"

/** `SearchField autoFocus`: focus the input when it mounts (the shell may render the page late). */
export const AutoFocusSearch = Mount.define("AutoFocusMemberSearch", {
	messages: [Message.CompletedFocusSearch],
	execute: ({ element }) =>
		Effect.sync(() => {
			if (element instanceof HTMLElement) element.focus()
		}).pipe(Effect.as(Message.CompletedFocusSearch())),
})

/** The clear button's focus-on-press-start. */
export const FocusSearch = Command.define("FocusSearch", {
	messages: [Message.CompletedFocusSearch],
	execute: Dom.focus(`#${searchFieldIds(SEARCH_ID).input}`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedFocusSearch()),
	),
})

/** `handleOpenChat`, first half: reuse an existing DM with the member. */
export const FindDm = Command.define("FindDm", {
	args: { currentUserId: UserId, userId: UserId, name: Schema.String, organizationId: OrganizationId },
	messages: [Message.FoundExistingDm, Message.FoundNoDm],
	execute: ({ currentUserId, userId, name, organizationId }) =>
		Effect.promise(dmChannelRows).pipe(
			Effect.map((rows) => {
				const channelId = findExistingDmChannel(rows, currentUserId, [userId], organizationId)
				return channelId === null
					? Message.FoundNoDm({ userId, name })
					: Message.FoundExistingDm({ channelId })
			}),
		),
})

/** `createDmChannel({ payload: { organizationId, participantIds, type: "single" } })`. */
export const CreateDm = Command.define("CreateDm", {
	args: { organizationId: OrganizationId, userId: UserId, name: Schema.String },
	messages: [Message.SucceededCreateDm, Message.FailedCreateDm],
	execute: ({ organizationId, userId, name }) =>
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const exit = yield* Effect.exit(
				rpc("channel.createDm", { organizationId, participantIds: [userId], type: "single" }),
			)
			return Exit.match(exit, {
				onSuccess: (result) => Message.SucceededCreateDm({ channelId: result.data.id, name }),
				onFailure: (cause) => {
					const error = getUserFriendlyError(cause)
					return Message.FailedCreateDm({
						title: error.title,
						description: error.description ?? null,
					})
				},
			})
		}),
})

/** The success toast goes out before navigating, which drops this page. */
export const ShowCreatedDm = Command.define("ShowCreatedDm", {
	args: { channelId: ChannelId },
	messages: [Message.ShowedCreatedDmToast],
	execute: ({ channelId }) => Effect.succeed(Message.ShowedCreatedDmToast({ channelId })),
})

/** `handleCopyEmail`. */
export const CopyEmail = Command.define("CopyEmail", {
	args: { email: Schema.String },
	messages: [Message.SucceededCopyEmail, Message.FailedCopyEmail],
	execute: ({ email }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(email)).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededCopyEmail({ email }),
				onFailure: () => Message.FailedCopyEmail(),
			}),
		),
})
