// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { describe, test } from "vitest"
import { Navigate } from "../../../app/requests"
import type { Membership } from "../../domain/OnboardingFlow"
import { OnboardingStepEvents } from "../../steps/OnboardingStep"
import { ProfileForm } from "../../steps/ProfileStep"
import { ada, byProp, button, invitedTo, signedIn } from "../../testing/locators"
import { OnboardingMessage, OnboardingPageNoDeps, ReadBrowserTimezone } from "./OnboardingPage"

/** The flow shell: it picks the flow, draws its own steps, leaves the rest to the host, keeps the URL. */

const start = (urlStep: string | null = null, session = signedIn) =>
	Scene.start(OnboardingPageNoDeps, { session, urlStep, orgId: null })
		.expectExact(ReadBrowserTimezone.make({}))
		.resolve(
			ReadBrowserTimezone,
			OnboardingMessage.CompletedReadBrowserTimezone({ browserTimezone: "Europe/London" }),
		)

const membership = (value: Membership | null) => OnboardingMessage.UpdatedMembership({ membership: value })
const membershipKey = `membership:"${ada.id}"`

const loading = byProp("progress", "label", "Loading...")
const heading = (text: string) => Locator.text(text)

describe("onboarding shell", () => {
	test("waits for the time zone and the membership before it picks a flow", () => {
		Scene.start(OnboardingPageNoDeps, { session: signedIn, urlStep: null, orgId: null })
			.expect(loading)
			.toExist()
			.expectExact(ReadBrowserTimezone.make({}))
			.resolve(
				ReadBrowserTimezone,
				OnboardingMessage.CompletedReadBrowserTimezone({ browserTimezone: "Europe/London" }),
			)
			.expect(loading)
			.toExist()
			.subscription(membershipKey, membership(invitedTo))
			.expect(loading)
			.toBeAbsent()
			.expect(button("Get started →"))
			.toExist()
	})

	test("an invited user continues from welcome to profile, and the URL follows", () => {
		start()
			.subscription(membershipKey, membership(invitedTo))
			.expect(heading("Welcome to Hazel Labs!"))
			.toExist()
			.fire(button("Get started →"), "press")
			.expectExact(Navigate.make({ href: "/onboarding?step=profileInfo", replace: true }))
			.resolve(Navigate, Component.noop)
			.expect(button("Get started →"))
			.toBeAbsent()
	})

	test("the URL's step opens the flow there; the profile's Continue goes to a step the host draws", () => {
		start("profileInfo")
			.subscription(membershipKey, membership(null))
			.childEmit(ProfileForm, "profile", OnboardingStepEvents.Continued({ patch: {} }))
			.expectExact(Navigate.make({ href: "/onboarding?step=timezoneSelection", replace: true }))
			.resolve(Navigate, Component.noop)
	})

	test("Back from the profile returns to welcome", () => {
		start("profileInfo")
			.subscription(membershipKey, membership(invitedTo))
			.childEmit(ProfileForm, "profile", OnboardingStepEvents.RequestedBack())
			.expectExact(Navigate.make({ href: "/onboarding?step=welcome", replace: true }))
			.resolve(Navigate, Component.noop)
			.expect(button("Get started →"))
			.toExist()
	})

	test("a step the host draws moves the flow through the URL", () => {
		start("themeSelection")
			.subscription(membershipKey, membership(invitedTo))
			.expect(button("Get started →"))
			.toBeAbsent()
			.props((props) => ({ ...props, urlStep: "profileInfo" }))
			.subscription('urlStep:"profileInfo"', OnboardingMessage.ChangedUrlStep({ step: "profileInfo" }))
			.expectNone()
	})

	test("a step outside the user's flow starts on welcome", () => {
		start("import")
			.subscription(membershipKey, membership(invitedTo))
			.expect(button("Get started →"))
			.toExist()
	})

	test("an onboarded user is sent to the app", () => {
		start(null, { ...signedIn, user: { ...ada, isOnboarded: true } })
			.subscription("onboarded", OnboardingMessage.FoundOnboardedUser())
			.expectExact(Navigate.make({ href: "/", replace: false }))
			.resolve(Navigate, Component.noop)
	})
})
