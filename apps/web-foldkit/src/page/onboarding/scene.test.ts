import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import {
	Command,
	Mount,
	all,
	click,
	expect,
	expectAll,
	expectOutMessage,
	given,
	last,
	role,
	scene,
	text,
	type,
} from "foldkit/scene"
import { describe, test, vi, expect as vitestExpect } from "vitest"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CompleteOnboarding, ClearOnboardingAnswers, LoadOnboardingHome, SendInvites } from "./command"
import { Message } from "./message"
import type { Membership, Model } from "./model"
import { EnterAnimation } from "./enter-animation"
import { AutoFocus } from "./navigation"
import { DrawGlobePath, TwinkleStar } from "./timezone/globe"
import { init, update } from "./update"
import { view } from "./view"
import { sharedDefaults } from "../test-shared"
import { errorToast, successToast } from "../../data/actions"
import { AppRoute } from "../../route"

/** The later onboarding steps (the native shell draws welcome and profile), driven through their views. */

// Scenes render without a DOM; the interaction Submodel only needs `document` as an event target.
vi.hoisted(() => {
	if (!("document" in globalThis)) Object.assign(globalThis, { document: new EventTarget() })
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: null,
	currentUser: {
		id: Schema.decodeSync(UserId)(uuid(1)),
		firstName: "Nora",
		lastName: "Newcomer",
		email: "nora@hazel.test",
		avatarUrl: null,
		isOnboarded: false,
	},
	organization: null,
	member: null,
	nowMs: Date.UTC(2026, 2, 12, 15),
	...sharedDefaults,
}
const membership = {
	organizationId: Schema.decodeSync(OrganizationId)(uuid(2)),
	memberId: Schema.decodeSync(OrganizationMemberId)(uuid(3)),
	name: "Hazel Labs",
	slug: "hazel",
}

/** A creator's membership (no slug yet), so the invite step has an organization to invite into. */
const creator = { ...membership, slug: null }

const config = {
	update: (model: Model, message: Message) => update(model, message, shared),
	view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared }, h),
}

/** Shared with a stored dark theme, as `Shared.theme` reports it. */
const darkShared: Shared = { ...shared, theme: { ...shared.theme, mode: "dark", resolved: "dark" } }
const darkConfig = {
	update: (model: Model, message: Message) => update(model, message, darkShared),
	view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared: darkShared }, h),
}

/** The page once `?step=` and the membership are known. */
const ready = (
	urlStep: string | null,
	member: Membership | null = null,
	extra: ReadonlyArray<Message> = [],
): Model => {
	const steps = [
		Message.DetectedBrowserTimezone({ browserTimezone: "UTC" }),
		Message.UpdatedMembership({ membership: member }),
		...extra,
	]
	const route = { _tag: "Onboarding" as const, orgId: Option.none(), step: Option.fromNullishOr(urlStep) }
	return steps.reduce((model, message) => update(model, message, shared).model, init(route).model)
}

const settled = Message.CompletedEnterAnimation()
const focused = Message.CompletedAutoFocus()
const started = Message.StartedGlobeAnimation()

/** The timezone step's globe: seven grid lines, eight stars and the selected city's badge. */
const timezoneMounts = [
	...Array.from({ length: 7 }, () => [DrawGlobePath, started] as const),
	...Array.from({ length: 8 }, () => [TwinkleStar, started] as const),
	[EnterAnimation, settled] as const,
]

/** A step change: the URL through the root, which the native shell follows. */
const nav = (step: string, toast?: ReturnType<typeof successToast>) => {
	const route = AppRoute.Onboarding({ orgId: Option.none(), step: Option.some(step) })
	return toast === undefined
		? PageOutMessage.RequestedNavigation({ route, replace: true })
		: PageOutMessage.RequestedNavigation({ route, replace: true, toast })
}

