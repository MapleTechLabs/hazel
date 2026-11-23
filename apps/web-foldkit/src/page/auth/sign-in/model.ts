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

/** Why another install's address was not taken (`~/config/server`'s `ServerDiscoveryError`). */
export const ServerProblem = Schema.Literals(["Empty", "Invalid", "Insecure", "Unreachable", "NotHazel"])
export type ServerProblem = typeof ServerProblem.Type

/** The native app's "sign in to another install" form. */
export const ServerForm = Schema.Struct({
	address: Schema.String,
	/** Resolving the address, or switching to it (the app then reloads). */
	isBusy: Schema.Boolean,
	problem: Schema.NullOr(ServerProblem),
})
export type ServerForm = typeof ServerForm.Type

/** The install the native app signs in to; `null` on the web, where it is the page's own. */
export const ServerChoice = Schema.Struct({
	/** How it is named on screen, e.g. `hazel.sh` or `chat.acme.com`. */
	label: Schema.String,
	/** The build's own install (Hazel cloud): nothing to reset to. */
	isDefault: Schema.Boolean,
	/** Open while the user enters another address. */
	form: Schema.NullOr(ServerForm),
})
export type ServerChoice = typeof ServerChoice.Type

export const Model = Schema.Struct({
	/** `/sign-up` shows the same choices: the first OAuth sign-in creates the account. */
	mode: Schema.Literals(["SignIn", "SignUp"]),
	/** `?redirect_url=`: where to go once signed in. */
	redirectUrl: Schema.NullOr(Schema.String),
	submission: Submission,
	server: Schema.NullOr(ServerChoice),
})
export type Model = typeof Model.Type

/** The attempt in flight, if any. */
export const pendingAttempt = (model: Model): Attempt | null =>
	model.submission._tag === "Pending" ? model.submission.attempt : null
