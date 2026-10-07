import { Option } from "effect"
import { Command, type Runtime, Update } from "foldkit"
import { UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { toString as urlToString, type Url } from "foldkit/url"
import {
	ApplyTheme,
	FetchCurrentUser,
	LoadExternal,
	NavigateInternal,
	ReplaceUrl,
	SignOut,
} from "./app/command"
import { Message } from "./app/message"
import { Model, sharedOf, shellContextOf } from "./app/model"
import { toPageMessage } from "./app/view"
import * as CommandPalette from "./overlay/command-palette"
import * as Modal from "./overlay/modal"
import * as Toasts from "./overlay/toasts"
import { PageOutMessage } from "./page/out-message"
import { enterRoute, informShared, type PageTransition, updatePage } from "./page/registry"
import { authRedirect, routeRedirect } from "./redirect"
import { urlToAppRoute } from "./route"
import type { HazelRpc } from "./rpc"
import * as Shell from "./shell/update"

export { Message } from "./app/message"
export { Model } from "./app/model"
export { subscriptions } from "./app/subscription"
export { view } from "./app/view"

type Return = Update.Return<Model, Message, HazelRpc>
type Step = Update.Step<Model, Message, HazelRpc>

// CHILDREN

const foldOverlay =
	<Child, ChildMessage>(
		write: (model: Model, child: Child) => Model,
		toParentMessage: (message: ChildMessage) => Message,
	) =>
	(model: Model, result: Update.Return<Child, ChildMessage>): Return => ({
		model: write(model, result.model),
		commands: Command.mapMessages(result.commands, toParentMessage),
	})

const withModal = foldOverlay(
	(model, modal: Modal.Model) => modifyFields(model, { modal: () => modal }),
	(message: Modal.Message) => Message.GotModalMessage({ message }),
)
const withCommandPalette = foldOverlay(
	(model, commandPalette: CommandPalette.Model) =>
		modifyFields(model, { commandPalette: () => commandPalette }),
	(message: CommandPalette.Message) => Message.GotCommandPaletteMessage({ message }),
)
const withToasts = foldOverlay(
	(model, toasts: Toasts.Model) => modifyFields(model, { toasts: () => toasts }),
	(message: Toasts.Message) => Message.GotToastsMessage({ message }),
)

/** Runs the OutMessage's consequence after `result`, keeping both sets of Commands. */
const withCommands = (result: Return, outMessage: Option.Option<PageOutMessage>): Return =>
	Option.match(outMessage, {
		onNone: () => result,
		onSome: (found) => {
			const followed = handleOutMessage(found)(result.model)
			return {
				model: followed.model,
				commands: [...(result.commands ?? []), ...(followed.commands ?? [])],
			}
		},
	})

/** A page or the shell reported a fact; the root owns navigation and the overlays. */
const handleOutMessage = (outMessage: PageOutMessage): Step =>
	PageOutMessage.match<Step>(outMessage, {
		RequestedNavigation:
			({ href, replace }) =>
			(model) => ({
				model,
				commands: [replace ? ReplaceUrl({ url: href }) : NavigateInternal({ url: href })],
			}),
		RequestedToast:
			({ toast }) =>
			(model) =>
				withToasts(model, Toasts.push(model.toasts, toast)),
		RequestedModal:
			({ modal }) =>
			(model) =>
				withModal(model, Modal.open(model.modal, modal)),
		RequestedCommandPalette:
			({ page }) =>
			(model) =>
				withCommandPalette(model, CommandPalette.open(model.commandPalette, page)),
		RequestedSignOut: () => (model) => ({ model, commands: [SignOut({})] }),
	})

const applyPage =
	(transition: PageTransition): Step =>
	(model) =>
		withCommands(
			{
				model: modifyFields(model, { page: () => transition.slot }),
				commands: Command.mapMessages(transition.commands, toPageMessage),
			},
			transition.outMessage,
		)

/** The shell's menus and sidebar follow the route, organization, user and role. */
const informShell: Step = (model) => {
	const result = Shell.informContext(model.shell, shellContextOf(model))
	return {
		model: modifyFields(model, { shell: () => result.model }),
		commands: Command.mapMessages(result.commands, (message) => Message.GotShellMessage({ message })),
	}
}

const informPage: Step = (model) => applyPage(informShared(model.page, sharedOf(model)))(model)

/** `beforeLoad` redirects and the signed-out gate, re-checked whenever the route or auth changes. */
const redirect: Step = (model) => {
	const target = Option.orElse(routeRedirect(model.route, { isProd: import.meta.env.PROD }), () =>
		authRedirect(model.route, model.auth, model.currentUrl),
	)
	return {
		model,
		commands: Option.match(target, { onNone: () => [], onSome: (url) => [ReplaceUrl({ url })] }),
	}
}

const withUrl = (model: Model, url: Url): Model => {
	const route = urlToAppRoute(url)
	return modifyFields(model, {
		route: () => route,
		pathname: () => url.pathname,
		currentUrl: () => `${url.pathname}${Option.getOrElse(url.search, () => "")}`,
	})
}

const enteredRoute: Step = (model) => applyPage(enterRoute(model.page, model.route, sharedOf(model)))(model)

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, void, HazelRpc> = (url: Url) => {
	const model = withUrl(
		{
			route: { _tag: "Root" },
			pathname: "",
			currentUrl: "",
			auth: "Loading",
			currentUser: null,
			organization: null,
			member: null,
			nowMs: 0,
			page: null,
			shell: Shell.init(),
			modal: Modal.init(),
			commandPalette: CommandPalette.init(),
			toasts: Toasts.init(),
		},
		url,
	)
	return Update.combine<Model, Message, HazelRpc>(model, [enteredRoute, informShell, redirect])
}

// UPDATE

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ClickedLink: ({ request }) =>
			UrlRequest.match<Return>(request, {
				Internal: ({ url }) => ({ model, commands: [NavigateInternal({ url: urlToString(url) })] }),
				External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
			}),
		ChangedUrl: ({ url }) =>
			Update.combine<Model, Message, HazelRpc>(withUrl(model, url), [
				enteredRoute,
				informShell,
				redirect,
			]),
		CompletedNavigateInternal: () => ({ model }),
		CompletedReplaceUrl: () => ({ model }),
		CompletedLoadExternal: () => ({ model }),
		ChangedSystemTheme: ({ theme }) => ({ model, commands: [ApplyTheme({ theme })] }),
		CompletedApplyTheme: () => ({ model }),
		ChangedAuth: ({ auth }) => {
			const next = modifyFields(model, { auth: () => auth })
			const fetchUser = auth === "SignedIn" && model.auth !== "SignedIn" ? [FetchCurrentUser({})] : []
			return Update.combine<Model, Message, HazelRpc>(next, [
				informPage,
				redirect,
				(m) => ({ model: m, commands: fetchUser }),
			])
		},
		SucceededFetchCurrentUser: ({ user }) =>
			Update.combine<Model, Message, HazelRpc>(modifyFields(model, { currentUser: () => user }), [
				informPage,
				informShell,
			]),
		FailedFetchCurrentUser: () => ({ model }),
		CompletedSignOut: () => ({ model }),
		UpdatedOrganization: ({ organization }) =>
			Update.combine<Model, Message, HazelRpc>(
				modifyFields(model, { organization: () => organization }),
				[informPage, informShell],
			),
		UpdatedMember: ({ member }) =>
			Update.combine<Model, Message, HazelRpc>(modifyFields(model, { member: () => member }), [
				informPage,
				informShell,
			]),
		TickedPresenceClock: ({ nowMs }) => ({ model: modifyFields(model, { nowMs: () => nowMs }) }),
		ClickedLayoutTab: ({ href }) => ({ model, commands: [NavigateInternal({ url: href })] }),
		GotPageMessage: ({ message }) => applyPage(updatePage(model.page, message, sharedOf(model)))(model),
		GotShellMessage: ({ message }) => {
			const result = Shell.update(model.shell, message, shellContextOf(model))
			return withCommands(
				{
					model: modifyFields(model, { shell: () => result.model }),
					commands: Command.mapMessages(result.commands, (child) =>
						Message.GotShellMessage({ message: child }),
					),
				},
				Option.fromNullishOr(result.outMessage),
			)
		},
		GotModalMessage: ({ message }) => withModal(model, Modal.update(model.modal, message)),
		GotCommandPaletteMessage: ({ message }) =>
			withCommandPalette(model, CommandPalette.update(model.commandPalette, message)),
		GotToastsMessage: ({ message }) => withToasts(model, Toasts.update(model.toasts, message)),
	})
