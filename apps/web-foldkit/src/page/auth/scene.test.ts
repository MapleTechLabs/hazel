// @vitest-environment jsdom
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { AppRoute } from "../../route"
import { makeShared, pageScene } from "../../test/pages-fixtures"
import { Register } from "./register/command"
import { Message as RegisterMessage } from "./register/message"
import { init as initRegister, update as updateRegister } from "./register/update"
import { view as registerView } from "./register/view"
import {
	RetireBrowserSignIn,
	StartBrowserSignIn,
	StartOAuthSignIn,
	StartPasskeySignIn,
} from "./sign-in/command"
import { Message as SignInMessage } from "./sign-in/message"
import { init as initSignIn, update as updateSignIn } from "./sign-in/update"
import { view as signInView } from "./sign-in/view"

/** Sign-in starts OAuth or a passkey with the route's redirect; registration submits a name. */

const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })
const github = Scene.role("button", { name: "Continue with GitHub" })
const passkey = Scene.role("button", { name: "Sign in with a passkey" })

const signIn = (redirectUrl: Option.Option<string>) => initSignIn(AppRoute.SignIn.make({ redirectUrl })).model

describe("sign in", () => {
	test("a provider starts OAuth with the route's redirect, and disables the other choices", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.some("/join/hazel"))),
			Scene.expect(Scene.role("heading", { name: "Sign in to Hazel" })).toExist(),
			Scene.click(github),
			Scene.Command.expectExact(StartOAuthSignIn({ provider: "github", returnTo: "/join/hazel" })),
			Scene.expect(passkey).toHaveAttr("data-disabled", "true"),
			Scene.Command.resolve(StartOAuthSignIn, SignInMessage.LeftForSignIn()),
		)
	})

	test("an off-site redirect is dropped", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.some("//evil.example/x"))),
			Scene.click(github),
			Scene.Command.expectExact(StartOAuthSignIn({ provider: "github", returnTo: null })),
			Scene.Command.resolve(StartOAuthSignIn, SignInMessage.LeftForSignIn()),
		)
	})

	test("a failed passkey sign-in shows why and lets the visitor try again; a cancelled one stays quiet", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.none())),
			Scene.click(passkey),
			Scene.Command.expectExact(StartPasskeySignIn({ returnTo: null })),
			Scene.Command.resolve(StartPasskeySignIn, SignInMessage.FailedSignIn({ reason: "Offline" })),
			Scene.expect(Scene.role("alert")).toHaveText(
				"Connection lost. Check your internet connection and try again.",
			),
			Scene.click(passkey),
			Scene.Command.resolve(StartPasskeySignIn, SignInMessage.FailedSignIn({ reason: "Cancelled" })),
			Scene.expect(Scene.role("alert")).toBeAbsent(),
		)
	})

	test("/sign-up offers the same choices and links back to sign-in", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(initSignIn(AppRoute.SignUp.make({ redirectUrl: Option.none() })).model),
			Scene.expect(Scene.role("heading", { name: "Create your Hazel account" })).toExist(),
			Scene.expect(Scene.role("link", { name: "Sign in" })).toHaveAttr("href", "/sign-in"),
		)
	})
})

describe("register", () => {
	const route = AppRoute.AuthRegister.make({ flowId: Option.some("f1"), reference: Option.some("r1") })

	test("submits the name with the callback's flow and reference", () => {
		Scene.scene(
			pageScene(updateRegister, registerView, signedOut),
			Scene.given(initRegister(route).model),
			Scene.type(Scene.label("First name"), "Ada"),
			Scene.type(Scene.label("Last name"), "Lovelace"),
			Scene.click(Scene.role("button", { name: "Continue" })),
			Scene.Command.expectExact(
				Register({ flowId: "f1", reference: "r1", firstName: "Ada", lastName: "Lovelace" }),
			),
			Scene.Command.resolve(Register, RegisterMessage.LeftForApp()),
		)
	})

	test("a failed registration says why and offers to start again", () => {
		Scene.scene(
			pageScene(updateRegister, registerView, signedOut),
			Scene.given(initRegister(route).model),
			Scene.type(Scene.label("First name"), "Ada"),
			Scene.click(Scene.role("button", { name: "Continue" })),
			Scene.expect(Scene.role("button", { name: "Creating your account..." })).toBeDisabled(),
			Scene.Command.resolve(Register, RegisterMessage.FailedRegistration({ reason: "Expired" })),
			Scene.expect(Scene.role("alert")).toHaveText(
				"That sign-in expired or was already used. Please start again.",
			),
			Scene.expect(Scene.role("link", { name: "Start sign-in again" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Continue" })).toBeEnabled(),
		)
	})

	test("a missing first name blocks the submit", () => {
		Scene.scene(
			pageScene(updateRegister, registerView, signedOut),
			Scene.given(initRegister(route).model),
			Scene.click(Scene.role("button", { name: "Continue" })),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Enter your first name")).toExist(),
		)
	})

	test("a link without its flow says so and points back to sign-in", () => {
		Scene.scene(
			pageScene(updateRegister, registerView, signedOut),
			Scene.given(
				initRegister(AppRoute.AuthRegister.make({ flowId: Option.none(), reference: Option.none() }))
					.model,
			),
			Scene.expect(Scene.role("heading", { name: "This sign-up link doesn't work" })).toExist(),
			Scene.expect(Scene.role("link", { name: "Back to sign in" })).toHaveAttr("href", "/sign-in"),
		)
	})
})

describe("desktop sign-in", () => {
	test("waits for the browser; Cancel stops the wait and retires the attempt", () => {
		const started = updateSignIn(signIn(Option.none()), SignInMessage.ClickedBrowserSignIn())
		expect(started.model.submission).toEqual({ _tag: "Pending", attempt: "browser" })
		expect(started.commands?.map((command) => command.name)).toEqual([StartBrowserSignIn.name])

		const cancelling = updateSignIn(started.model, SignInMessage.ClickedCancelBrowserSignIn())
		expect(cancelling.commands).toHaveLength(1)

		const cancelled = updateSignIn(cancelling.model, SignInMessage.CompletedCancelBrowserSignIn())
		expect(cancelled.model.submission._tag).toBe("Idle")
		expect(cancelled.commands?.map((command) => command.name)).toEqual([RetireBrowserSignIn.name])
	})

	test("a failed browser sign-in says why and can be retried", () => {
		const started = updateSignIn(signIn(Option.none()), SignInMessage.ClickedBrowserSignIn()).model
		const failed = updateSignIn(started, SignInMessage.FailedSignIn({ reason: "BrowserTimedOut" }))
		expect(failed.model.submission).toEqual({ _tag: "Failed", reason: "BrowserTimedOut" })
		expect(updateSignIn(failed.model, SignInMessage.ClickedBrowserSignIn()).model.submission).toEqual({
			_tag: "Pending",
			attempt: "browser",
		})
	})
})
