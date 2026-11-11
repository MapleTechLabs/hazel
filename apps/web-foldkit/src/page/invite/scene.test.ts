// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { currentUser, makeShared, pageScene } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { AcceptInvitation, FetchPreview, RedirectToInviteSignIn } from "./command"
import { Message } from "./message"
import { Acceptance, Lookup, type Model, type Preview } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The invitation link: sign in, accept with the invited account, or explain why it can't be used. */

const preview = (overrides: Partial<Preview> = {}): Preview => ({
	organizationName: "Hazel Labs",
	organizationLogoUrl: null,
	email: currentUser.email.toLowerCase(),
	status: "Pending",
	...overrides,
})
const loaded = (overrides: Partial<Preview> = {}): Model => ({
	token: "tok_abcdefghijklmnop",
	lookup: Lookup.Loaded({ preview: preview(overrides) }),
	acceptance: Acceptance.Idle(),
})
const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })

describe("invite page", () => {
	test("signed out, it sends the visitor to sign in and back", () => {
		Scene.scene(
			pageScene(update, view, signedOut),
			Scene.given(loaded()),
			Scene.expect(Scene.role("heading", { name: "Join Hazel Labs" })).toExist(),
			Scene.click(Scene.role("button", { name: "Sign in to accept" })),
			Scene.Command.expectExact(RedirectToInviteSignIn({ token: "tok_abcdefghijklmnop" })),
			Scene.Command.resolve(RedirectToInviteSignIn, Message.LeftPage()),
		)
	})

	test("the invited account accepts; a failure says why and allows a retry", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded()),
			Scene.click(Scene.role("button", { name: "Accept invitation" })),
			Scene.Command.expectExact(AcceptInvitation({ token: "tok_abcdefghijklmnop" })),
			Scene.expect(Scene.role("button", { name: "Joining..." })).toBeDisabled(),
			Scene.Command.resolve(AcceptInvitation, Message.FailedAccept({ reason: "NoLongerValid" })),
			Scene.expect(Scene.role("alert")).toHaveText(
				"This invitation is no longer valid. Ask for a new one.",
			),
			Scene.expect(Scene.role("button", { name: "Accept invitation" })).toBeEnabled(),
		)
	})

	test("another account is told whose invitation it is", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded({ email: "someone.else@hazel.test" })),
			Scene.expect(Scene.role("button", { name: "Accept invitation" })).toBeAbsent(),
			Scene.expect(Scene.role("alert")).toContainText("This invitation is for someone.else@hazel.test"),
			Scene.click(Scene.role("button", { name: "Sign in with another account" })),
			Scene.expectOutMessage(PageOutMessage.RequestedSignOut()),
		)
	})

	test("an expired or unknown link explains itself", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(loaded({ status: "Expired" })),
			Scene.expect(Scene.role("heading", { name: "Invitation unavailable" })).toExist(),
			Scene.expect(Scene.text("This invitation has expired. Ask for a new one.")).toExist(),
		)
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given<Model>({ ...loaded(), lookup: Lookup.NotFound() }),
			Scene.expect(Scene.role("heading", { name: "Invitation not found" })).toExist(),
		)
	})

	test("a failed lookup is not a missing invitation: it says so and retries", () => {
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given<Model>({ ...loaded(), lookup: Lookup.Failed({ reason: "Offline" }) }),
			Scene.expect(Scene.role("heading", { name: "Couldn't load the invitation" })).toExist(),
			Scene.click(Scene.role("button", { name: "Try again" })),
			Scene.Command.expectExact(FetchPreview({ token: "tok_abcdefghijklmnop" })),
			Scene.Command.resolve(FetchPreview, Message.SucceededFetchPreview({ preview: preview() })),
			Scene.expect(Scene.role("heading", { name: "Join Hazel Labs" })).toExist(),
		)
	})

	test("a malformed token is not found without asking the server", () => {
		const started = init({ _tag: "Invite", token: "short" })
		Scene.scene(
			pageScene(update, view, makeShared()),
			Scene.given(started.model),
			Scene.expect(Scene.role("heading", { name: "Invitation not found" })).toExist(),
		)
	})
})
