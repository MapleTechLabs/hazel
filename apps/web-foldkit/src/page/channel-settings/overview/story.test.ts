import "../../../test/document-stub"
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { canSave, isDirty, isSubmitting } from "./model"
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
			model((current) => expect(current.form !== null && isSubmitting(current.form)).toBe(true)),
			Command.resolve(UpdateChannel, Message.FailedUpdateChannel({ reason: "NotFound" })),
			model((current) => expect(current.form !== null && isSubmitting(current.form)).toBe(false)),
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

	test("a live update keeps the edited form (keyed by channel id)", () => {
		const edited = update(loaded, Message.ChangedName({ name: "draft" })).model
		const next = update(
			edited,
			Message.UpdatedChannel({ channel: { id: channelId, name: "general", icon: null } }),
		).model
		expect(next.form?.name.value).toBe("draft")
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
			Command.resolve(UpdateChannel, Message.FailedUpdateChannel({ reason: "Offline" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
		)
	})
})

describe("validation and guards", () => {
	test("names must be 2 to 100 characters once the field changed", () => {
		const savable = (name: string) => {
			const form = update(loaded, Message.ChangedName({ name })).model.form
			return form !== null && canSave(form)
		}
		expect(savable("a")).toBe(false)
		expect(savable("ab")).toBe(true)
		expect(savable("x".repeat(100))).toBe(true)
		expect(savable("x".repeat(101))).toBe(false)
	})

	test("an invalid name does not submit", () => {
		story(
			update,
			given(loaded),
			message(Message.ChangedName({ name: "a" })),
			message(Message.SubmittedForm()),
			Command.expectNone(),
			model((current) => expect(current.form !== null && isSubmitting(current.form)).toBe(false)),
		)
	})

	test("a second submit while saving sends nothing", () => {
		const submitting = update(
			update(loaded, Message.ChangedName({ name: "renamed" })).model,
			Message.SubmittedForm(),
		).model
		story(update, given(submitting), message(Message.SubmittedForm()), Command.expectNone())
	})

	test("clearing an icon that was never set leaves the form clean", () => {
		const noIcon = update(
			initial,
			Message.UpdatedChannel({ channel: { id: channelId, name: "general", icon: null } }),
		).model
		story(
			update,
			given(noIcon),
			message(Message.ClearedIcon()),
			model((current) => expect(current.form !== null && isDirty(current.form)).toBe(false)),
			message(Message.SubmittedForm()),
			Command.expectNone(),
		)
	})
})

describe("save success and channel removal", () => {
	test("a cleared icon saves as null, then toasts and settles", () => {
		story(
			update,
			given(loaded),
			message(Message.ClearedIcon()),
			message(Message.SubmittedForm()),
			Command.expectExact(UpdateChannel({ id: channelId, name: "general", icon: null })),
			Command.resolve(UpdateChannel, Message.SucceededUpdateChannel()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Channel updated successfully", description: null },
				}),
			),
			model((current) => {
				expect(current.form !== null && isSubmitting(current.form)).toBe(false)
				expect(current.form !== null && isDirty(current.form)).toBe(false)
			}),
		)
	})

	test("a successful rename becomes the saved name: Save is disabled until the next edit", () => {
		story(
			update,
			given(loaded),
			message(Message.ChangedName({ name: "general-renamed" })),
			message(Message.SubmittedForm()),
			Command.resolve(UpdateChannel, Message.SucceededUpdateChannel()),
			model((current) => {
				expect(current.form?.savedName).toBe("general-renamed")
				expect(current.form !== null && canSave(current.form)).toBe(false)
			}),
			message(Message.ChangedName({ name: "general" })),
			model((current) => expect(current.form !== null && canSave(current.form)).toBe(true)),
		)
	})

	test("the saved values are the ones sent, not edits made while saving", () => {
		const saving = update(
			update(loaded, Message.ChangedName({ name: "sent" })).model,
			Message.SubmittedForm(),
		).model
		const edited = update(saving, Message.ChangedName({ name: "typed-while-saving" })).model
		const saved = update(edited, Message.SucceededUpdateChannel()).model.form
		expect(saved?.savedName).toBe("sent")
		expect(saved !== null && canSave(saved)).toBe(true)
	})

	test("an invalid name shows the rule's message", () => {
		const form = update(loaded, Message.ChangedName({ name: "a" })).model.form
		expect(form?.name).toEqual({
			_tag: "Invalid",
			value: "a",
			errors: ["Channel name must be at least 2 characters"],
		})
	})

	test("a deleted channel unmounts the form", () => {
		story(
			update,
			given(loaded),
			message(Message.UpdatedChannel({ channel: null })),
			model((current) => expect(current.form).toBeNull()),
		)
	})
})
