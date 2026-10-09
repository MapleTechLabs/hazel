import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Mount } from "foldkit"
import * as Dom from "foldkit/dom"
import { failureToast, settle } from "../../data/actions"
import { HazelRpc } from "../../rpc"
import { searchFieldIds } from "../../ui/search-field"
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

/** `createDmChannel({ payload: { organizationId, participantIds, type: "single" } })`. */
export const CreateDm = Command.define("CreateDm", {
	args: { organizationId: OrganizationId, userId: UserId, name: Schema.String },
	messages: [Message.SucceededCreateDm, Message.FailedCreateDm],
	execute: ({ organizationId, userId, name }) =>
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return yield* settle(
				rpc("channel.createDm", { organizationId, participantIds: [userId], type: "single" }),
				(result) => Message.SucceededCreateDm({ channelId: result.data.id, name }),
				(cause) => Message.FailedCreateDm({ toast: failureToast(cause, "friendly") }),
			)
		}),
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