describe("onboarding flow", () => {
	test("welcome and profile are the shell's: this page draws nothing for them", () => {
		scene(
			config,
			given(ready(null)),
			expect(role("heading", { name: "Welcome to Hazel!" })).toBeAbsent(),
			expect(role("button", { name: /Get started/ })).toBeAbsent(),
		)
	})

	test("the time zone step the shell moved to is drawn here", () => {
		scene(
			config,
			given(ready("timezoneSelection")),
			expect(role("heading", { name: "Where are you located?" })).toExist(),
			expect(role("button", { name: /Detect my time zone/ })).toExist(),
			Mount.resolveAll(...timezoneMounts),
		)
	})

	test("an invited member follows the shorter flow and skips the team size step", () => {
		scene(
			darkConfig,
			given(ready("themeSelection", membership)),
			expect(role("heading", { name: "Choose your theme" })).toExist(),
			expect(role("radio", { name: "Dark mode" })).toBeChecked(),
			click(role("button", { name: /Continue/ })),
			expectOutMessage(nav("role")),
			expect(role("heading", { name: "What's your role?" })).toExist(),
		)
	})

	test("the theme step previews a choice through the root", () => {
		const themed = ready("themeSelection", membership)
		vitestExpect(
			update(themed, Message.SelectedTheme({ theme: "light" }), darkShared).outMessage,
		).toEqual(
			PageOutMessage.RequestedTheme({
				preference: { mode: "light", customization: darkShared.theme.customization },
			}),
		)
		vitestExpect(
			update(themed, Message.SelectedBrandColor({ hex: "#099250" }), darkShared).outMessage,
		).toMatchObject({ preference: { mode: "dark", customization: { primary: "#099250" } } })
	})

	test("skipping the invites finalizes with the collected answers, then reloads into the org", () => {
		scene(
			config,
			given(ready("teamInvitation", null)),
			Mount.resolve(AutoFocus, focused),
			click(role("button", { name: /Skip for now/ })),
			Command.expectExact(CompleteOnboarding),
			expectOutMessage(nav("finalization")),
			expect(text("Setting up your workspace...")).toExist(),
			Mount.expectEnded(AutoFocus),
			Command.resolve(CompleteOnboarding, Message.FailedCompleteOnboarding({ reason: "Offline" })),
			expect(text("Setting up your workspace...")).toBeAbsent(),
			expect(role("alert")).toHaveText(
				"Connection lost. Check your internet connection and try again.",
			),
			click(role("button", { name: "Try again" })),
			Command.expectExact(CompleteOnboarding),
			expect(text("Setting up your workspace...")).toExist(),
			Command.resolve(CompleteOnboarding, Message.SucceededCompleteOnboarding()),
			expectOutMessage(nav("completed")),
			Command.resolveAll(
				[LoadOnboardingHome, Message.CompletedLoadHome()],
				[ClearOnboardingAnswers, Message.CompletedStoreAnswers()],
			),
		)
	})

	test("an invalid invite address blocks sending until it is fixed", () => {
		scene(
			config,
			given(ready("teamInvitation", creator)),
			Mount.resolve(AutoFocus, focused),
			type(role("textbox", { name: "Email 1" }), "grace@"),
			expect(role("button", { name: /Skip for now/ })).toExist(),
			type(role("textbox", { name: "Email 1" }), "grace@hazel"),
			click(role("button", { name: /Skip for now/ })),
			Command.expectNone(),
			expect(text("Please enter a valid email address")).toExist(),
			type(role("textbox", { name: "Email 1" }), "grace@hazel.test"),
			expect(text("Please enter a valid email address")).not.toExist(),
			click(role("button", { name: /Send invites/ })),
			Command.expectExact(SendInvites),
			Command.resolve(SendInvites, Message.FailedSendInvites({ reason: "AllFailed" })),
			expectOutMessage(errorOut("Failed to send invitations")),
			expect(role("button", { name: /Send invites/ })).toBeEnabled(),
		)
	})
})

const firstMounts = Mount.resolve(AutoFocus, focused)
const errorOut = (title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: errorToast(title, description) })

describe("invite step", () => {
	const removeButtons = all.role("button", { name: "Remove email" })

	test("rows can be added and removed, and only extra rows have a remove button", () => {
		scene(
			config,
			given(ready("teamInvitation", creator)),
			firstMounts,
			expectAll(removeButtons).toHaveCount(0),
			click(role("button", { name: /Add another email/ })),
			expect(role("textbox", { name: "Email 2" })).toExist(),
			expectAll(removeButtons).toHaveCount(2),
			click(last(removeButtons)),
			expect(role("textbox", { name: "Email 2" })).toBeAbsent(),
			expectAll(removeButtons).toHaveCount(0),
		)
	})

	test("at ten rows Add is disabled and the limit is explained", () => {
		const addRow = click(role("button", { name: /Add another email/ }))
		scene(
			config,
			given(ready("teamInvitation", creator)),
			firstMounts,
			addRow,
			addRow,
			addRow,
			addRow,
			addRow,
			addRow,
			addRow,
			addRow,
			addRow,
			expect(role("textbox", { name: "Email 10" })).toExist(),
			expect(role("button", { name: /Add another email/ })).toBeDisabled(),
			expect(text("Maximum of 10 invites at a time. You can invite more later.")).toExist(),
		)
	})

	test("sending locks the step, then a full success toasts and finalizes", () => {
		scene(
			config,
			given(ready("teamInvitation", creator)),
			firstMounts,
			type(role("textbox", { name: "Email 1" }), "grace@hazel.test"),
			click(role("button", { name: /Send invites/ })),
			Command.expectExact(
				SendInvites({ organizationId: creator.organizationId, emails: ["grace@hazel.test"] }),
			),
			expect(role("button", { name: /Send invites/ })).toBeDisabled(),
			expect(role("button", { name: /Back/ })).toBeDisabled(),
			Command.resolve(
				SendInvites,
				Message.SucceededSendInvites({ emails: ["grace@hazel.test"], failedCount: 0 }),
			),
			// One update, one OutMessage: the toast goes with the step's navigation.
			expectOutMessage(nav("finalization", successToast("Sent 1 invitation"))),
			expect(text("Setting up your workspace...")).toExist(),
			Mount.expectEnded(AutoFocus),
			Command.resolve(CompleteOnboarding, Message.FailedCompleteOnboarding({ reason: "Offline" })),
		)
	})

	test("when every invitation fails the address stays for another try", () => {
		scene(
			config,
			given(ready("teamInvitation", creator)),
			firstMounts,
			type(role("textbox", { name: "Email 1" }), "grace@hazel.test"),
			click(role("button", { name: /Send invites/ })),
			Command.resolve(SendInvites, Message.FailedSendInvites({ reason: "AllFailed" })),
			expectOutMessage(errorOut("Failed to send invitations")),
			expect(role("textbox", { name: "Email 1" })).toHaveValue("grace@hazel.test"),
			expect(role("button", { name: /Send invites/ })).toBeEnabled(),
		)
	})
})
