// @vitest-environment jsdom
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast } from "../../data/actions"
import { onboardingHref, routeOfPath } from "../../route"
import {
	creatorMembership,
	invitedMembership,
	newcomer,
	onboardingAt,
	onboardingRoute,
	runningOf,
	withStep,
} from "../../test/pages-entry-fixtures"
import { makeShared, storyUpdate, userId } from "../../test/pages-fixtures"
import * as ChoiceBox from "../../ui/choice-box"
import { PageOutMessage } from "../out-message"
import {
	CompleteOnboarding,
	DebounceTimezoneQuery,
	LoadOnboardingHome,
	ReadBrowserTimezone,
	ReplaceOnboardingStepUrl,
	SendInvites,
	UpdateProfile,
	UpdateUserTimezone,
} from "./command"
import { Message } from "./message"
import { type InviteRow, type Model, StepState, stepOf } from "./model"
import { init, sharedChanged, update } from "./update"

/** The onboarding update loop: start-up, each step's form, and finalization. */

const run = storyUpdate(update, newcomer)
const urlFor = (step: string) => ReplaceOnboardingStepUrl({ href: onboardingHref(null, step) })
const urlDone = Message.CompletedReplaceStepUrl()
const errorOut = (title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: errorToast(title, description) })

const stepNameOf = (current: Model) => stepOf(runningOf(current).step)
const stepStateOf = (current: Model) => runningOf(current).step

describe("start-up", () => {
	test("an onboarded user is sent home once, and later shared changes do not redirect again", () => {
		const onboarded = makeShared()
		const started = init(onboardingRoute(null), onboarded)
		expect(started.outMessage).toEqual(
			PageOutMessage.RequestedNavigation({ route: routeOfPath("/"), replace: false }),
		)
		expect(started.model.phase._tag).toBe("Leaving")
		expect(started.commands?.map((command) => command.name)).toEqual([ReadBrowserTimezone.name])
		expect(sharedChanged(started.model, onboarded).outMessage).toBeUndefined()
	})

	test("the flow starts only once both the timezone and the membership are known", () => {
		story(
			run,
			given(init(onboardingRoute(null), newcomer).model),
			message(Message.DetectedBrowserTimezone({ browserTimezone: "Europe/Vienna" })),
			model((current) => expect(current.phase._tag).toBe("Starting")),
			message(Message.UpdatedMembership({ membership: creatorMembership })),
			Command.expectNone(),
			model((current) => {
				const running = runningOf(current)
				expect(running.flow).toEqual({
					userType: "creator",
					membership: creatorMembership,
					browserTimezone: "Europe/Vienna",
				})
				expect(running.step._tag).toBe("Welcome")
				expect(running.animatesStep).toBe(false)
			}),
		)
	})

	test("a membership with a slug runs the invited flow, which ignores a creator-only ?step=", () => {
		const invited = onboardingAt("useCases", invitedMembership)
		expect(runningOf(invited).flow.userType).toBe("invited")
		expect(stepNameOf(invited)).toBe("welcome")
		expect(stepNameOf(onboardingAt("useCases", creatorMembership))).toBe("useCases")
	})

	test("a later membership update keeps the flow and its user type, but the membership is current", () => {
		story(
			run,
			given(onboardingAt("themeSelection")),
			message(Message.UpdatedMembership({ membership: invitedMembership })),
			Command.expectNone(),
			model((current) => {
				expect(stepNameOf(current)).toBe("themeSelection")
				expect(runningOf(current).flow.userType).toBe("creator")
				expect(runningOf(current).flow.membership).toEqual(invitedMembership)
			}),
		)
	})

	test("Back on the first step stays put", () => {
		story(
			run,
			given(onboardingAt(null)),
			message(Message.ClickedBack()),
			Command.expectNone(),
			model((current) => expect(stepNameOf(current)).toBe("welcome")),
		)
	})
})

