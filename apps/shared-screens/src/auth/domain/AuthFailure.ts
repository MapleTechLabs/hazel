/**
 * Why a sign-in step did not finish, as the auth pages show it. The literals are the web app's
 * (`web-foldkit/src/auth/flows.ts`, `desktop-handoff.ts`, `core/lib/error-messages.ts`), so its
 * classified failures pass through `AuthFlows` unchanged.
 */
import { Match, Schema } from "effect"

/** The reasons any backend call shares (`core/lib/error-messages.ts` `CommonReason`). */
export const CommonReason = Schema.Literals([
	"Offline",
	"Timeout",
	"SignedOut",
	"RateLimited",
	"Unavailable",
	"Unexpected",
])
export type CommonReason = typeof CommonReason.Type

/** `Cancelled` is the visitor closing the passkey prompt themselves, so it shows nothing. */
export const AuthFailure = Schema.Union([
	Schema.Literals([
		"Cancelled",
		"PasskeyUnsupported",
		"Rejected",
		"Expired",
		"Denied",
		"AccountConflict",
		"AccountCreated",
	]),
	CommonReason,
])
export type AuthFailure = typeof AuthFailure.Type

/** Desktop sign-in through the system browser can also time out, meet another attempt, or end unsure. */
export const SignInFailure = Schema.Union([
	AuthFailure,
	Schema.Literals(["BrowserTimedOut", "BrowserBusy", "BrowserIndeterminate"]),
])
export type SignInFailure = typeof SignInFailure.Type

/**
 * The desktop handoff's failures. `Expired`: the attempt is gone or used. `NeedsSignIn`: this browser
 * has no session. `SignInAgain`: the session predates the attempt, so a fresh sign-in here fixes it.
 */
export const HandoffFailure = Schema.Union([
	Schema.Literals(["Expired", "NeedsSignIn", "SignInAgain"]),
	CommonReason,
])
export type HandoffFailure = typeof HandoffFailure.Type

/** Why another install's address was not taken (`~/config/server`'s `ServerDiscoveryError`). */
export const ServerProblem = Schema.Literals(["Empty", "Invalid", "Insecure", "Unreachable", "NotHazel"])
export type ServerProblem = typeof ServerProblem.Type

/** What an inline error says. Never server or defect text. */
export interface UserErrorMessage {
	readonly title: string
	readonly description?: string | undefined
}

const COMMON_MESSAGES = {
	Offline: { title: "Connection lost", description: "Check your internet connection and try again." },
	Timeout: {
		title: "Request timed out",
		description: "The server is taking too long to respond. Please try again.",
	},
	SignedOut: { title: "Your session has expired", description: "Please sign in again to continue." },
	RateLimited: { title: "Rate limit exceeded", description: "Please wait before trying again." },
	Unavailable: { title: "Service temporarily unavailable", description: "Please try again in a moment." },
	Unexpected: { title: "Something went wrong", description: "Please try again." },
} satisfies { readonly [R in CommonReason]: UserErrorMessage }

const isCommonReason = Schema.is(CommonReason)

/** The copy for a reason: `specific` covers the feature's own literals, common ones get the shared copy. */
export const failureMessage = <Reason extends string>(
	reason: Reason | CommonReason,
	specific: { readonly [R in Exclude<Reason, CommonReason>]: UserErrorMessage },
): UserErrorMessage =>
	isCommonReason(reason)
		? COMMON_MESSAGES[reason]
		: ((specific as Record<string, UserErrorMessage>)[reason] ?? COMMON_MESSAGES.Unexpected)

/** Transient reasons, worth another try. */
export const isRetryableReason = (reason: CommonReason): boolean =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable"

/** What a failed sign-in says; nothing when the visitor cancelled it themselves. */
export const authFailureMessage = (reason: AuthFailure): UserErrorMessage | null =>
	reason === "Cancelled"
		? null
		: failureMessage<Exclude<AuthFailure, "Cancelled">>(reason, {
				PasskeyUnsupported: {
					title: "This browser can't use passkeys",
					description: "Continue with GitHub or Google instead.",
				},
				Rejected: { title: "Hazel couldn't verify that sign-in", description: "Please try again." },
				Expired: {
					title: "That sign-in expired or was already used",
					description: "Please start again.",
				},
				// The install's access rules refused it (`ALLOWED_EMAIL_DOMAINS`, `docs/self-hosting.md`).
				Denied: {
					title: "This account can't sign in to Hazel",
					description:
						"This workspace only accepts certain email addresses. Sign in with your work account, or ask your admin for access.",
				},
				AccountConflict: {
					title: "That account is already linked to another Hazel user",
					description: "Sign in with the account you used before.",
				},
				AccountCreated: { title: "Your account is ready", description: "Sign in to continue." },
			})

/** How a message under the form reads: a failure, or a notice that the flow moved on. */
export type MessageTone = "danger" | "success"

/** `AccountCreated` is not a failure: the account exists, it only needs a sign-in. */
export const failureTone = (reason: string): MessageTone =>
	Match.value(reason).pipe(
		Match.when("AccountCreated", (): MessageTone => "success"),
		Match.orElse((): MessageTone => "danger"),
	)
