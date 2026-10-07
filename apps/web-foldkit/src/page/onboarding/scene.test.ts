import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, Mount, click, expect, given, role, scene, text, type } from "foldkit/scene"
import { describe, test, vi } from "vitest"
import type { Shared } from "../contract"
import { CompleteOnboarding, ReplaceStepUrl, SendInvites, UpdateProfile } from "./command"
import { Message } from "./message"
import type { Model } from "./model"
import { EnterAnimation } from "./enter-animation"
import { AutoFocus } from "./navigation"
import { DrawGlobePath, TwinkleStar } from "./timezone/globe"
import { init, update } from "./update"
import { view } from "./view"
import { sharedDefaults } from "../test-shared"

/** The onboarding flow's update loop, driven through the rendered steps. */

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
		organizationId: null,
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

const config = {
	update: (model: Model, message: Message) => update(model, message, shared),
	view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared }, h),
}

/** The page once `?step=` and the membership are known. */
const ready = (
	urlStep: string | null,
	member: typeof membership | null = null,
	extra: ReadonlyArray<Message> = [],
): Model => {
	const steps = [
		Message.GotBrowserTimezone({ browserTimezone: "UTC" }),
		Message.UpdatedMembership({ membership: member }),
		...extra,
	]
	const route = { _tag: "Onboarding" as const, orgId: Option.none(), step: Option.fromNullishOr(urlStep) }
	return steps.reduce((model, message) => update(model, message, shared).model, init(route, shared).model)
}

const settled = Message.CompletedEnterAnimation()
const focused = Message.CompletedAutoFocus()
const started = Message.StartedGlobeAnimation()

/** The timezone step's globe: seven grid lines, eight stars, the step transition and a badge. */
const timezoneMounts = [
	...Array.from({ length: 7 }, () => [DrawGlobePath, started] as const),
	...Array.from({ length: 8 }, () => [TwinkleStar, started] as const),
	[EnterAnimation, settled] as const,
	[EnterAnimation, settled] as const,
]

describe("onboarding flow", () => {
	test("a new user starts at welcome and Get Started moves to the profile step", () => {
		scene(
			config,
			given(ready(null)),
			expect(role("heading", { name: "Welcome to Hazel!" })).toExist(),
			Mount.resolve(EnterAnimation, settled),
			click(role("button", { name: /Get Started/ })),
			Command.expectExact(ReplaceStepUrl),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(role("heading", { name: "Set up your profile" })).toExist(),
			expect(role("textbox", { name: "First name" })).toHaveValue("Nora"),
			Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused]),
		)
	})

	test("an empty first name disables Continue until it is filled again", () => {
		scene(
			config,
			given(ready("profileInfo")),
			Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused]),
			type(role("textbox", { name: "First name" }), ""),
			expect(role("button", { name: /Continue/ })).toBeDisabled(),
			type(role("textbox", { name: "First name" }), "Ada"),
			expect(role("button", { name: /Continue/ })).toBeEnabled(),
			click(role("button", { name: /Continue/ })),
			Command.expectExact(UpdateProfile),
			Command.resolve(UpdateProfile, Message.SucceededUpdateProfile()),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(role("heading", { name: "Where are you located?" })).toExist(),
			expect(role("button", { name: /Detect My Timezone/ })).toExist(),
			Mount.expectEnded(AutoFocus),
			Mount.resolveAll(...timezoneMounts),
		)
	})

	test("an invited member follows the shorter flow and skips the team size step", () => {
		scene(
			config,
			given(
				ready("themeSelection", membership, [
					Message.GotThemePreference({ theme: "dark", brandColor: "#099250" }),
				]),
			),
			expect(role("heading", { name: "Choose your theme" })).toExist(),
			expect(role("radio", { name: "Dark mode" })).toBeChecked(),
			Mount.resolve(EnterAnimation, settled),
			click(role("button", { name: /Continue/ })),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(role("heading", { name: "What's your role?" })).toExist(),
			expect(text(/Step\s*5\s*of\s*5/)).toExist(),
			Mount.resolve(EnterAnimation, settled),
		)
	})

	test("skipping the invites finalizes with the collected answers, then reloads into the org", () => {
		scene(
			config,
			given(ready("teamInvitation", null)),
			Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused]),
			click(role("button", { name: /Skip for now/ })),
			Command.expectExact(ReplaceStepUrl, CompleteOnboarding),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(text("Setting up your workspace...")).toExist(),
			Mount.expectEnded(AutoFocus),
			Mount.resolve(EnterAnimation, settled),
			Command.resolve(
				CompleteOnboarding,
				Message.FailedCompleteOnboarding({ error: "Failed to finalize onboarding" }),
			),
			expect(text("Failed to finalize onboarding")).toExist(),
		)
	})

	test("an invalid invite address blocks sending until it is fixed", () => {
		scene(
			config,
			given(ready("teamInvitation")),
			Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused]),
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
			Command.resolve(SendInvites, Message.FailedSendInvites({ reason: "NoOrganization" })),
			expect(role("button", { name: /Send invites/ })).toBeEnabled(),
		)
	})

	test("Back from the profile step returns to welcome", () => {
		scene(
			config,
			given(ready("profileInfo")),
			Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused]),
			click(role("button", { name: /Back/ })),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(role("heading", { name: "Welcome to Hazel!" })).toExist(),
			Mount.expectEnded(AutoFocus),
			Mount.resolve(EnterAnimation, settled),
		)
	})
})
