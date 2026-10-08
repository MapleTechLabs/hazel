// @vitest-environment jsdom
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, storyUpdate, userId } from "../../test/pages-fixtures"
import {
	creatorMembership,
	invitedMembership,
	newcomer,
	onboardingAt,
	onboardingRoute,
	withForm,
} from "../../test/pages-entry-fixtures"
import { onboardingHref } from "../../route"
import * as ChoiceBox from "../../ui/choice-box"
import { PageOutMessage } from "../out-message"
import {
	CompleteOnboarding,
	DebounceTimezoneQuery,
	LoadHome,
	ReadBrowserTimezone,
	ReplaceStepUrl,
	SendInvites,
	UpdateProfile,
	UpdateTimezone,
} from "./command"
import { Message } from "./message"
import { StepForm } from "./model"
import { init, sharedChanged, update } from "./update"

/** The onboarding update loop: start-up, each step's form, and finalization. */

const run = storyUpdate(update, newcomer)
const urlFor = (step: string) => ReplaceStepUrl({ href: onboardingHref(null, step) })
const urlDone = Message.CompletedReplaceStepUrl()
const errorToast = (title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } })

describe("start-up", () => {
	test("an onboarded user is sent home once, and later shared changes do not redirect again", () => {
		const onboarded = makeShared()
		const started = init(onboardingRoute(null), onboarded)
		expect(started.outMessage).toEqual(PageOutMessage.RequestedNavigation({ href: "/", replace: false }))
		expect(started.commands?.map((command) => command.name)).toEqual([ReadBrowserTimezone.name])
		expect(sharedChanged(started.model, onboarded).outMessage).toBeUndefined()
	})

	test("the flow starts only once both the timezone and the membership are known", () => {
		story(
			run,
			given(init(onboardingRoute(null), newcomer).model),
			message(Message.GotBrowserTimezone({ browserTimezone: "Europe/Vienna" })),
			model((current) => expect(current.isInitialized).toBe(false)),
			message(Message.UpdatedMembership({ membership: creatorMembership })),
			Command.expectNone(),
			model((current) => {
				expect(current.isInitialized).toBe(true)
				expect(current.userType).toBe("creator")
				expect(current.step).toBe("welcome")
				expect(current.animatesStep).toBe(false)
			}),
		)
	})

	test("a membership with a slug runs the invited flow, which ignores a creator-only ?step=", () => {
		const invited = onboardingAt("useCases", invitedMembership)
		expect(invited.userType).toBe("invited")
		expect(invited.step).toBe("welcome")
		expect(onboardingAt("useCases", creatorMembership).step).toBe("useCases")
	})

	test("a later membership update does not restart the flow", () => {
		story(
			run,
			given(onboardingAt("themeSelection")),
			message(Message.UpdatedMembership({ membership: invitedMembership })),
			Command.expectNone(),
			model((current) => {
				expect(current.step).toBe("themeSelection")
				expect(current.userType).toBe("creator")
			}),
		)
	})

	test("Back on the first step stays put", () => {
		story(run, given(onboardingAt(null)), message(Message.ClickedBack()), Command.expectNone(), model((current) => expect(current.step).toBe("welcome")))
	})
})

