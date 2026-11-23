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
	ChangeServer,
	FetchSignInMethods,
	RetireBrowserSignIn,
	StartBrowserSignIn,
	StartOAuthSignIn,
	StartPasskeySignIn,
	UseDefaultServer,
} from "./sign-in/command"
import { Message as SignInMessage } from "./sign-in/message"
import { Submission } from "./sign-in/model"
import { init as initSignIn, initWith as initSignInWith, update as updateSignIn } from "./sign-in/update"
import { view as signInView } from "./sign-in/view"

/** Sign-in starts OAuth or a passkey with the route's redirect; registration submits a name. */

const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })
const github = Scene.role("button", { name: "Continue with GitHub" })
const passkey = Scene.role("button", { name: "Sign in with a passkey" })

const google = Scene.role("button", { name: "Continue with Google" })

type Providers = ReadonlyArray<"github" | "google">

/** Sign-in once the install has said which methods it offers (both providers by default). */
const signIn = (
	redirectUrl: Option.Option<string>,
	providers: Providers = ["github", "google"],
	passkeys = true,
) =>
	updateSignIn(
		initSignIn(AppRoute.SignIn.make({ redirectUrl, error: Option.none() })).model,
		SignInMessage.SucceededFetchSignInMethods({ providers, passkeys }),
	).model

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

	test("a failed OAuth callback lands with ?error= and says why; an unknown reason stays generic", () => {
		const landed = (error: string) =>
			initSignIn(AppRoute.SignIn.make({ redirectUrl: Option.none(), error: Option.some(error) })).model
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(landed("Expired")),
			Scene.expect(Scene.role("alert")).toHaveText(
				"That sign-in expired or was already used. Please start again.",
			),
		)
		expect(landed("<script>").submission).toEqual(Submission.Failed({ reason: "Unexpected" }))
	})

	test("asks the install for its methods, and shows none of them until it answers", () => {
		const loading = initSignIn(AppRoute.SignIn.make({ redirectUrl: Option.none(), error: Option.none() }))
		expect(loading.commands?.map((command) => command.name)).toEqual([FetchSignInMethods.name])
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(loading.model),
			Scene.expect(Scene.label("Loading sign-in options")).toExist(),
			Scene.expect(github).toBeAbsent(),
			Scene.expect(google).toBeAbsent(),
			Scene.expect(passkey).toBeAbsent(),
		)
	})

	test("a Google-only install offers Google and passkeys, and names only Google", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.none(), ["google"])),
			Scene.expect(github).toBeAbsent(),
			Scene.click(google),
			Scene.Command.expectExact(StartOAuthSignIn({ provider: "google", returnTo: null })),
			Scene.Command.resolve(StartOAuthSignIn, SignInMessage.FailedSignIn({ reason: "Cancelled" })),
			Scene.click(passkey),
			Scene.Command.resolve(
				StartPasskeySignIn,
				SignInMessage.FailedSignIn({ reason: "PasskeyUnsupported" }),
			),
			Scene.expect(Scene.role("alert")).toHaveText(
				"This browser can't use passkeys. Continue with Google instead.",
			),
		)
	})

	test("a GitHub-only install offers GitHub alone", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.none(), ["github"])),
			Scene.expect(github).toExist(),
			Scene.expect(google).toBeAbsent(),
			Scene.expect(passkey).toExist(),
		)
	})

	test("when the install can't answer, every method is offered", () => {
		const failed = updateSignIn(
			initSignIn(AppRoute.SignIn.make({ redirectUrl: Option.none(), error: Option.none() })).model,
			SignInMessage.FailedFetchSignInMethods(),
		).model
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(failed),
			Scene.expect(github).toExist(),
			Scene.expect(google).toExist(),
			Scene.expect(passkey).toExist(),
		)
	})

	test("/sign-up names only the offered providers", () => {
		const signUp = updateSignIn(
			initSignIn(AppRoute.SignUp.make({ redirectUrl: Option.none() })).model,
			SignInMessage.SucceededFetchSignInMethods({ providers: ["google"], passkeys: true }),
		).model
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signUp),
			Scene.expect(Scene.text("Sign up with Google. It takes a few seconds.")).toExist(),
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

describe("native sign-in: another install", () => {
	const onHazel = { label: "hazel.sh", isDefault: true, form: null }
	const onAcme = { label: "chat.acme.com", isDefault: false, form: null }
	const nativeSignIn = (server: typeof onHazel) =>
		initSignInWith(AppRoute.SignIn.make({ redirectUrl: Option.none(), error: Option.none() }), server)
			.model
	const change = Scene.role("button", { name: "Change from hazel.sh" })
	const address = Scene.label("Web address")
	const submit = Scene.role("button", { name: "Continue" })

	test("the web never offers it", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(signIn(Option.none())),
			Scene.expect(Scene.text("Signing in to")).toBeAbsent(),
		)
	})

	test("Change opens the form; an address is resolved and the app moves to it", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(nativeSignIn(onHazel)),
			Scene.expect(Scene.role("button", { name: "Sign in with your browser" })).toExist(),
			Scene.click(change),
			Scene.expect(Scene.role("heading", { name: "Sign in to another Hazel" })).toExist(),
			// Hazel cloud is already the install: nothing to reset to.
			Scene.expect(Scene.role("button", { name: "Use Hazel cloud" })).toBeAbsent(),
			Scene.type(address, "chat.acme.com"),
			Scene.click(submit),
			Scene.Command.expectExact(ChangeServer({ address: "chat.acme.com" })),
			Scene.expect(Scene.role("button", { name: "Connecting..." })).toBeDisabled(),
			Scene.Command.resolve(ChangeServer, SignInMessage.LeftForServer()),
		)
	})

	test("an empty address is refused without a request; a failed one says why and can be retried", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(nativeSignIn(onHazel)),
			Scene.click(change),
			Scene.click(submit),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Enter your workspace's web address")).toExist(),
			Scene.type(address, "http://chat.acme.com"),
			Scene.click(submit),
			Scene.Command.resolve(ChangeServer, SignInMessage.FailedServerChange({ problem: "Insecure" })),
			Scene.expect(Scene.text("The address must use https")).toExist(),
			Scene.expect(submit).toBeEnabled(),
		)
	})

	test("Cancel closes the form and keeps the install", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(nativeSignIn(onHazel)),
			Scene.click(change),
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.expect(Scene.text("hazel.sh")).toExist(),
			Scene.expect(Scene.role("button", { name: "Sign in with your browser" })).toExist(),
		)
	})

	test("on a customer's install, Use Hazel cloud goes back to the default", () => {
		Scene.scene(
			pageScene(updateSignIn, signInView, signedOut),
			Scene.given(nativeSignIn(onAcme)),
			Scene.expect(Scene.text("chat.acme.com")).toExist(),
			Scene.click(Scene.role("button", { name: "Change from chat.acme.com" })),
			Scene.click(Scene.role("button", { name: "Use Hazel cloud" })),
			Scene.Command.expectExact(UseDefaultServer()),
			Scene.Command.resolve(UseDefaultServer, SignInMessage.LeftForServer()),
		)
	})

	test("the install can't change while a browser sign-in waits", () => {
		const waiting = updateSignIn(nativeSignIn(onHazel), SignInMessage.ClickedBrowserSignIn()).model
		expect(updateSignIn(waiting, SignInMessage.ClickedChangeServer()).model.server?.form).toBeNull()
	})
})
