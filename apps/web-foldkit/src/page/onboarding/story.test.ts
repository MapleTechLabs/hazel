// @vitest-environment jsdom
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast, successToast, warningToast } from "../../data/actions"
import { AppRoute } from "../../route"
import type { ToastRequest } from "../../overlay/toasts"
import {
	creatorMembership,
	invitedMembership,
	newcomer,
	onboardingAt,
	onboardingRoute,
	runningOf,
	withStep,
} from "../../test/pages-entry-fixtures"
import { storyUpdate, userId } from "../../test/pages-fixtures"
import * as ChoiceBox from "../../ui/choice-box"
import { PageOutMessage } from "../out-message"
import {
	CompleteOnboarding,
	DebounceTimezoneQuery,
	ClearOnboardingAnswers,
	LoadOnboardingHome,
	SendInvites,
	UpdateUserTimezone,
} from "./command"
import { Message } from "./message"
import { type InviteRow, type Model, StepState, stepOf } from "./model"
import { init, routeChanged, update } from "./update"

/** The onboarding update loop: start-up, each step's form, and finalization. */

const run = storyUpdate(update, newcomer)
/** A step change: the URL through the root, which the native shell follows. */
const nav = (step: string, toast?: ToastRequest) => {
	const route = AppRoute.Onboarding({ orgId: Option.none(), step: Option.some(step) })
	return toast === undefined
		? PageOutMessage.RequestedNavigation({ route, replace: true })
		: PageOutMessage.RequestedNavigation({ route, replace: true, toast })
}
const errorOut = (title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: errorToast(title, description) })

const stepNameOf = (current: Model) => stepOf(runningOf(current).step)
const stepStateOf = (current: Model) => runningOf(current).step

describe("start-up", () => {
	test("the shell's move reaches the page as a route change, which writes no URL", () => {
		const welcome = onboardingAt(null)
		const moved = routeChanged(welcome, onboardingRoute("timezoneSelection"))
		expect(moved.outMessage).toBeUndefined()
		expect(stepNameOf(moved.model)).toBe("timezoneSelection")
		expect(routeChanged(moved.model, onboardingRoute("timezoneSelection")).model).toEqual(moved.model)
		expect(stepNameOf(routeChanged(moved.model, onboardingRoute("nowhere")).model)).toBe(
			"timezoneSelection",
		)
	})

	test("the flow starts only once both the timezone and the membership are known", () => {
		story(
			run,
			given(init(onboardingRoute(null)).model),
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
				expect(running.step).toEqual(StepState.Native({ step: "welcome" }))
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

describe("the shell's steps", () => {
	test("Back from the time zone step moves the URL to the profile, which the shell draws", () => {
		story(
			run,
			given(onboardingAt("timezoneSelection")),
			message(Message.ClickedBack()),
			Command.expectNone(),
			expectOutMessage(nav("profileInfo")),
			model((current) =>
				expect(stepStateOf(current)).toEqual(StepState.Native({ step: "profileInfo" })),
			),
		)
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
			expectOutMessage(nav("themeSelection")),
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
			expectOutMessage(nav("role")),
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
			// One update, one OutMessage: the toast goes with the step's navigation.
			expectOutMessage(nav("finalization", successToast("Sent 2 invitations"))),
			Command.expectExact(completeFor),
			Command.resolve(CompleteOnboarding, Message.SucceededCompleteOnboarding()),
			expectOutMessage(nav("completed")),
			Command.expectExact(LoadOnboardingHome({ href: "/" }), ClearOnboardingAnswers()),
			Command.resolveAll(
				[LoadOnboardingHome, Message.CompletedLoadHome()],
				[ClearOnboardingAnswers, Message.CompletedStoreAnswers()],
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
			expectOutMessage(nav("finalization", warningToast("Sent 1 invitation, 2 failed"))),
			Command.resolve(CompleteOnboarding, Message.SucceededCompleteOnboarding()),
			Command.resolveAll(
				[LoadOnboardingHome, Message.CompletedLoadHome()],
				[ClearOnboardingAnswers, Message.CompletedStoreAnswers()],
			),
		)
	})

	test("a failed finalize stops the spinner and Try again finalizes again", () => {
		story(
			run,
			given(inviteForm([])),
			message(Message.ClickedContinueInvite()),
			expectOutMessage(nav("finalization")),
			Command.resolve(CompleteOnboarding, Message.FailedCompleteOnboarding({ reason: "Unavailable" })),
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
				[LoadOnboardingHome, Message.CompletedLoadHome()],
				[ClearOnboardingAnswers, Message.CompletedStoreAnswers()],
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
			expectOutMessage(nav("finalization")),
			Command.expectExact(
				CompleteOnboarding({ memberId: invitedMembership.memberId, role: "developer", useCases: [] }),
			),
			Command.resolve(CompleteOnboarding, Message.SucceededCompleteOnboarding()),
			Command.expectHas(LoadOnboardingHome({ href: "/hazel" })),
			Command.resolveAll(
				[LoadOnboardingHome, Message.CompletedLoadHome()],
				[ClearOnboardingAnswers, Message.CompletedStoreAnswers()],
			),
		)
	})
})
