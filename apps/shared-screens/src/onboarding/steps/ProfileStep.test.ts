// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../app/requests"
import { button, field, signedIn } from "../testing/locators"
import { OnboardingStepEvents } from "./OnboardingStep"
import { ProfileFormMessage, ProfileFormNoDeps, UpdateProfile } from "./ProfileStep"

/** The profile step: names from `user.me`, saved through `user.update`, then the shell moves on. */

const start = (session = signedIn) => Scene.start(ProfileFormNoDeps, { session })
const edit = (value: string, edit = 1) => ({ value, rev: 1, edit })

describe("profile step", () => {
	test("starts from the session's names and saves them", () => {
		const s = start()
		expect(s.get(field("First name")).props?.["value"]).toMatchObject({ text: "Ada" })
		s.fire(button("Continue →"), "press").expectExact(
			UpdateProfile.make({ userId: signedIn.user!.id, firstName: "Ada", lastName: "Lovelace" }),
		)
		expect(s.get(button("Continue →")).props).toMatchObject({ loading: true, disabled: true })
		s.resolve(UpdateProfile, ProfileFormMessage.SucceededUpdateProfile()).emitted(
			OnboardingStepEvents.Continued({ patch: {} }),
		)
	})

	test("an emptied name is required, and Continue waits for it", () => {
		const s = start().fire(field("First name"), "change", edit("  "))
		expect(s.get(field("First name")).props?.["error"]).toBe("First name is required")
		expect(s.get(button("Continue →")).props?.["disabled"]).toBe(true)
		s.fire(field("First name"), "change", edit("Augusta"))
			.fire(field("First name"), "submit", edit("Augusta"))
			.expectExact(
				UpdateProfile.make({ userId: signedIn.user!.id, firstName: "Augusta", lastName: "Lovelace" }),
			)
	})

	test("a failed save says why and lets the user try again", () => {
		const s = start()
			.fire(button("Continue →"), "press")
			.resolve(UpdateProfile, ProfileFormMessage.FailedUpdateProfile({ reason: "UserNotFound" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "User not found",
						description: "Your account could not be found. Please try signing in again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(button("Continue →")).props?.["loading"]).toBeUndefined()
	})

	test("Back asks the shell for the previous step", () => {
		start().fire(button("← Back"), "press").emitted(OnboardingStepEvents.RequestedBack())
	})
})
