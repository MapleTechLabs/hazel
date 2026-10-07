import { Theme as ThemeModel } from "@hazel/domain/models"
import { OrganizationMemberId, UserId } from "@hazel/schema"
import { Cause, Duration, Effect, Exit, Option, Schema } from "effect"
import { Command } from "foldkit"
import { load, replaceUrl } from "foldkit/navigation"
import { getUserFriendlyError } from "~/lib/error-messages"
import { applyBrandColor } from "~/lib/theme/apply"
import { DEFAULT_BRAND_COLOR, getDefaultThemeCustomization } from "~/lib/theme/presets"
import { HazelRpc } from "../../rpc"
import { applyTheme, resolveSystemTheme } from "../../theme"
import { clerkResource } from "./clerk"
import { Step } from "./flow"
import { Message } from "./message"
import { Theme } from "./model"

export const ReadLocation = Command.define("ReadOnboardingLocation", {
	args: {},
	messages: [Message.GotLocation],
	execute: () =>
		Effect.sync(() =>
			Message.GotLocation({
				urlStep: new URLSearchParams(window.location.search).get("step"),
				browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			}),
		),
})

/** `navigate({ search: (prev) => ({ ...prev, step }), replace: true })` */
export const ReplaceStepUrl = Command.define("ReplaceOnboardingStepUrl", {
	args: { step: Step },
	messages: [Message.CompletedReplaceStepUrl],
	execute: ({ step }) =>
		Effect.suspend(() => {
			const params = new URLSearchParams(window.location.search)
			params.set("step", step)
			return replaceUrl(`${window.location.pathname}?${params}`)
		}).pipe(Effect.as(Message.CompletedReplaceStepUrl())),
})

/** `clerkUser.update({ firstName, lastName })` */
export const UpdateProfile = Command.define("UpdateClerkProfile", {
	args: { firstName: Schema.String, lastName: Schema.String },
	messages: [Message.SucceededUpdateProfile, Message.FailedUpdateProfile],
	execute: ({ firstName, lastName }) =>
		Effect.tryPromise(() => clerkResource.updateUser({ firstName, lastName })).pipe(
			Effect.as(Message.SucceededUpdateProfile()),
			Effect.catch(() => Effect.succeed(Message.FailedUpdateProfile())),
		),
})

export const DebounceTimezoneQuery = Command.define("DebounceTimezoneQuery", {
	args: { query: Schema.String },
	messages: [Message.ElapsedTimezoneDebounce],
	execute: ({ query }) =>
		Effect.sleep(Duration.millis(150)).pipe(Effect.as(Message.ElapsedTimezoneDebounce({ query }))),
})

export const UpdateTimezone = Command.define("UpdateUserTimezone", {
	args: { userId: UserId, timezone: Schema.String },
	messages: [Message.SucceededUpdateTimezone, Message.FailedUpdateTimezone],
	execute: ({ userId, timezone }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("user.update", { id: userId, timezone }))
			if (Exit.isSuccess(exit)) return Message.SucceededUpdateTimezone({ timezone })
			const isUserNotFound = Option.exists(
				Cause.findErrorOption(exit.cause),
				(error) => error._tag === "UserNotFoundError",
			)
			if (isUserNotFound)
				return Message.FailedUpdateTimezone({
					title: "User not found",
					description: "Your account could not be found. Please try signing in again.",
				})
			const friendly = getUserFriendlyError(exit.cause)
			return Message.FailedUpdateTimezone({
				title: friendly.title,
				description: friendly.description ?? null,
			})
		}),
})

const THEME_KEY = "hazel-ui-theme"
const BRAND_COLOR_KEY = "brand-color"
const CUSTOMIZATION_KEY = "hazel-theme-customization"

const readJson = (key: string): unknown => {
	const raw = window.localStorage.getItem(key)
	return raw === null
		? null
		: Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(raw).pipe(Option.getOrNull)
}
const hasPrimary = (value: unknown): value is { readonly primary: string } =>
	typeof value === "object" && value !== null && "primary" in value && typeof value.primary === "string"