describe("profile step", () => {
	const profile = onboardingAt("profileInfo")

	test("the form is seeded from user.me and submits the trimmed names", () => {
		story(
			run,
			given(profile),
			model((current) => expect(current.form).toMatchObject({ firstName: "Nora", lastName: "Newcomer" })),
			message(Message.ChangedFirstName({ value: "  Ada " })),
			message(Message.SubmittedProfile()),
			Command.expectExact(UpdateProfile({ firstName: "Ada", lastName: "Newcomer" })),
			model((current) => expect(current.form).toMatchObject({ isSubmitting: true })),
			Command.resolve(UpdateProfile, Message.SucceededUpdateProfile()),
			Command.expectExact(urlFor("timezoneSelection")),
			Command.resolve(ReplaceStepUrl, urlDone),
			model((current) => {
				expect(current.step).toBe("timezoneSelection")
				expect(current.direction).toBe("forward")
			}),
		)
	})

	test("an empty name is not submitted and marks the form as edited", () => {
		story(
			run,
			given(withForm(profile, StepForm.Profile({ firstName: "", lastName: "Newcomer", hasChanged: false, isSubmitting: false }))),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
			model((current) => expect(current.form).toMatchObject({ hasChanged: true, isSubmitting: false })),
		)
	})

	test("a failed Clerk update re-enables the form and toasts", () => {
		story(
			run,
			given(profile),
			message(Message.SubmittedProfile()),
			Command.resolve(UpdateProfile, Message.FailedUpdateProfile()),
			expectOutMessage(errorToast("Failed to update profile")),
			model((current) => {
				expect(current.step).toBe("profileInfo")
				expect(current.form).toMatchObject({ isSubmitting: false })
			}),
		)
	})

	// SubmittedProfile is guarded on isSubmitting, so Enter while saving sends no second update.
	test("a submit while saving sends nothing", () => {
		story(
			run,
			given(withForm(profile, StepForm.Profile({ firstName: "Nora", lastName: "Newcomer", hasChanged: false, isSubmitting: true }))),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
		)
	})

	// Validation trims, so "   " is not sent to Clerk as a first name.
	test("a whitespace-only name is not submitted", () => {
		story(run, given(profile), message(Message.ChangedFirstName({ value: "   " })), message(Message.SubmittedProfile()), Command.expectNone())
	})

	test("a second profile success after the step moved on does not skip the timezone step", () => {
		story(
			run,
			given(profile),
			message(Message.SubmittedProfile()),
			Command.resolve(UpdateProfile, Message.SucceededUpdateProfile()),
			Command.resolve(ReplaceStepUrl, urlDone),
			message(Message.SucceededUpdateProfile()),
			Command.expectNone(),
			model((current) => expect(current.step).toBe("timezoneSelection")),
		)
	})

	test("user.me arriving late seeds an untouched empty form", () => {
		const empty = withForm(profile, StepForm.Profile({ firstName: "", lastName: "", hasChanged: false, isSubmitting: false }))
		expect(sharedChanged(empty, newcomer).model.form).toMatchObject({ firstName: "Nora", lastName: "Newcomer" })
		const edited = withForm(profile, StepForm.Profile({ firstName: "", lastName: "", hasChanged: true, isSubmitting: false }))
		expect(sharedChanged(edited, newcomer).model.form).toMatchObject({ firstName: "", lastName: "" })
	})
})

describe("timezone step", () => {
	const timezone = onboardingAt("timezoneSelection")

	test("search is debounced, and a stale debounce is dropped", () => {
		story(
			run,
			given(timezone),
			message(Message.ChangedTimezoneQuery({ value: "vie" })),
			Command.resolve(DebounceTimezoneQuery({ query: "vie" }), Message.ElapsedTimezoneDebounce({ query: "vi" })),
			model((current) => expect(current.form).toMatchObject({ query: "vie", debouncedQuery: "" })),
			message(Message.ChangedTimezoneQuery({ value: "vienna" })),
			Command.resolve(DebounceTimezoneQuery, Message.ElapsedTimezoneDebounce({ query: "vienna" })),
			model((current) => expect(current.form).toMatchObject({ debouncedQuery: "vienna" })),
		)
	})

	test("an offset without a city keeps the selection; Detect picks the browser timezone", () => {
		story(
			run,
			given(withForm(timezone, StepForm.Timezone({ selected: "Asia/Tokyo", query: "", debouncedQuery: "", hoveredOffset: null, detectionAttempted: false, isSubmitting: false }))),
			message(Message.ClickedOffset({ offset: 99 })),
			model((current) => expect(current.form).toMatchObject({ selected: "Asia/Tokyo" })),
			message(Message.ClickedDetectTimezone()),
			model((current) => expect(current.form).toMatchObject({ selected: "UTC", detectionAttempted: true })),
		)
	})

	test("Continue saves the timezone, records it and moves on", () => {
		story(
			run,
			given(timezone),
			message(Message.ClickedCity({ timezone: "Europe/Vienna" })),
			message(Message.ClickedContinueTimezone()),
			Command.expectExact(UpdateTimezone({ userId, timezone: "Europe/Vienna" })),
			Command.resolve(UpdateTimezone, Message.SucceededUpdateTimezone({ timezone: "Europe/Vienna" })),
			Command.resolve(urlFor("themeSelection"), urlDone),
			model((current) => {
				expect(current.step).toBe("themeSelection")
				expect(current.data.timezone).toBe("Europe/Vienna")
			}),
		)
	})

	test("a failed save re-enables Continue and shows the server's reason", () => {
		story(
			run,
			given(timezone),
			message(Message.ClickedContinueTimezone()),
			Command.resolve(UpdateTimezone, Message.FailedUpdateTimezone({ title: "User not found", description: "Sign in again." })),
			expectOutMessage(errorToast("User not found", "Sign in again.")),
			model((current) => expect(current.form).toMatchObject({ isSubmitting: false })),
		)
	})

	// ClickedContinueTimezone is guarded on isSubmitting, so a second press does not save twice.
	test("Continue while saving sends nothing", () => {
		story(
			run,
			given(withForm(timezone, StepForm.Timezone({ selected: "UTC", query: "", debouncedQuery: "", hoveredOffset: null, detectionAttempted: false, isSubmitting: true }))),
			message(Message.ClickedContinueTimezone()),
			Command.expectNone(),
		)
	})
})