describe("profile step", () => {
	const profile = onboardingAt("profileInfo")
	const profileForm = (firstName: string, lastName: string, isSubmitting = false) =>
		withStep(profile, StepState.Profile({ firstName, lastName, hasChanged: false, isSubmitting }))

	test("the form is seeded from user.me and submits the trimmed names", () => {
		story(
			run,
			given(profile),
			model((current) =>
				expect(stepStateOf(current)).toMatchObject({ firstName: "Nora", lastName: "Newcomer" }),
			),
			message(Message.ChangedFirstName({ value: "  Ada " })),
			message(Message.SubmittedProfile()),
			Command.expectExact(UpdateProfile({ userId, firstName: "Ada", lastName: "Newcomer" })),
			model((current) => expect(stepStateOf(current)).toMatchObject({ isSubmitting: true })),
			Command.resolve(UpdateProfile, Message.SucceededUpdateProfile()),
			Command.expectExact(urlFor("timezoneSelection")),
			Command.resolve(ReplaceOnboardingStepUrl, urlDone),
			model((current) => {
				expect(stepNameOf(current)).toBe("timezoneSelection")
				expect(runningOf(current).direction).toBe("forward")
			}),
		)
	})

	test("an empty name is not submitted and marks the form as edited", () => {
		story(
			run,
			given(profileForm("", "Newcomer")),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
			model((current) =>
				expect(stepStateOf(current)).toMatchObject({ hasChanged: true, isSubmitting: false }),
			),
		)
	})

	test("a failed profile update re-enables the form and says why", () => {
		story(
			run,
			given(profile),
			message(Message.SubmittedProfile()),
			Command.resolve(UpdateProfile, Message.FailedUpdateProfile({ reason: "Offline" })),
			expectOutMessage(errorOut("Connection lost", "Check your internet connection and try again.")),
			model((current) => {
				expect(stepNameOf(current)).toBe("profileInfo")
				expect(stepStateOf(current)).toMatchObject({ isSubmitting: false })
			}),
		)
	})

	// SubmittedProfile is guarded on isSubmitting, so Enter while saving sends no second update.
	test("a submit while saving sends nothing", () => {
		story(
			run,
			given(profileForm("Nora", "Newcomer", true)),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
		)
	})

	// Validation trims, so "   " is not sent as a first name.
	test("a whitespace-only name is not submitted", () => {
		story(
			run,
			given(profile),
			message(Message.ChangedFirstName({ value: "   " })),
			message(Message.SubmittedProfile()),
			Command.expectNone(),
		)
	})

	test("a second profile success after the step moved on does not skip the timezone step", () => {
		story(
			run,
			given(profile),
			message(Message.SubmittedProfile()),
			Command.resolve(UpdateProfile, Message.SucceededUpdateProfile()),
			Command.resolve(ReplaceOnboardingStepUrl, urlDone),
			message(Message.SucceededUpdateProfile()),
			Command.expectNone(),
			model((current) => expect(stepNameOf(current)).toBe("timezoneSelection")),
		)
	})

	// Back then forward made a fresh form, and the earlier save's late success advanced it.
	test("Back waits while the profile is saving", () => {
		const saving = run(profile, Message.SubmittedProfile()).model
		const back = run(saving, Message.ClickedBack())
		expect(back.commands ?? []).toEqual([])
		expect(stepStateOf(back.model)).toMatchObject({ _tag: "Profile", isSubmitting: true })
		expect(stepNameOf(run(back.model, Message.SucceededUpdateProfile()).model)).toBe("timezoneSelection")
	})

	test("a profile success the form did not ask for is ignored", () => {
		story(
			run,
			given(profile),
			message(Message.SucceededUpdateProfile()),
			Command.expectNone(),
			model((current) => expect(stepNameOf(current)).toBe("profileInfo")),
		)
	})

	test("user.me arriving late seeds an untouched empty form", () => {
		const empty = profileForm("", "")
		expect(stepStateOf(sharedChanged(empty, newcomer).model)).toMatchObject({
			firstName: "Nora",
			lastName: "Newcomer",
		})
		const edited = withStep(
			profile,
			StepState.Profile({ firstName: "", lastName: "", hasChanged: true, isSubmitting: false }),
		)
		expect(stepStateOf(sharedChanged(edited, newcomer).model)).toMatchObject({
			firstName: "",
			lastName: "",
		})
	})
})

