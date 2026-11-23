import { Option, Schema } from "effect"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { safeReturnTo } from "../../../auth/return-to"
import type { RouteOf } from "../../../route"
import type { Resources } from "../../../rpc"
import type { PageReturn } from "../../contract"
import { canChooseServer, currentServer, isBuildServer, serverLabel } from "~/config/server"
import {
	ChangeServer,
	RetireBrowserSignIn,
	StartBrowserSignIn,
	StartOAuthSignIn,
	StartPasskeySignIn,
	UseDefaultServer,
} from "./command"
import { Message } from "./message"
import {
	type Attempt,
	type Model,
	pendingAttempt,
	type ServerChoice,
	type ServerForm,
	SignInFailure,
	Submission,
} from "./model"

type Return = PageReturn<Model, Message>

const isSignInFailure = Schema.is(SignInFailure)

/** A failed OAuth callback lands here with `?error=`: show it, so the next press starts afresh. */
const callbackFailure = (route: RouteOf<"SignIn" | "SignUp">): Submission => {
	const error = route._tag === "SignIn" ? Option.getOrNull(route.error) : null
	if (error === null) return Submission.Idle()
	return Submission.Failed({ reason: isSignInFailure(error) ? error : "Unexpected" })
}

/** The native app's install (`~/config/server`); `null` on the web. */
export const initialServerChoice = (): ServerChoice | null =>
	canChooseServer() ? { label: serverLabel(currentServer()), isDefault: isBuildServer(), form: null } : null

/** The page for `route`, with `server` as the install (tests pass one). */
export const initWith = (route: RouteOf<"SignIn" | "SignUp">, server: ServerChoice | null): Return => ({
	model: {
		mode: route._tag,
		redirectUrl: safeReturnTo(Option.getOrNull(route.redirectUrl)),
		submission: callbackFailure(route),
		server,
	},
})

export const init = (route: RouteOf<"SignIn" | "SignUp">): Return => initWith(route, initialServerChoice())

/** Changes the server choice; nothing on the web. */
const withServer = (model: Model, f: (server: ServerChoice) => ServerChoice): Model => {
	const server = model.server
	return server === null ? model : modifyFields(model, { server: () => f(server) })
}

/** Changes the open server form; nothing when it is closed (or on the web). */
const withServerForm = (model: Model, f: (form: ServerForm) => ServerForm): Model =>
	withServer(model, (server) => (server.form === null ? server : { ...server, form: f(server.form) }))

const serverForm = (model: Model): ServerForm | null => model.server?.form ?? null

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
		// Not while a sign-in is waiting: its callback belongs to the install it started on.
		ClickedChangeServer: () =>
			model.server === null || pendingAttempt(model) !== null
				? { model }
				: {
						model: withServer(model, (server) => ({
							...server,
							form: { address: "", isBusy: false, problem: null },
						})),
					},
		ChangedServerAddress: ({ value }) => ({
			model: withServerForm(model, (form) =>
				form.isBusy ? form : { ...form, address: value, problem: null },
			),
		}),
		SubmittedServerAddress: () => {
			const form = serverForm(model)
			if (form === null || form.isBusy) return { model }
			if (form.address.trim() === "") {
				return { model: withServerForm(model, (open) => ({ ...open, problem: "Empty" })) }
			}
			return {
				model: withServerForm(model, (open) => ({ ...open, isBusy: true, problem: null })),
				commands: [ChangeServer({ address: form.address })],
			}
		},
		ClickedCancelServerChange: () => ({
			model: withServer(model, (server) => ({ ...server, form: null })),
		}),
		ClickedUseHazelCloud: () => {
			const form = serverForm(model)
			if (form === null || form.isBusy || model.server?.isDefault !== false) return { model }
			return {
				model: withServerForm(model, (open) => ({ ...open, isBusy: true, problem: null })),
				commands: [UseDefaultServer()],
			}
		},
		FailedServerChange: ({ problem }) => ({
			model: withServerForm(model, (form) => ({ ...form, isBusy: false, problem })),
		}),
		// The app reloads on the new install.
		LeftForServer: () => ({ model }),
	})
