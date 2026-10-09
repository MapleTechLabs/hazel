// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { failureToastFixture, makeShared, pageScene } from "../../test/pages-fixtures"
import { PageOutMessage } from "../out-message"
import { JoinWorkspace, RedirectToSignIn } from "./command"
import { Message } from "./message"
import { Lookup, type Model } from "./model"
import { update } from "./update"
import { CardEnterAnimation, view } from "./view"

/** The invite card through its view: loading, not found, signed out and signed in. */

const signedIn = makeShared()
const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })
const withOrganization = (memberCount: number): Model => ({
	slug: "hazel",
	lookup: Lookup.Loaded({ organization: { name: "Hazel Labs", logoUrl: null, memberCount } }),
	isJoining: false,
})
const cardShown = Scene.Mount.resolve(CardEnterAnimation, Message.CompletedEnterAnimation())
const joinButton = Scene.role("button", { name: "Join Workspace" })

describe("join page", () => {
	test("shows the loader while the lookup runs, and while user.me is still pending", () => {
		Scene.scene(
			pageScene(update, view, signedIn),
			Scene.given<Model>({ slug: "hazel", lookup: Lookup.Loading(), isJoining: false }),
			Scene.expect(Scene.text("Loading workspace...")).toExist(),
		)
		const loadingUser = makeShared({ currentUser: null })
		Scene.scene(
			pageScene(update, view, loadingUser),
			Scene.given(withOrganization(3)),
			Scene.expect(Scene.text("Loading workspace...")).toExist(),
			Scene.expect(joinButton).toBeAbsent(),
		)
	})

	test("an unknown or private workspace explains itself and links home", () => {
		Scene.scene(
			pageScene(update, view, signedIn),
			Scene.given<Model>({ slug: "nope", lookup: Lookup.Loaded({ organization: null }), isJoining: false }),
			cardShown,
			Scene.expect(Scene.role("heading", { name: "Workspace Not Found" })).toExist(),
			Scene.expect(Scene.role("link", { name: "Go to Home" })).toHaveAttr("href", "/"),
		)
	})

	test("a failed lookup renders exactly like not found", () => {
		Scene.scene(
			pageScene(update, view, signedIn),
			Scene.given<Model>({ slug: "nope", lookup: Lookup.Failed(), isJoining: false }),
			cardShown,
			Scene.expect(Scene.role("heading", { name: "Workspace Not Found" })).toExist(),
		)
	})

	test("a signed-out visitor is sent to sign in and back", () => {
		Scene.scene(
			pageScene(update, view, signedOut),
			Scene.given(withOrganization(1)),
			cardShown,
			Scene.expect(Scene.role("heading", { name: "Hazel Labs" })).toExist(),
			Scene.expect(Scene.text("1 member")).toExist(),
			Scene.expect(joinButton).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Sign in to Join" })),
			Scene.Command.expectExact(RedirectToSignIn({ returnTo: "/join/hazel" })),
			Scene.Command.resolve(RedirectToSignIn, Message.CompletedRedirectToSignIn()),
		)
	})

	test("joining disables the button until the server answers", () => {
		Scene.scene(
			pageScene(update, view, signedIn),
			Scene.given(withOrganization(3)),
			cardShown,
			Scene.expect(Scene.text("3 members")).toExist(),
			Scene.click(joinButton),
			Scene.Command.expectExact(JoinWorkspace({ slug: "hazel" })),
			Scene.expect(Scene.role("button", { name: "Joining..." })).toBeDisabled(),
			Scene.Command.resolve(JoinWorkspace, Message.FailedJoinWorkspace({ toast: failureToastFixture })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(joinButton).toBeEnabled(),
		)
	})
})
