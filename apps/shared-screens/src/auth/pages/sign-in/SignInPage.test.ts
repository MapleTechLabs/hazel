// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Scene } from "@effect/ui/testing"
import { TextField } from "@hazel/ui/vocabulary/index"
import { describe, expect, test } from "vitest"
import { button, byProp, field, link, screenTitled, textOf } from "../../testing/locators"
import {
	ChangeServer,
	RetireBrowserSignIn,
	type ServerChoice,
	SignInMessage,
	SignInPageNoDeps,
	type SignInProps,
	StartBrowserSignIn,
	StartOAuthSignIn,
	StartPasskeySignIn,
	UseDefaultServer,
} from "./SignInPage"

/** Sign in or up with the install's methods; desktop and native through the system browser. */

const webProps: SignInProps = {
	mode: "SignIn",
	redirectUrl: "/hazel/chat",
	initialError: null,
	switchHref: "/sign-up?redirect_url=%2Fhazel%2Fchat",
	initialServer: null,
}
const cloud: ServerChoice = { label: "hazel.sh", isDefault: true, form: null }

const start = (props: Partial<SignInProps> = {}) => Scene.start(SignInPageNoDeps, { ...webProps, ...props })

describe("sign-in page", () => {
	test("waits for the install's methods, then offers only those", () => {
		start()
			.expect(byProp("progress", "label", "Loading sign-in options"))
			.toExist()
			.loaded("methods", { providers: ["github"], passkeys: false })
			.expect(button("Continue with GitHub"))
			.toExist()
			.expect(button("Continue with Google"))
			.toBeAbsent()
			.expect(button("Sign in with a passkey"))
			.toBeAbsent()
	})

	test("an install that can't answer offers every method", () => {
		start()
			.loadFailed("methods", "Unanswered")
			.expect(button("Continue with Google"))
			.toExist()
			.expect(button("Sign in with a passkey"))
			.toExist()
	})

	test("a provider leaves for its consent screen with the page to come back to; one attempt at a time", () => {
		const s = start()
			.loaded("methods", { providers: ["github", "google"], passkeys: true })
			.fire(button("Continue with GitHub"), "press")
			.expectExact(StartOAuthSignIn.make({ provider: "github", returnTo: "/hazel/chat" }))
			.keepPending(StartOAuthSignIn)
		expect(s.get(button("Continue with GitHub")).props).toMatchObject({ loading: true, disabled: true })
		// The press reaches `update` (a test bypasses `disabled`), which starts nothing more.
		s.fire(button("Sign in with a passkey"), "press").check((current) =>
			expect(current.pending.length).toBe(1),
		)
	})

	test("a refused passkey says why; a cancelled one says nothing", () => {
		start()
			.loaded("methods", { providers: ["github"], passkeys: true })
			.fire(button("Sign in with a passkey"), "press")
			.expectExact(StartPasskeySignIn.make({ returnTo: "/hazel/chat" }))
			.resolve(StartPasskeySignIn, SignInMessage.FailedSignIn({ reason: "PasskeyUnsupported" }))
			.expect(textOf("This browser can't use passkeys. Continue with GitHub instead."))
			.toExist()
		start()
			.loaded("methods", { providers: ["github"], passkeys: true })
			.fire(button("Sign in with a passkey"), "press")
			.resolve(StartPasskeySignIn, SignInMessage.FailedSignIn({ reason: "Cancelled" }))
			.expect(button("Sign in with a passkey"))
			.toExist()
	})

	test("a failed OAuth callback shows its error once; an unknown one reads as unexpected", () => {
		start({ initialError: "Denied" })
			.loaded("methods", { providers: ["github"], passkeys: false })
			.expect(
				textOf(
					"This account can't sign in to Hazel. This workspace only accepts certain email addresses. Sign in with your work account, or ask your admin for access.",
				),
			)
			.toExist()
		start({ initialError: "nonsense" })
			.loaded("methods", { providers: ["github"], passkeys: false })
			.expect(textOf("Something went wrong. Please try again."))
			.toExist()
	})

	test("sign-up names the providers and links back to sign-in", () => {
		const s = start({ mode: "SignUp", switchHref: "/sign-in" }).loaded("methods", {
			providers: ["github", "google"],
			passkeys: false,
		})
		expect(s.get(screenTitled("Create your Hazel account")).props?.["subtitle"]).toBe(
			"Sign up with GitHub or Google. It takes a few seconds.",
		)
		expect(s.get(link("Sign in")).props?.["href"]).toBe("/sign-in")
	})
})

describe("sign-in through the system browser", () => {
	test("waits for the browser; Cancel stops it and retires the attempt", () => {
		start({ initialServer: cloud })
			.expect(screenTitled("Sign in to Hazel"))
			.toExist()
			.fire(button("Sign in with your browser"), "press")
			.expectExact(StartBrowserSignIn.make({}))
			.keepPending(StartBrowserSignIn)
			.expect(button("Waiting for your browser..."))
			.toExist()
			.fire(button("Cancel"), "press")
			.check((current) => expect(current.interrupted.length).toBe(1))
			.expectExact(RetireBrowserSignIn.make({}))
			.resolve(RetireBrowserSignIn, SignInMessage.CompletedRetireBrowserSignIn())
			.expect(button("Sign in with your browser"))
			.toExist()
	})

	test("the browser's own failures have their copy", () => {
		start({ initialServer: cloud })
			.fire(button("Sign in with your browser"), "press")
			.resolve(StartBrowserSignIn, SignInMessage.FailedSignIn({ reason: "BrowserTimedOut" }))
			.expect(textOf("Signing in took too long. Please try again."))
			.toExist()
	})

	test("another install: an empty address is refused, a bad one says why, a good one switches", () => {
		const typed = start({ initialServer: { ...cloud, isDefault: false } })
			.fire(button("Change"), "press")
			.expect(screenTitled("Sign in to another Hazel"))
			.toExist()
			.fire(button("Continue"), "press")
			.expectNone()
		expect(typed.get(field("Web address")).props?.["error"]).toBe("Enter your workspace's web address")
		typed
			.fire(field("Web address"), "change", {
				value: "chat.acme.com",
				rev: 1,
				edit: TextField.empty.edit,
			})
			.fire(button("Continue"), "press")
			.expectExact(ChangeServer.make({ address: "chat.acme.com" }))
			.resolve(ChangeServer, SignInMessage.FailedServerChange({ problem: "NotHazel" }))
		expect(typed.get(field("Web address")).props?.["error"]).toBe(
			"No Hazel workspace answers at that address",
		)
		typed.fire(button("Use Hazel cloud"), "press").expectExact(UseDefaultServer.make({}))
	})
})