/** `useTheme()`: the stored mode and brand colour, with the provider's defaults. */
export const ReadThemePreference = Command.define("ReadThemePreference", {
	args: {},
	messages: [Message.GotThemePreference],
	execute: () =>
		Effect.sync(() => {
			const theme = Schema.decodeUnknownOption(Theme)(readJson(THEME_KEY)).pipe(
				Option.getOrElse(() => "system" as const),
			)
			const customization = readJson(CUSTOMIZATION_KEY) ?? getDefaultThemeCustomization()
			const brandColor = readJson(BRAND_COLOR_KEY)
			return Message.GotThemePreference({
				theme,
				brandColor: hasPrimary(customization)
					? customization.primary
					: typeof brandColor === "string"
						? brandColor
						: DEFAULT_BRAND_COLOR,
			})
		}),
})

/** `setTheme` / `setBrandColor`: the step previews its choice on the whole app immediately. */
export const PreviewTheme = Command.define("PreviewTheme", {
	args: { theme: Theme, brandColor: Schema.String },
	messages: [Message.CompletedPreviewTheme],
	execute: ({ theme, brandColor }) =>
		Effect.gen(function* () {
			const customization = readJson(CUSTOMIZATION_KEY) ?? getDefaultThemeCustomization()
			window.localStorage.setItem(THEME_KEY, JSON.stringify(theme))
			window.localStorage.setItem(BRAND_COLOR_KEY, JSON.stringify(brandColor))
			if (hasPrimary(customization))
				window.localStorage.setItem(
					CUSTOMIZATION_KEY,
					JSON.stringify({ ...customization, primary: brandColor }),
				)
			yield* applyTheme(theme === "system" ? resolveSystemTheme() : theme)
			const hex: ThemeModel.HexColor = Schema.decodeUnknownSync(ThemeModel.HexColor)(brandColor)
			applyBrandColor(hex)
			return Message.CompletedPreviewTheme()
		}).pipe(Effect.catch(() => Effect.succeed(Message.CompletedPreviewTheme()))),
})

/** `organization.inviteMember` for each address on the active Clerk organization. */
export const SendInvites = Command.define("SendInvites", {
	args: { emails: Schema.Array(Schema.String) },
	messages: [Message.SucceededSendInvites, Message.FailedSendInvites],
	execute: ({ emails }) =>
		Effect.promise(async () => {
			if (!clerkResource.hasOrganization())
				return Message.FailedSendInvites({ reason: "NoOrganization" })
			const results = await clerkResource.inviteMembers(emails)
			const failedCount = results.filter((result) => result.status === "rejected").length
			return failedCount === emails.length
				? Message.FailedSendInvites({ reason: "AllFailed" })
				: Message.SucceededSendInvites({ emails, failedCount })
		}),
})

/** `handleFinalization`: finalize first (critical), then the best-effort metadata and invites. */
export const CompleteOnboarding = Command.define("CompleteOnboarding", {
	args: {
		memberId: Schema.NullOr(OrganizationMemberId),
		role: Schema.NullOr(Schema.String),
		useCases: Schema.Array(Schema.String),
		emails: Schema.Array(Schema.String),
	},
	messages: [Message.SucceededCompleteOnboarding, Message.FailedCompleteOnboarding],
	execute: ({ memberId, role, useCases, emails }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const finalized = yield* Effect.exit(client("user.finalizeOnboarding", undefined))
			if (Exit.isFailure(finalized))
				return Message.FailedCompleteOnboarding({ error: "Failed to finalize onboarding" })
			if (memberId !== null)
				yield* client("organizationMember.updateMetadata", {
					id: memberId,
					metadata: { ...(role === null ? {} : { role }), useCases },
				}).pipe(Effect.ignore)
			if (clerkResource.hasOrganization() && emails.length > 0)
				yield* Effect.promise(() => clerkResource.inviteMembers(emails))
			return Message.SucceededCompleteOnboarding()
		}),
})

/** A full reload, so a cached `user.me` can't bounce the user back here. */
export const LoadHome = Command.define("LoadOnboardingHome", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadHome],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadHome())),
})
