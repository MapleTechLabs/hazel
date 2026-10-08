import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, Mount, all, click, expect, expectAll, expectOutMessage, given, last, role, scene, selector, submit, text, type } from "foldkit/scene"
import { describe, test, vi, expect as vitestExpect } from "vitest"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
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

/** Shared with a stored dark theme, as `Shared.theme` reports it. */
const darkShared: Shared = { ...shared, theme: { ...shared.theme, mode: "dark", resolved: "dark" } }
const darkConfig = {
	update: (model: Model, message: Message) => update(model, message, darkShared),
	view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared: darkShared }, h),
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
			darkConfig,
			given(ready("themeSelection", membership)),
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

	test("the theme step previews a choice through the root", () => {
		const themed = ready("themeSelection", membership)
		vitestExpect(update(themed, Message.SelectedTheme({ theme: "light" }), darkShared).outMessage).toEqual(
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

const firstMounts = Mount.resolveAll([EnterAnimation, settled], [AutoFocus, focused])
const errorToast = (title: string) => PageOutMessage.RequestedToast({ toast: { intent: "error", title, description: null } })

describe("profile step validation", () => {
	test("clearing a name marks only that input invalid, and Enter does not submit", () => {
		scene(
			config,
			given(ready("profileInfo")),
			firstMounts,
			type(role("textbox", { name: "Last name" }), ""),
			expect(role("textbox", { name: "Last name" })).toHaveAttr("aria-invalid", "true"),
			expect(role("textbox", { name: "First name" })).toHaveAttr("aria-invalid", "false"),
			expect(role("button", { name: /Continue/ })).toBeDisabled(),
			// The form has no accessible name, so it is reached by tag.
			submit(selector("form")),
			Command.expectNone(),
		)
	})

	test("a failed save shows a toast and lets the user try again", () => {
		scene(
			config,
			given(ready("profileInfo")),
			firstMounts,
			click(role("button", { name: /Continue/ })),
			expect(role("button", { name: /Continue/ })).toBeDisabled(),
			expect(role("button", { name: /Back/ })).toBeDisabled(),
			Command.resolve(UpdateProfile, Message.FailedUpdateProfile()),
			expectOutMessage(errorToast("Failed to update profile")),
			expect(role("heading", { name: "Set up your profile" })).toExist(),
			expect(role("button", { name: /Continue/ })).toBeEnabled(),
		)
	})
})

describe("invite step", () => {
	const removeButtons = all.role("button", { name: "Remove email" })

	test("rows can be added and removed, and only extra rows have a remove button", () => {
		scene(
			config,
			given(ready("teamInvitation")),
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
			given(ready("teamInvitation")),
			firstMounts,
			addRow, addRow, addRow, addRow, addRow, addRow, addRow, addRow, addRow,
			expect(role("textbox", { name: "Email 10" })).toExist(),
			expect(role("button", { name: /Add another email/ })).toBeDisabled(),
			expect(text("Maximum of 10 invites at a time. You can invite more later.")).toExist(),
		)
	})

	test("sending locks the step, then a full success toasts and finalizes", () => {
		scene(
			config,
			given(ready("teamInvitation")),
			firstMounts,
			type(role("textbox", { name: "Email 1" }), "grace@hazel.test"),
			click(role("button", { name: /Send invites/ })),
			Command.expectExact(SendInvites({ emails: ["grace@hazel.test"] })),
			expect(role("button", { name: /Send invites/ })).toBeDisabled(),
			expect(role("button", { name: /Back/ })).toBeDisabled(),
			Command.resolve(SendInvites, Message.SucceededSendInvites({ emails: ["grace@hazel.test"], failedCount: 0 })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "success", title: "Sent 1 invitation", description: null } }),
			),
			Command.resolve(ReplaceStepUrl, Message.CompletedReplaceStepUrl()),
			expect(text("Setting up your workspace...")).toExist(),
			Mount.expectEnded(AutoFocus),
			Mount.resolve(EnterAnimation, settled),
			Command.resolve(CompleteOnboarding, Message.FailedCompleteOnboarding({ error: "Failed to finalize onboarding" })),
		)
	})

	test("when every invitation fails the address stays for another try", () => {
		scene(
			config,
			given(ready("teamInvitation")),
			firstMounts,
			type(role("textbox", { name: "Email 1" }), "grace@hazel.test"),
			click(role("button", { name: /Send invites/ })),
			Command.resolve(SendInvites, Message.FailedSendInvites({ reason: "AllFailed" })),
			expectOutMessage(errorToast("Failed to send invitations")),
			expect(role("textbox", { name: "Email 1" })).toHaveValue("grace@hazel.test"),
			expect(role("button", { name: /Send invites/ })).toBeEnabled(),
		)
	})
})