describe("theme and choice steps", () => {
	test("a timezone success or theme Continue off their step does nothing", () => {
		story(
			run,
			given(onboardingAt("themeSelection")),
			message(Message.SucceededUpdateTimezone({ timezone: "UTC" })),
			Command.expectNone(),
			model((current) => expect(current.step).toBe("themeSelection")),
		)
		story(
			run,
			given(onboardingAt("useCases")),
			message(Message.ClickedContinueTheme()),
			Command.expectNone(),
			model((current) => expect(current.step).toBe("useCases")),
		)
	})

	test("an invalid brand color is ignored", () => {
		story(run, given(onboardingAt("themeSelection")), message(Message.SelectedBrandColor({ hex: "green" })), expectNoOutMessage())
	})

	test("Continue without a team size does nothing; with one it records it", () => {
		const useCases = onboardingAt("useCases")
		story(run, given(useCases), message(Message.ClickedContinueChoice()), Command.expectNone(), model((current) => expect(current.step).toBe("useCases")))
		story(
			run,
			given(withForm(useCases, StepForm.Choice({ box: ChoiceBox.init({ id: "team-size", selectedKeys: ["small"] }) }))),
			message(Message.ClickedContinueChoice()),
			Command.resolve(urlFor("role"), urlDone),
			model((current) => {
				expect(current.data.useCases).toEqual(["small"])
				expect(current.form).toMatchObject({ box: { selectedKeys: [] } })
			}),
		)
	})
})

