import { Effect, Option, Schema } from "effect"
import { Command, type Runtime, Update } from "foldkit"
import { UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { toString as urlToString, type Url } from "foldkit/url"
import {
	ApplyTheme,
	FetchCurrentUser,
	LoadExternal,
	NavigateInternal,
	DeliverNotifications,
	ReplaceUrl,
	SaveSoundSettings,
	SaveThemePreference,
	SignOut,
} from "./app/command"
import { Message } from "./app/message"
import { Model, resolvedThemeOf, sharedOf, shellContextOf } from "./app/model"
import { toPageMessage } from "./app/view"
import * as CommandPalette from "./overlay/command-palette"
import type { Return as CommandPaletteReturn } from "./overlay/command-palette/update"
import * as Modal from "./overlay/modal"
import * as Platform from "./platform"
import * as Toasts from "./overlay/toasts"
import { can } from "./page/contract"
import { PageOutMessage } from "./page/out-message"
import { ModalOutMessage } from "./overlay/out-message"
import { enterRoute, informShared, type PageTransition, updatePage } from "./page/registry"
import { authRedirect, routeRedirect } from "./redirect"
import { urlToAppRoute } from "./route"
import type { Resources } from "./rpc"
import { loadSoundSettings, SoundSettings } from "./notification-sound"
import * as Shell from "./shell/update"
import {
	loadThemePreference,
	ResolvedTheme,
	resolveSystemTheme,
	type ThemeCustomization,
	ThemePreference,
} from "./theme"

export { Message } from "./app/message"
export { Model } from "./app/model"
export { subscriptions } from "./app/subscription"
export { view } from "./app/view"

/** Read before the first render, so a stored theme never flashes the default (`Atom.kvs` reads sync). */
export const Flags = Schema.Struct({
	themePreference: ThemePreference,
	systemTheme: ResolvedTheme,
	soundSettings: SoundSettings,
})
export type Flags = typeof Flags.Type

export const flags: Effect.Effect<Flags> = Effect.all({
	themePreference: loadThemePreference,
	systemTheme: Effect.sync(resolveSystemTheme),
	soundSettings: loadSoundSettings,
})

type Return = Update.Return<Model, Message, Resources>
type Step = Update.Step<Model, Message, Resources>

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

const withToasts = foldOverlay(
	(model, toasts: Toasts.Model) => modifyFields(model, { toasts: () => toasts }),
	(message: Toasts.Message) => Message.GotToastsMessage({ message }),
)

/** Completed overlay actions: follow the link, then show the toast (legacy `onSuccess` order). */
const completedOverlay = (model: Model, href: string | null, toast: Toasts.ToastRequest | null): Return => {
	const toasted = toast === null ? { model } : withToasts(model, Toasts.push(model.toasts, toast))
	return {
		model: toasted.model,
		commands: [...(toasted.commands ?? []), ...(href === null ? [] : [NavigateInternal({ url: href })])],
	}
}

const followModalOutMessage = (model: Model, outMessage: Option.Option<ModalOutMessage>): Return =>
	Option.match(outMessage, {
		onNone: () => ({ model }),
		onSome: ModalOutMessage.match<Return>({
			Closed: () => ({ model }),
			Completed: ({ href, toast }) => completedOverlay(model, href, toast),
			RequestedToast: ({ toast }) => withToasts(model, Toasts.push(model.toasts, toast)),
		}),
	})

/** The modal slot after an open or update; a closing OutMessage already dropped the slot. */
const withModal = (model: Model, transition: Modal.Transition): Return => {
	const followed = followModalOutMessage(modifyFields(model, { modal: () => transition.model }), transition.outMessage)
	return {
		model: followed.model,
		commands: [
			...Command.mapMessages(transition.commands, (message) => Message.GotModalMessage({ message })),
			...(followed.commands ?? []),
		],
	}
}

const withCommandPalette = (model: Model, result: CommandPaletteReturn): Return => {
	const next = modifyFields(model, { commandPalette: () => result.model })
	const commands = Command.mapMessages(result.commands, (message) => Message.GotCommandPaletteMessage({ message }))
	const followed = Option.match(Option.fromNullishOr(result.outMessage), {
		onNone: (): Return => ({ model: next }),
		onSome: CommandPalette.OutMessage.match<Return>({
			Completed: ({ href, toast }) => completedOverlay(next, href, toast),
			RequestedModal: ({ modal }) => withModal(next, Modal.open(next.modal, modal, sharedOf(next))),
			RequestedToast: ({ toast }) => withToasts(next, Toasts.push(next.toasts, toast)),
			RequestedTheme: ({ preference }) => requestTheme(next, preference),
		}),
	})
	return { model: followed.model, commands: [...commands, ...(followed.commands ?? [])] }
}

/** `useAppHotkey` handlers in `$orgSlug/layout.tsx`. */
const pressedHotkey = (model: Model, actionId: string): Return => {
	const shared = sharedOf(model)
	const openModal = (modal: Modal.ModalRequest) => withModal(model, Modal.open(model.modal, modal, shared))
	if (actionId === "commandPalette.open" || actionId === "search.open")
		// Legacy passes `initialPage`, but the palette shows its own (reset) page: always home.
		return withCommandPalette(model, CommandPalette.open(model.commandPalette, "home", shared))
	if (actionId === "channel.create")
		return can(shared, "channel.create") ? openModal({ _tag: "NewChannel" }) : { model }
	if (actionId === "dm.create") return openModal({ _tag: "CreateDm" })
	if (actionId === "invite.email") return openModal({ _tag: "EmailInvite" })
	return { model }
}

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
			({ href, replace, toast }) =>
			(model) => {
				const toasted = toast === undefined ? { model } : withToasts(model, Toasts.push(model.toasts, toast))
				return {
					model: toasted.model,
					commands: [
						...(toasted.commands ?? []),
						replace ? ReplaceUrl({ url: href }) : NavigateInternal({ url: href }),
					],
				}
			},
		RequestedToast:
			({ toast }) =>
			(model) =>
				withToasts(model, Toasts.push(model.toasts, toast)),
		RequestedModal:
			({ modal }) =>
			(model) =>
				withModal(model, Modal.open(model.modal, modal, sharedOf(model))),
		RequestedCommandPalette:
			({ page }) =>
			(model) =>
				withCommandPalette(model, CommandPalette.open(model.commandPalette, page, sharedOf(model))),
		RequestedSignOut: () => (model) => ({ model, commands: [SignOut({})] }),
		RequestedTheme:
			({ preference }) =>
			(model) =>
				requestTheme(model, preference),
		RequestedSoundSettings:
			({ settings }) =>
			(model) =>
				Update.combine<Model, Message, Resources>(modifyFields(model, { soundSettings: () => settings }), [
					(m) => ({ model: m, commands: [SaveSoundSettings({ settings })] }),
					informPage,
				]),
		RequestedCurrentUserRefresh:
			({ toast }) =>
			(model) => {
				const toasted = toast === undefined ? { model } : withToasts(model, Toasts.push(model.toasts, toast))
				return { model: toasted.model, commands: [...(toasted.commands ?? []), FetchCurrentUser({})] }
			},
		RequestedMobileSidebar: () => (model) => ({
			model: modifyFields(model, {
				shell: (shell) => modifyFields(shell, { isSidebarOpen: () => true }),
			}),
		}),
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

// THEME

const isSameCustomization = (first: ThemeCustomization, second: ThemeCustomization) =>
	first.primary === second.primary && first.grayPalette === second.grayPalette && first.radius === second.radius

/**
 * The legacy theme atoms' effects after a change: re-apply when the resolved mode or the
 * customization changed, persist a user's choice, and tell the page when `Shared.theme` moved.
 */
const transitionTheme = (previous: Model, next: Model, shouldPersist: boolean): Return => {
	const resolved = resolvedThemeOf(next)
	const { mode, customization } = next.themePreference
	const isApplied =
		resolved !== resolvedThemeOf(previous) ||
		!isSameCustomization(customization, previous.themePreference.customization)
	const commands = [
		...(isApplied ? [ApplyTheme({ resolved, customization })] : []),
		...(shouldPersist ? [SaveThemePreference({ preference: next.themePreference })] : []),
	]
	return isApplied || mode !== previous.themePreference.mode
		? Update.combine<Model, Message, Resources>(next, [(m) => ({ model: m, commands }), informPage])
		: { model: next, commands }
}

/** `RequestedTheme` from a page or the palette: the user's choice, applied and persisted. */
export const requestTheme = (model: Model, preference: ThemePreference): Return =>
	transitionTheme(model, modifyFields(model, { themePreference: () => preference }), true)

const appliedTheme: Step = (model) => ({
	model,
	commands: [ApplyTheme({ resolved: resolvedThemeOf(model), customization: model.themePreference.customization })],
})

const enteredRoute: Step = (model) => applyPage(enterRoute(model.page, model.route, sharedOf(model)))(model)

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags, Resources> = (flags, url) => {
	const model = withUrl(
		{
			route: { _tag: "Root" },
			pathname: "",
			currentUrl: "",
			auth: "Loading",
			currentUser: null,
			organization: null,
			loadedOrgSlug: null,
			member: null,
			nowMs: 0,
			themePreference: flags.themePreference,
			systemTheme: flags.systemTheme,
			soundSettings: flags.soundSettings,
			page: null,
			shell: Shell.init(),
			modal: null,
			commandPalette: CommandPalette.init(),
			toasts: Toasts.init(),
			platform: Platform.init(),
		},
		url,
	)
	return Update.combine<Model, Message, Resources>(model, [appliedTheme, enteredRoute, informShell, redirect])
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
			Update.combine<Model, Message, Resources>(withUrl(model, url), [
				enteredRoute,
				informShell,
				redirect,
			]),
		CompletedNavigateInternal: () => ({ model }),
		CompletedReplaceUrl: () => ({ model }),
		CompletedLoadExternal: () => ({ model }),
		ChangedSystemTheme: ({ theme }) =>
			transitionTheme(model, modifyFields(model, { systemTheme: () => theme }), false),
		CompletedApplyTheme: () => ({ model }),
		CompletedSaveThemePreference: () => ({ model }),
		CompletedSaveSoundSettings: () => ({ model }),
		UpdatedRecentNotifications: ({ ids }) => ({
			model,
			commands: ids.length === 0 ? [] : [DeliverNotifications({ ids })],
		}),
		CompletedDeliverNotifications: () => ({ model }),
		ChangedAuth: ({ auth }) => {
			const next = modifyFields(model, { auth: () => auth })
			const fetchUser = auth === "SignedIn" && model.auth !== "SignedIn" ? [FetchCurrentUser({})] : []
			return Update.combine<Model, Message, Resources>(next, [
				informPage,
				redirect,
				(m) => ({ model: m, commands: fetchUser }),
			])
		},
		SucceededFetchCurrentUser: ({ user }) =>
			Update.combine<Model, Message, Resources>(modifyFields(model, { currentUser: () => user }), [
				informPage,
				informShell,
			]),
		FailedFetchCurrentUser: () => ({ model }),
		CompletedSignOut: () => ({ model }),
		UpdatedOrganization: ({ orgSlug, organization }) =>
			Update.combine<Model, Message, Resources>(
				modifyFields(model, { organization: () => organization, loadedOrgSlug: () => orgSlug }),
				[informPage, informShell],
			),
		UpdatedMember: ({ member }) =>
			Update.combine<Model, Message, Resources>(modifyFields(model, { member: () => member }), [
				informPage,
				informShell,
			]),
		TickedPresenceClock: ({ nowMs }) => ({ model: modifyFields(model, { nowMs: () => nowMs }) }),
		ClickedLayoutTab: ({ href }) => ({ model, commands: [NavigateInternal({ url: href })] }),
		GotPageMessage: ({ message }) => applyPage(updatePage(model.page, message, sharedOf(model)))(model),
		GotShellMessage: ({ message }) => {
			const result = Shell.update(model.shell, message, shellContextOf(model))
			const shelled = withCommands(
				{
					model: modifyFields(model, { shell: () => result.model }),
					commands: Command.mapMessages(result.commands, (child) =>
						Message.GotShellMessage({ message: child }),
					),
				},
				Option.fromNullishOr(result.outMessage),
			)
			// `Shared.isMobile` comes from the shell's viewport query.
			return result.model.isMobile === model.shell.isMobile
				? shelled
				: Update.combine<Model, Message, Resources>(shelled.model, [
						(m) => ({ model: m, commands: shelled.commands }),
						informPage,
					])
		},
		GotModalMessage: ({ message }) => withModal(model, Modal.update(model.modal, message, sharedOf(model))),
		GotCommandPaletteMessage: ({ message }) =>
			withCommandPalette(model, CommandPalette.update(model.commandPalette, message, sharedOf(model))),
		PressedHotkey: ({ actionId }) => pressedHotkey(model, actionId),
		GotToastsMessage: ({ message }) => withToasts(model, Toasts.update(model.toasts, message)),
		GotPlatformMessage: ({ message }) => {
			const result = Platform.update(model.platform, message)
			return {
				model: modifyFields(model, { platform: () => result.model }),
				commands: Command.mapMessages(result.commands, (child) => Message.GotPlatformMessage({ message: child })),
			}
		},
	})
