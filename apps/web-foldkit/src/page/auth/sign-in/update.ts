import { Option } from "effect"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { safeReturnTo } from "../../../auth/return-to"
import type { RouteOf } from "../../../route"
import type { Resources } from "../../../rpc"
import type { PageReturn } from "../../contract"
import { RetireBrowserSignIn, StartBrowserSignIn, StartOAuthSignIn, StartPasskeySignIn } from "./command"
import { Message } from "./message"
import { type Attempt, type Model, pendingAttempt, Submission } from "./model"

type Return = PageReturn<Model, Message>

export const init = (route: RouteOf<"SignIn" | "SignUp">): Return => ({
	model: {
		mode: route._tag,
		redirectUrl: safeReturnTo(Option.getOrNull(route.redirectUrl)),
		submission: Submission.Idle(),
	},
})

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