describe("invite step and finalization", () => {
	const invite = onboardingAt("teamInvitation")
	const inviteForm = (emails: ReadonlyArray<string>, isLoading = false) =>
		withForm(invite, StepForm.Invite({ emails: [...emails], errors: {}, isLoading }))

	test("adding, editing and removing rows keeps at least one field", () => {
		story(
			run,
			given(invite),
			message(Message.ClickedAddEmail()),
			message(Message.ChangedEmail({ index: 1, value: "grace@hazel.test" })),
			model((current) => expect(current.form).toMatchObject({ emails: ["", "grace@hazel.test"] })),
			message(Message.ClickedRemoveEmail({ index: 0 })),
			message(Message.ClickedRemoveEmail({ index: 0 })),
			model((current) => expect(current.form).toMatchObject({ emails: [""] })),
		)
	})

	test("valid addresses are sent; full success toasts and finalizes with them", () => {
		const emails = ["grace@hazel.test", "alan@hazel.test"]
		story(
			run,
			given(inviteForm([...emails, " "])),
			message(Message.ClickedContinueInvite()),
			Command.expectExact(SendInvites({ emails })),
			model((current) => expect(current.form).toMatchObject({ isLoading: true })),
			Command.resolve(SendInvites, Message.SucceededSendInvites({ emails, failedCount: 0 })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: { intent: "success", title: "Sent 2 invitations", description: null } })),
			Command.expectExact(urlFor("finalization"), CompleteOnboarding),
			Command.resolveAll([ReplaceStepUrl, urlDone], [CompleteOnboarding, Message.SucceededCompleteOnboarding()]),
			Command.expectExact(urlFor("completed"), LoadHome({ href: "/" })),
			Command.resolveAll([ReplaceStepUrl, urlDone], [LoadHome, Message.CompletedLoadHome()]),
			model((current) => {
				expect(current.step).toBe("completed")
			}),
		)
	})

	test("a partial failure warns with the counts", () => {
		story(
			run,
			given(inviteForm(["a@hazel.test", "b@hazel.test", "c@hazel.test"], true)),
			message(Message.SucceededSendInvites({ emails: ["a@hazel.test", "b@hazel.test", "c@hazel.test"], failedCount: 2 })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: { intent: "warning", title: "Sent 1 invitation, 2 failed", description: null } })),
			Command.resolveAll([ReplaceStepUrl, urlDone], [CompleteOnboarding, Message.FailedCompleteOnboarding({ error: "Failed to finalize onboarding" })]),
			model((current) => {
				expect(current.step).toBe("finalization")
				expect(current.error).toBe("Failed to finalize onboarding")
			}),
		)
	})

	test("without an active organization the send fails and the form unlocks", () => {
		story(
			run,
			given(inviteForm(["grace@hazel.test"], true)),
			message(Message.FailedSendInvites({ reason: "NoOrganization" })),
			expectOutMessage(errorToast("No active organization")),
			model((current) => expect(current.form).toMatchObject({ isLoading: false })),
		)
	})

	// Continue is guarded on isLoading, so a second press while sending does not invite twice.
	test("Continue while sending sends nothing", () => {
		story(run, given(inviteForm(["grace@hazel.test"], true)), message(Message.ClickedContinueInvite()), Command.expectNone())
	})

	// Bug (inherited from legacy): finalization re-invites the addresses SendInvites already invited.
	test.fails("finalization does not re-send invitations the step already sent", () => {
		story(
			run,
			given(inviteForm(["grace@hazel.test"], true)),
			message(Message.SucceededSendInvites({ emails: ["grace@hazel.test"], failedCount: 0 })),
			Command.expectHas(CompleteOnboarding({ memberId: null, role: null, useCases: [], emails: [] })),
			Command.resolveAll([ReplaceStepUrl, urlDone], [CompleteOnboarding, Message.FailedCompleteOnboarding({ error: "x" })]),
		)
	})

	// Errors are keyed by row index, which is how the view reads them.
	test("an invalid address is flagged on its own row", () => {
		story(
			run,
			given(inviteForm(["", "grace@"])),
			message(Message.ClickedContinueInvite()),
			model((current) => expect("errors" in current.form && current.form.errors).toEqual({ "1": "Please enter a valid email address" })),
		)
	})

	test("removing a row moves the errors of later rows up with them", () => {
		story(
			run,
			given(inviteForm(["bad@", "ok@hazel.test", "worse@"])),
			message(Message.ClickedContinueInvite()),
			model((current) => expect(current.form).toMatchObject({ errors: { "0": "Please enter a valid email address", "2": "Please enter a valid email address" } })),
			message(Message.ClickedRemoveEmail({ index: 0 })),
			model((current) => {
				expect(current.form).toMatchObject({ emails: ["ok@hazel.test", "worse@"] })
				expect("errors" in current.form && current.form.errors).toEqual({ "1": "Please enter a valid email address" })
			}),
		)
	})

	test("an invited member finalizes with their member id and lands in the org", () => {
		const role = withForm(onboardingAt("role", invitedMembership), StepForm.Choice({ box: ChoiceBox.init({ id: "role", selectedKeys: ["developer"] }) }))
		story(
			run,
			given(role),
			message(Message.ClickedContinueChoice()),
			Command.expectExact(urlFor("finalization"), CompleteOnboarding({ memberId: invitedMembership.memberId, role: "developer", useCases: [], emails: [] })),
			Command.resolveAll([ReplaceStepUrl, urlDone], [CompleteOnboarding, Message.SucceededCompleteOnboarding()]),
			Command.expectHas(LoadHome({ href: "/hazel" })),
			Command.resolveAll([ReplaceStepUrl, urlDone], [LoadHome, Message.CompletedLoadHome()]),
		)
	})
})
