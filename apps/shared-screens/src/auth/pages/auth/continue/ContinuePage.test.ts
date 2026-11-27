// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Scene } from "@effect/ui/testing"
import { describe, test } from "vitest"
import { link, screenTitled, textOf } from "../../../testing/locators"
import { ContinueMessage, ContinuePageNoDeps, ContinueSignIn } from "./ContinuePage"

/** A just-linked provider account signs in once more; a bad link or a failure says so. */

const start = (provider: string | null) =>
	Scene.start(ContinuePageNoDeps, { provider, signInHref: "/sign-in" })

describe("continue page", () => {
	test("signs in again with the linked provider as it opens", () => {
		start("github")
			.expectExact(ContinueSignIn.make({ provider: "github" }))
			.expect(screenTitled("Your accounts are linked"))
			.toExist()
			.resolve(ContinueSignIn, ContinueMessage.LeftForProvider())
	})

	test("an unknown provider can't continue", () => {
		start("myspace")
			.expect(screenTitled("Couldn't finish signing in"))
			.toExist()
			.expect(link("Back to sign in"))
			.toExist()
	})

	test("a failure says why; an account that only needs a sign-in is not one", () => {
		start("google")
			.resolve(ContinueSignIn, ContinueMessage.FailedSignIn({ reason: "Offline" }))
			.expect(textOf("Connection lost. Check your internet connection and try again."))
			.toExist()
		start("google")
			.resolve(ContinueSignIn, ContinueMessage.FailedSignIn({ reason: "AccountCreated" }))
			.expect(screenTitled("Your account is ready"))
			.toExist()
			.expect(link("Sign in"))
			.toExist()
	})
})