describe("timezone step", () => {
	const timezone = onboardingAt("timezoneSelection")
	const timezoneForm = (selected: string, isSubmitting = false) =>
		withStep(
			timezone,
			StepState.Timezone({
				selected,
				query: "",
				debouncedQuery: "",
				hoveredOffset: null,
				detectionAttempted: false,
				isSubmitting,
			}),
		)

	test("search is debounced, and a stale debounce is dropped", () => {
		story(
			run,
			given(timezone),
			message(Message.ChangedTimezoneQuery({ value: "vie" })),
			Command.resolve(
				DebounceTimezoneQuery({ query: "vie" }),
				Message.ElapsedTimezoneDebounce({ query: "vi" }),
			),
			model((current) =>
				expect(stepStateOf(current)).toMatchObject({ query: "vie", debouncedQuery: "" }),
			),
			message(Message.ChangedTimezoneQuery({ value: "vienna" })),
			Command.resolve(DebounceTimezoneQuery, Message.ElapsedTimezoneDebounce({ query: "vienna" })),
			model((current) => expect(stepStateOf(current)).toMatchObject({ debouncedQuery: "vienna" })),
		)
	})

	test("an offset without a city keeps the selection; Detect picks the browser timezone", () => {
		story(
			run,
			given(timezoneForm("Asia/Tokyo")),
			message(Message.ClickedOffset({ offset: 99 })),
			model((current) => expect(stepStateOf(current)).toMatchObject({ selected: "Asia/Tokyo" })),
			message(Message.ClickedDetectTimezone()),
			model((current) =>
				expect(stepStateOf(current)).toMatchObject({ selected: "UTC", detectionAttempted: true }),
			),
		)
	})

	test("Continue saves the timezone, records it and moves on", () => {
		story(
			run,
			given(timezone),
			message(Message.ClickedCity({ timezone: "Europe/Vienna" })),
			message(Message.ClickedContinueTimezone()),
			Command.expectExact(UpdateUserTimezone({ userId, timezone: "Europe/Vienna" })),
			Command.resolve(
				UpdateUserTimezone,
				Message.SucceededUpdateTimezone({ timezone: "Europe/Vienna" }),
			),
			Command.resolve(urlFor("themeSelection"), urlDone),
			model((current) => {
				expect(stepNameOf(current)).toBe("themeSelection")
				expect(runningOf(current).data.timezone).toBe("Europe/Vienna")
			}),
		)
	})

	test("a failed save re-enables Continue and says why", () => {
		story(
			run,
			given(timezone),
			message(Message.ClickedContinueTimezone()),
			Command.resolve(UpdateUserTimezone, Message.FailedUpdateTimezone({ reason: "UserNotFound" })),
			expectOutMessage(
				errorOut("User not found", "Your account could not be found. Please try signing in again."),
			),
			model((current) => expect(stepStateOf(current)).toMatchObject({ isSubmitting: false })),
		)
	})

	// ClickedContinueTimezone is guarded on isSubmitting, so a second press does not save twice.
	test("Continue while saving sends nothing", () => {
		story(
			run,
			given(timezoneForm("UTC", true)),
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
			model((current) => expect(stepNameOf(current)).toBe("themeSelection")),
		)
		story(
			run,
			given(onboardingAt("useCases")),
			message(Message.ClickedContinueTheme()),
			Command.expectNone(),
			model((current) => expect(stepNameOf(current)).toBe("useCases")),
		)
	})

	test("an invalid brand color is ignored", () => {
		story(
			run,
			given(onboardingAt("themeSelection")),
			message(Message.SelectedBrandColor({ hex: "green" })),
			expectNoOutMessage(),
		)
	})

	test("Continue without a team size does nothing; with one it records it", () => {
		const useCases = onboardingAt("useCases")
		story(
			run,
			given(useCases),
			message(Message.ClickedContinueChoice()),
			Command.expectNone(),
			model((current) => expect(stepNameOf(current)).toBe("useCases")),
		)
		story(
			run,
			given(
				withStep(
					useCases,
					StepState.UseCases({ box: ChoiceBox.init({ id: "team-size", selectedKeys: ["small"] }) }),
				),
			),
			message(Message.ClickedContinueChoice()),
			Command.resolve(urlFor("role"), urlDone),
			model((current) => {
				expect(runningOf(current).data.useCases).toEqual(["small"])
				expect(stepStateOf(current)).toMatchObject({ _tag: "Role", box: { selectedKeys: [] } })
			}),
		)
	})
})

