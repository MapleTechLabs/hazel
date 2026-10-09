// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { errorToast, successToast } from "../../../data/actions"
import { channelId, failureToastFixture, makeShared, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { init, update, UpdateChannel } from "./update"
import { view } from "./view"

/** The channel overview tab through its view: the rename form and its save states. */

const shared = makeShared()
const initial = init({ _tag: "ChannelSettingsOverview", orgSlug: "hazel", channelId }).model
const loadedChannel = Message.UpdatedChannel({ channel: { id: channelId, name: "general", icon: "🎉" } })
const nameInput = Scene.label("Channel name")
const save = Scene.role("button", { name: "Save changes" })

describe("channel overview scene", () => {
	test("the form appears once the live channel row arrives", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.expect(Scene.role("heading", { name: "Overview" })).toExist(),
			Scene.expect(nameInput).toBeAbsent(),
			Scene.Subscription.emit(loadedChannel),
			Scene.expect(nameInput).toHaveValue("general"),
			Scene.expect(save).toBeDisabled(),
			Scene.expect(Scene.text("Click to change icon")).toExist(),
		)
	})

	test("renaming saves through channel.update and toasts the success", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.Subscription.emit(loadedChannel),
			Scene.type(nameInput, "announcements"),
			Scene.expect(save).toBeEnabled(),
			Scene.click(save),
			Scene.Command.expectExact(UpdateChannel({ id: channelId, name: "announcements", icon: "🎉" })),
			Scene.expect(Scene.role("button", { name: "Saving..." })).toBeDisabled(),
			Scene.Command.resolve(UpdateChannel, Message.SucceededUpdateChannel()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel updated successfully") }),
			),
			Scene.expect(nameInput).toHaveValue("announcements"),
		)
	})

	test("a failed save re-enables the button and toasts the failure", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.Subscription.emit(loadedChannel),
			Scene.type(nameInput, "announcements"),
			Scene.submit(Scene.selector("form")),
			Scene.Command.resolve(
				UpdateChannel,
				Message.FailedUpdateChannel({
					toast: errorToast(failureToastFixture.title, failureToastFixture.description),
				}),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(save).toBeEnabled(),
		)
	})

	test("a one-character name is marked invalid and cannot be saved", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.Subscription.emit(loadedChannel),
			Scene.type(nameInput, "a"),
			Scene.expect(nameInput).toHaveAttr("aria-invalid", "true"),
			Scene.expect(save).toBeDisabled(),
		)
	})

	// a11y: the icon's clear button has no accessible name, so it is found by position.
	test("clearing the icon enables Save and sends a null icon", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.Subscription.emit(loadedChannel),
			Scene.click(Scene.nth(Scene.all.role("button"), 1)),
			Scene.expect(Scene.text("Click to add an emoji icon")).toExist(),
			Scene.click(save),
			Scene.Command.expectExact(UpdateChannel({ id: channelId, name: "general", icon: null })),
			Scene.Command.resolve(UpdateChannel, Message.SucceededUpdateChannel()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel updated successfully") }),
			),
		)
	})

	test("a deleted channel removes the form", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(initial),
			Scene.Subscription.emit(loadedChannel),
			Scene.Subscription.emit(Message.UpdatedChannel({ channel: null })),
			Scene.expect(nameInput).toBeAbsent(),
		)
	})
})
