import "../document-stub"
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { canSave } from "./model"
import { init, update, UpdateChannel } from "./update"

const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000001")
const initial = init({ _tag: "ChannelSettingsOverview", orgSlug: "hazel", channelId }).model
const loaded = update(
	initial,
	Message.UpdatedChannel({ channel: { id: channelId, name: "general", icon: "🎉" } }),
).model

describe("channel settings overview", () => {
	test("save stays disabled until the form is dirty, and an invalid name blocks it", () => {
		story(
			update,
			given(loaded),
			model((current) => expect(current.form && canSave(current.form)).toBe(false)),
			message(Message.ChangedName({ name: "" })),
			model((current) => expect(current.form && canSave(current.form)).toBe(false)),
			message(Message.ChangedName({ name: "general-renamed" })),
			model((current) => expect(current.form && canSave(current.form)).toBe(true)),
		)
	})

	test("submitting sends channel.update and toasts the failure", () => {
		story(
			update,
			given(loaded),
			message(Message.ClearedIcon()),
			message(Message.SubmittedForm()),
			model((current) => expect(current.form?.isSubmitting).toBe(true)),
			Command.resolve(
				UpdateChannel,
				Message.FailedUpdateChannel({ title: "Channel not found", description: "Gone." }),
			),
			model((current) => expect(current.form?.isSubmitting).toBe(false)),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Channel not found", description: "Gone." },
				}),
			),
		)
	})

	test("a live update keeps the edited form (keyed by channel id)", () => {
		const edited = update(loaded, Message.ChangedName({ name: "draft" })).model
		const next = update(
			edited,
			Message.UpdatedChannel({ channel: { id: channelId, name: "general", icon: null } }),
		).model
		expect(next.form?.name).toBe("draft")
	})
})

describe("save failure", () => {
	test("Save changes sends channel.update with the edited name and current icon", () => {
		story(
			update,
			given(loaded),
			message(Message.ChangedName({ name: "general-renamed" })),
			message(Message.SubmittedForm()),
			Command.expectExact(UpdateChannel({ id: channelId, name: "general-renamed", icon: "🎉" })),
			Command.resolve(
				UpdateChannel,
				Message.FailedUpdateChannel({
					title: "Channel not found",
					description: "This channel may have been deleted.",
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Channel not found",
						description: "This channel may have been deleted.",
					},
				}),
			),
		)
	})
})