describe("invite step and finalization", () => {
	const invite = onboardingAt("teamInvitation", creatorMembership)
	const rowsOf = (emails: ReadonlyArray<string>): ReadonlyArray<InviteRow> =>
		emails.map((email, id) => ({ id, email, error: Option.none() }))
	const inviteForm = (emails: ReadonlyArray<string>, isSending = false) =>
		withStep(invite, StepState.Invite({ rows: rowsOf(emails), nextRowId: emails.length, isSending }))
	const inviteRows = (current: Model) => {
		const step = stepStateOf(current)
		return step._tag === "Invite" ? step.rows : []
	}
	const completeFor = CompleteOnboarding({ memberId: creatorMembership.memberId, role: null, useCases: [] })

	test("adding, editing and removing rows keeps at least one field", () => {
		story(
			run,
			given(invite),
			message(Message.ClickedAddEmail()),
			message(Message.ChangedEmail({ rowId: 1, value: "grace@hazel.test" })),
			model((current) =>
				expect(inviteRows(current).map((row) => row.email)).toEqual(["", "grace@hazel.test"]),
			),
			message(Message.ClickedRemoveEmail({ rowId: 0 })),
			message(Message.ClickedRemoveEmail({ rowId: 1 })),
			model((current) => {
				expect(inviteRows(current).map((row) => row.email)).toEqual([""])
				expect(inviteRows(current)[0]?.id).toBe(2)
			}),
		)
	})

	test("Add stops at the limit, whatever the button shows", () => {
		const full = inviteForm(Array.from({ length: 10 }, () => ""))
		story(
			run,
			given(full),
			message(Message.ClickedAddEmail()),
			model((current) => expect(inviteRows(current)).toHaveLength(10)),
		)
	})

	test("valid addresses are sent; full success toasts and finalizes", () => {
		const emails = ["grace@hazel.test", "alan@hazel.test"]
		story(
			run,
			given(inviteForm([...emails, " "])),
			message(Message.ClickedContinueInvite()),
			Command.expectExact(SendInvites({ organizationId: creatorMembership.organizationId, emails })),
			model((current) => expect(stepStateOf(current)).toMatchObject({ isSending: true })),
			Command.resolve(SendInvites, Message.SucceededSendInvites({ emails, failedCount: 0 })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Sent 2 invitations", description: null },
				}),
			),
			Command.expectExact(urlFor("finalization"), completeFor),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[CompleteOnboarding, Message.SucceededCompleteOnboarding()],
			),
			Command.expectExact(urlFor("completed"), LoadOnboardingHome({ href: "/" })),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[LoadOnboardingHome, Message.CompletedLoadHome()],
			),
			model((current) => expect(stepNameOf(current)).toBe("completed")),
		)
	})

	test("a partial failure warns with the counts", () => {
		const emails = ["a@hazel.test", "b@hazel.test", "c@hazel.test"]
		story(
			run,
			given(inviteForm(emails, true)),
			message(Message.SucceededSendInvites({ emails, failedCount: 2 })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "warning", title: "Sent 1 invitation, 2 failed", description: null },
				}),
			),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[CompleteOnboarding, Message.SucceededCompleteOnboarding()],
			),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[LoadOnboardingHome, Message.CompletedLoadHome()],
			),
		)
	})

	test("a failed finalize stops the spinner and Try again finalizes again", () => {
		story(
			run,
			given(inviteForm([])),
			message(Message.ClickedContinueInvite()),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[CompleteOnboarding, Message.FailedCompleteOnboarding({ reason: "Unavailable" })],
			),
			model((current) =>
				expect(stepStateOf(current)).toEqual(
					StepState.Finalizing({ failure: Option.some("Unavailable") }),
				),
			),
			message(Message.ClickedBack()),
			Command.expectNone(),
			message(Message.ClickedRetryFinalize()),
			Command.expectExact(completeFor),
			model((current) => {
				expect(stepStateOf(current)).toEqual(StepState.Finalizing({ failure: Option.none() }))
				// A second press while it runs sends nothing.
				expect(run(current, Message.ClickedRetryFinalize()).commands ?? []).toEqual([])
			}),
			Command.resolve(CompleteOnboarding, Message.SucceededCompleteOnboarding()),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[LoadOnboardingHome, Message.CompletedLoadHome()],
			),
			model((current) => expect(stepNameOf(current)).toBe("completed")),
		)
	})

	test("without an active organization nothing is sent and the form stays open", () => {
		story(
			run,
			given(
				withStep(
					onboardingAt("teamInvitation"),
					StepState.Invite({ rows: rowsOf(["grace@hazel.test"]), nextRowId: 1, isSending: false }),
				),
			),
			message(Message.ClickedContinueInvite()),
			Command.expectNone(),
			expectOutMessage(errorOut("No active organization")),
			model((current) => expect(stepStateOf(current)).toMatchObject({ isSending: false })),
		)
	})

	test("when every invitation fails the form unlocks", () => {
		story(
			run,
			given(inviteForm(["grace@hazel.test"], true)),
			message(Message.FailedSendInvites({ reason: "AllFailed" })),
			expectOutMessage(errorOut("Failed to send invitations")),
			model((current) => expect(stepStateOf(current)).toMatchObject({ isSending: false })),
		)
	})

	// Continue is guarded on isSending, so a second press while sending does not invite twice.
	test("Continue while sending sends nothing", () => {
		story(
			run,
			given(inviteForm(["grace@hazel.test"], true)),
			message(Message.ClickedContinueInvite()),
			Command.expectNone(),
		)
	})

	test("an invalid address is flagged on its own row", () => {
		story(
			run,
			given(inviteForm(["", "grace@"])),
			message(Message.ClickedContinueInvite()),
			Command.expectNone(),
			model((current) =>
				expect(inviteRows(current).map((row) => row.error)).toEqual([
					Option.none(),
					Option.some("InvalidEmail"),
				]),
			),
		)
	})

	test("removing a row keeps every other row's error with its row", () => {
		story(
			run,
			given(inviteForm(["bad@", "ok@hazel.test", "worse@"])),
			message(Message.ClickedContinueInvite()),
			message(Message.ClickedRemoveEmail({ rowId: 0 })),
			model((current) =>
				expect(inviteRows(current)).toEqual([
					{ id: 1, email: "ok@hazel.test", error: Option.none() },
					{ id: 2, email: "worse@", error: Option.some("InvalidEmail") },
				]),
			),
		)
	})

	test("an invited member finalizes with their member id and lands in the org", () => {
		const role = withStep(
			onboardingAt("role", invitedMembership),
			StepState.Role({ box: ChoiceBox.init({ id: "role", selectedKeys: ["developer"] }) }),
		)
		story(
			run,
			given(role),
			message(Message.ClickedContinueChoice()),
			Command.expectExact(
				urlFor("finalization"),
				CompleteOnboarding({ memberId: invitedMembership.memberId, role: "developer", useCases: [] }),
			),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[CompleteOnboarding, Message.SucceededCompleteOnboarding()],
			),
			Command.expectHas(LoadOnboardingHome({ href: "/hazel" })),
			Command.resolveAll(
				[ReplaceOnboardingStepUrl, urlDone],
				[LoadOnboardingHome, Message.CompletedLoadHome()],
			),
		)
	})

	test("finishing the flow is not cut short by user.me turning onboarded", () => {
		const finalizing = withStep(invite, StepState.Finalizing({ failure: Option.none() }))
		expect(sharedChanged(finalizing, makeShared()).outMessage).toBeUndefined()
	})
})
