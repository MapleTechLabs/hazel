// @vitest-environment jsdom
import { ChannelId, MessageId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToastOf, reasonToast, successToast } from "../data/actions"
import { AppRoute } from "../route"
import { signedInShared } from "../test/root-fixtures"
import * as Modal from "./modal"
import * as DeleteMessage from "./modal/delete-message"
import type { ModalRequest } from "./modal/requests"
import * as RenameChannel from "./modal/rename-channel"
import { closed, completed, ModalOutMessage } from "./out-message"

/** The root modal slot: each opening is an instance, and a result reaches the instance that asked for it. */

const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")
const messageId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-0000000000d1")
const context: Modal.ModalContext = {
	...signedInShared(),
	route: AppRoute.ChatChannel({ orgSlug: "hazel", channelId }),
}

const run = (state: Modal.Model, modalMessage: Modal.Message) => {
	const transition = Modal.update(state, modalMessage, context)
	return {
		model: transition.model,
		commands: transition.commands ?? [],
		outMessage: Option.getOrUndefined(transition.outMessage),
	}
}

const opened = (state: Modal.Model, request: ModalRequest) => Modal.open(state, request, context).model

const deleteMessage = (instance: number, inner: typeof DeleteMessage.Message.Type): Modal.Message => ({
	_tag: "DeleteMessage",
	instance,
	message: inner,
})
const renameChannel = (instance: number | null, inner: typeof RenameChannel.Message.Type): Modal.Message => ({
	_tag: "RenameChannel",
	instance,
	message: inner,
})

describe("delete message", () => {
	test("a failure after the modal closed still toasts why the message came back", () => {
		story(
			run,
			given(opened(Modal.initialModel, { _tag: "DeleteMessage", messageId })),
			message(deleteMessage(0, DeleteMessage.Message.ClickedDelete())),
			Command.expectExact(DeleteMessage.DeleteMessage({ messageId })),
			expectOutMessage(closed),
			model((m) => expect(m.current).toBeNull()),
			Command.resolve(
				DeleteMessage.DeleteMessage,
				DeleteMessage.Message.FailedDeleteMessage({ reason: "NotFound" }),
			),
			expectOutMessage(
				ModalOutMessage.RequestedToast({
					toast: errorToastOf({
						title: "Message not found",
						description: "It may have already been deleted.",
					}),
				}),
			),
			model((m) => {
				expect(m.current).toBeNull()
				expect(m.retired).toEqual([])
			}),
		)
	})

	test("a common failure gets the shared copy", () => {
		story(
			run,
			given(opened(Modal.initialModel, { _tag: "DeleteMessage", messageId })),
			message(deleteMessage(0, DeleteMessage.Message.ClickedDelete())),
			Command.resolve(
				DeleteMessage.DeleteMessage,
				DeleteMessage.Message.FailedDeleteMessage({ reason: "Offline" }),
			),
			expectOutMessage(ModalOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
		)
	})
})

describe("instances", () => {
	const renaming = Modal.open(Modal.initialModel, { _tag: "RenameChannel", channelId }, context).model
	const channel = { id: channelId, name: "general" }

	// Subscription Messages carry no instance: they follow the open one.
	const loaded = run(renaming, renameChannel(null, RenameChannel.Message.UpdatedChannel({ channel }))).model
	const named = run(loaded, renameChannel(0, RenameChannel.Message.ChangedName({ value: "design" }))).model

	test("a reopened modal is not closed by the old instance's success, which still reports", () => {
		const submitted = run(named, renameChannel(0, RenameChannel.Message.SubmittedForm()))
		expect(submitted.commands.map((command) => command.name)).toEqual(["RenameChannel"])
		// Closed while the rename runs, then opened again: the rename's result belongs to instance 0.
		const cancelled = run(submitted.model, renameChannel(0, RenameChannel.Message.ClickedCancel()))
		expect(cancelled.outMessage).toEqual(closed)
		const reopened = opened(cancelled.model, { _tag: "RenameChannel", channelId })
		story(
			run,
			given(reopened),
			model((m) => expect(m.current).toMatchObject({ _tag: "RenameChannel", instance: 1 })),
			message(renameChannel(0, RenameChannel.Message.SucceededRenameChannel())),
			expectOutMessage(completed({ toast: successToast("Channel renamed successfully") })),
			model((m) => {
				expect(m.current).toMatchObject({ _tag: "RenameChannel", instance: 1 })
				expect(m.current?.model).toMatchObject({ name: "", isSubmitting: false })
				expect(m.retired).toEqual([])
			}),
		)
	})

	test("a late failure of a closed instance still toasts, and leaves the open one alone", () => {
		const submitted = run(named, renameChannel(0, RenameChannel.Message.SubmittedForm())).model
		const reopened = opened(submitted, { _tag: "RenameChannel", channelId })
		story(
			run,
			given(reopened),
			message(renameChannel(0, RenameChannel.Message.FailedRenameChannel({ reason: "Offline" }))),
			expectOutMessage(ModalOutMessage.RequestedToast({ toast: reasonToast("Offline") })),
			model((m) => {
				expect(m.current).toMatchObject({ _tag: "RenameChannel", instance: 1 })
				expect(m.retired).toEqual([])
			}),
		)
	})

	test("the open instance's own result still closes it", () => {
		story(
			run,
			given(renaming),
			message(renameChannel(null, RenameChannel.Message.UpdatedChannel({ channel }))),
			message(renameChannel(0, RenameChannel.Message.ChangedName({ value: "design" }))),
			message(renameChannel(0, RenameChannel.Message.SubmittedForm())),
			Command.resolve(RenameChannel.RenameChannel, RenameChannel.Message.SucceededRenameChannel()),
			expectOutMessage(completed({ toast: successToast("Channel renamed successfully") })),
			model((m) => expect(m.current).toBeNull()),
		)
	})

	test("a Message for an instance that is neither open nor retired is dropped", () => {
		const result = run(renaming, renameChannel(7, RenameChannel.Message.ClickedCancel()))
		expect(result.model).toBe(renaming)
		expect(result.outMessage).toBeUndefined()
	})
})
