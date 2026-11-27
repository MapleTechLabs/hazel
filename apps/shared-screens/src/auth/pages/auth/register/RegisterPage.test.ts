// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Scene } from "@effect/ui/testing"
import { TextField } from "@hazel/ui/vocabulary/index"
import { describe, expect, test } from "vitest"
import { button, field, link, screenTitled, textOf } from "../../../testing/locators"
import { Register, RegisterMessage, RegisterPageNoDeps } from "./RegisterPage"

/** A verified identity with no account picks a name; a link missing the callback's details can't. */

const start = (flowId: string | null = "flow-1", reference: string | null = "ref-1") =>
	Scene.start(RegisterPageNoDeps, { flowId, reference, signInHref: "/sign-in" })

const typed = (value: string) => ({ value, rev: 1, edit: TextField.empty.edit })

describe("register page", () => {
	test("a link without the callback's details is broken and leads back to sign-in", () => {
		const s = start(null).expect(screenTitled("This sign-up link doesn't work")).toExist()
		expect(s.get(link("Back to sign in")).props?.["href"]).toBe("/sign-in")
	})

	test("a missing first name blocks the submit and shows only from then on", () => {
		const s = start().expect(screenTitled("Welcome to Hazel")).toExist()
		expect(s.get(field("First name")).props?.["error"]).toBeUndefined()
		s.fire(button("Continue"), "press").expectNone()
		expect(s.get(field("First name")).props?.["error"]).toBe("Enter your first name")
	})

	test("creates the account with the names; a failure says why and offers a new start", () => {
		const s = start()
			.fire(field("First name"), "change", typed("Ada"))
			.fire(field("Last name"), "change", typed("Lovelace"))
			.fire(field("Last name"), "submit", typed("Lovelace"))
			.expectExact(
				Register.make({
					flowId: "flow-1",
					reference: "ref-1",
					firstName: "Ada",
					lastName: "Lovelace",
				}),
			)
		expect(s.get(button("Creating your account...")).props).toMatchObject({
			loading: true,
			disabled: true,
		})
		s.resolve(Register, RegisterMessage.FailedRegistration({ reason: "Expired" }))
			.expect(textOf("That sign-in expired or was already used. Please start again."))
			.toExist()
			.expect(link("Start sign-in again"))
			.toExist()
	})
})
