// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What every modal shares: its one event, the toasts it shows and the copy for a failed write.
 * The copy is today's (`web-foldkit/src/core/lib/error-messages.ts`): a failure the modal can't
 * name itself collapses to a common reason, and no server text is ever shown.
 */
import { UiSchema } from "@effect/ui"
import { Effect, Predicate, Schema } from "effect"
import { type AppToast, AppRequest, AppRequests } from "../app/requests"

/** A modal asks the app to stop drawing it: cancelled, dismissed or done. */
export const ModalEvents = UiSchema.TaggedEnum({ RequestedClose: {} })
export type ModalEvents = typeof ModalEvents.Type

export const CommonReason = Schema.Literals([
	"Offline",
	"Timeout",
	"SignedOut",
	"RateLimited",
	"Unavailable",
	"Unexpected",
])
export type CommonReason = typeof CommonReason.Type

export interface ErrorCopy {
	readonly title: string
	readonly description?: string
}

const COMMON_COPY = {
	Offline: { title: "Connection lost", description: "Check your internet connection and try again." },
	Timeout: {
		title: "Request timed out",
		description: "The server is taking too long to respond. Please try again.",
	},
	SignedOut: { title: "Your session has expired", description: "Please sign in again to continue." },
	RateLimited: { title: "Rate limit exceeded", description: "Please wait before trying again." },
	Unavailable: { title: "Service temporarily unavailable", description: "Please try again in a moment." },
	Unexpected: { title: "Something went wrong", description: "Please try again." },
} satisfies { readonly [R in CommonReason]: ErrorCopy }

const tagOf = (error: unknown): string | undefined =>
	Predicate.hasProperty(error, "_tag") && typeof error._tag === "string" ? error._tag : undefined

const statusReason = (status: unknown): CommonReason =>
	status === 401
		? "SignedOut"
		: status === 429
			? "RateLimited"
			: status === 502 || status === 503 || status === 504
				? "Unavailable"
				: "Unexpected"

/** `commonReasonOf` for any failure: transport, auth, the server's catch-alls and the sync wait. */
export const reasonOf = (error: unknown): CommonReason => {
	const tag = tagOf(error)
	if (tag === "TimeoutError" || tag === "SyncError") return "Timeout"
	if (tag === "UnauthorizedError" || tag === "SessionNotProvidedError" || tag === "InvalidBearerTokenError")
		return "SignedOut"
	if (tag === "SessionLoadError") return "Unavailable"
	if (tag === "RateLimitExceededError") return "RateLimited"
	if (tag === "HttpClientError" && Predicate.hasProperty(error, "reason")) {
		const reason = tagOf(error.reason)
		if (reason === "TransportError") return "Offline"
		const response = Predicate.hasProperty(error, "response") ? error.response : undefined
		return reason === "StatusCodeError" && Predicate.hasProperty(response, "status")
			? statusReason(response.status)
			: "Unexpected"
	}
	if (tag === "RpcClientError" && Predicate.hasProperty(error, "reason")) {
		const reason = tagOf(error.reason) ?? ""
		return reason.startsWith("Socket") ? "Offline" : "Unexpected"
	}
	return "Unexpected"
}

export const commonCopy = (reason: CommonReason): ErrorCopy => COMMON_COPY[reason]

/** The copy for a modal's failure: its own named cases, else the common reason's. */
export const copyOf = <Own extends string>(
	failure: Own | CommonReason,
	own: { readonly [K in Exclude<Own, CommonReason>]: ErrorCopy },
): ErrorCopy =>
	Schema.is(CommonReason)(failure)
		? COMMON_COPY[failure]
		: ((own as Record<string, ErrorCopy>)[failure] ?? COMMON_COPY.Unexpected)

export const successToast = (title: string): AppToast => ({ intent: "success", title, description: null })

export const errorToast = (copy: ErrorCopy): AppToast => ({
	intent: "error",
	title: copy.title,
	description: copy.description ?? null,
})

/** Shows `toast` through the app, from a Command body. */
export const toast = (toast: AppToast) =>
	Effect.flatMap(Effect.service(AppRequests), ({ send }) => send(AppRequest.ShowToast({ toast })))

/** Navigates in the app, from a Command body. */
export const navigate = (href: string) =>
	Effect.flatMap(Effect.service(AppRequests), ({ send }) =>
		send(AppRequest.Navigate({ href, replace: false })),
	)

/** The org's chat channel link, as the web app names it. */
export const channelHref = (orgSlug: string, channelId: string) => `/${orgSlug}/chat/${channelId}`
