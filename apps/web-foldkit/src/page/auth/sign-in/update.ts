import { Option, Schema } from "effect"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { allSignInMethods } from "../../../auth/client"
import { safeReturnTo } from "../../../auth/return-to"
import { desktopAuthClient } from "../../../platform/desktop"
import type { RouteOf } from "../../../route"
import type { Resources } from "../../../rpc"
import type { PageReturn } from "../../contract"
import {
	FetchSignInMethods,
	RetireBrowserSignIn,
	StartBrowserSignIn,
	StartOAuthSignIn,
	StartPasskeySignIn,
} from "./command"
import { Message } from "./message"
import { type Attempt, Methods, type Model, pendingAttempt, SignInFailure, Submission } from "./model"

type Return = PageReturn<Model, Message>

const isSignInFailure = Schema.is(SignInFailure)

/** A failed OAuth callback lands here with `?error=`: show it, so the next press starts afresh. */
const callbackFailure = (route: RouteOf<"SignIn" | "SignUp">): Submission => {
	const error = route._tag === "SignIn" ? Option.getOrNull(route.error) : null
	if (error === null) return Submission.Idle()
	return Submission.Failed({ reason: isSignInFailure(error) ? error : "Unexpected" })
}

/** The desktop app signs in through the system browser, which lists the methods itself. */
export const init = (route: RouteOf<"SignIn" | "SignUp">): Return => {
	const model: Model = {
		mode: route._tag,
		redirectUrl: safeReturnTo(Option.getOrNull(route.redirectUrl)),
		submission: callbackFailure(route),
		methods: Methods.Loading(),
	}
	return desktopAuthClient === null ? { model, commands: [FetchSignInMethods()] } : { model }
}

/** One attempt at a time: a press while another is pending does nothing. */
const start = (model: Model, attempt: Attempt, command: Command.Command<Message, never, Resources>): Return =>
	pendingAttempt(model) !== null
		? { model }
		: {
				model: modifyFields(model, { submission: () => Submission.Pending({ attempt }) }),
				commands: [command],
			}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		SucceededFetchSignInMethods: ({ providers, passkeys }) => ({
			model: modifyFields(model, { methods: () => Methods.Ready({ providers, passkeys }) }),
		}),
		FailedFetchSignInMethods: () => ({
			model: modifyFields(model, { methods: () => Methods.Ready(allSignInMethods) }),
		}),
		ClickedProvider: ({ provider }) =>
			start(model, provider, StartOAuthSignIn({ provider, returnTo: model.redirectUrl })),
		ClickedPasskey: () => start(model, "passkey", StartPasskeySignIn({ returnTo: model.redirectUrl })),
		ClickedBrowserSignIn: () => start(model, "browser", StartBrowserSignIn()),
		ClickedCancelBrowserSignIn: () =>
			pendingAttempt(model) !== "browser"
				? { model }
				: {
						model,
						commands: [
							StartBrowserSignIn.Interrupt(() => Message.CompletedCancelBrowserSignIn()),
						],
					},
		CompletedCancelBrowserSignIn: () => ({
			model: modifyFields(model, { submission: () => Submission.Idle() }),
			commands: [RetireBrowserSignIn()],
		}),
		CompletedRetireBrowserSignIn: () => ({ model }),
		// The page stays busy until the browser navigates away.
		LeftForSignIn: () => ({ model }),
		FailedSignIn: ({ reason }) => ({
			model: modifyFields(model, { submission: () => Submission.Failed({ reason }) }),
		}),
	})
