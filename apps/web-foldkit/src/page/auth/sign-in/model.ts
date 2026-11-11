import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { Provider } from "../../../auth/client"
import { AuthFailure } from "../../../auth/flows"

/** What the visitor started: a provider's OAuth redirect, the passkey prompt, or (desktop) the browser. */
export const Attempt = Schema.Union([Schema.Literals(Provider), Schema.Literals(["passkey", "browser"])])
export type Attempt = typeof Attempt.Type

/** Desktop sign-in through the system browser can also time out, meet another attempt, or end unsure. */
export const SignInFailure = Schema.Union([
	AuthFailure,
	Schema.Literals(["BrowserTimedOut", "BrowserBusy", "BrowserIndeterminate"]),
])
export type SignInFailure = typeof SignInFailure.Type

export const Submission = defineTaggedUnion({
	Idle: {},
	/** Stays pending until the browser navigates away. */
	Pending: { attempt: Attempt },
	Failed: { reason: SignInFailure },
})
export type Submission = typeof Submission.Type

export const Model = Schema.Struct({
	/** `/sign-up` shows the same choices: the first OAuth sign-in creates the account. */
	mode: Schema.Literals(["SignIn", "SignUp"]),
	/** `?redirect_url=`: where to go once signed in. */
	redirectUrl: Schema.NullOr(Schema.String),
	submission: Submission,
})
export type Model = typeof Model.Type

/** The attempt in flight, if any. */
export const pendingAttempt = (model: Model): Attempt | null =>
	model.submission._tag === "Pending" ? model.submission.attempt : null
