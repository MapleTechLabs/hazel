import type { Overrides } from "~/lib/keybindings/keymap"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { fromString, type Url } from "foldkit/url"
import { expect } from "vitest"
import { emit } from "../app/command"
import type { HostContext } from "../app/context"
import { Message } from "../app/message"
import type { Model } from "../app/model"
import { init, update } from "../app/update"
import { view } from "../app/view"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { PageOutMessage } from "../page/out-message"
import { loadPages } from "../page/registry"
import { type AppRoute, hrefOf, urlToAppRoute } from "../route"
import {
	type AppCommand,
	type AppFlags,
	type AppModel,
	hostContextOf,
	init as shellInit,
	update as shellUpdate,
} from "../root/logic"
import { AppMessage } from "../root/message"
import type { CurrentUser, Member, Organization } from "../session"
import { defaultThemePreference, type ThemePreference } from "../theme"

/**
 * Root fixtures for both sides: the Effect UI shell (`root/logic.ts`, the `shell*` helpers) and the
 * Foldkit host (`app/update.ts`), which gets the shell's state as a `HostContext`.
 */

// Every page area is loaded, so a route of any of them opens its page at once (`page/lazy.ts`).
await loadPages()

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const ada: CurrentUser = {
	id: Schema.decodeSync(UserId)(uuid(1)),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
}

export const hazelOrg: Organization = {
	id: Schema.decodeSync(OrganizationId)(uuid(2)),
	name: "Hazel",
	slug: "hazel",
	logoUrl: null,
}

export const owner: Member = { id: Schema.decodeSync(OrganizationMemberId)(uuid(3)), role: "owner" }
export const plainMember: Member = { ...owner, role: "member" }

/** A URL on the app's origin; fails the test for an unparsable path. */
export const urlOf = (path: string): Url =>
	Option.match(fromString(`http://localhost${path}`), {
		onNone: () => expect.unreachable(`unparsable test URL: ${path}`),
		onSome: (url) => url,
	})

/** The route the Router reports for `path`. */
export const routeOf = (path: string): AppRoute => urlToAppRoute(urlOf(path))

/** The shell reads `pathname + search` from the browser, as the Router left it. */
const goTo = (path: string) => {
	if (typeof history !== "undefined") history.replaceState(null, "", path)
}

export interface BootOptions {
	readonly themePreference?: ThemePreference
	readonly systemTheme?: "light" | "dark"
	readonly isMobile?: boolean
	readonly keybindingOverrides?: Overrides
	/** The last session's user (`app/remembered-user.ts`); none by default. */
	readonly rememberedUser?: CurrentUser
}

export const flagsOf = (options: BootOptions = {}): AppFlags => ({
	themePreference: options.themePreference ?? defaultThemePreference(),
	systemTheme: options.systemTheme ?? "light",
	soundSettings: DEFAULT_SOUND_SETTINGS,
	keybindingOverrides: options.keybindingOverrides ?? {},
	keyboardPlatform: "linux",
	sessionStartMs: 0,
	isMobile: options.isMobile ?? false,
	rememberedUser: options.rememberedUser ?? null,
	aiPanel: { isOpen: false, width: null },
})

// SHELL

/** The shell's `init` at `path` (the Model and its Commands). */
export const shellBootReturn = (path: string, options: BootOptions = {}) => {
	goTo(path)
	return shellInit(routeOf(path), flagsOf(options))
}

export const shellBoot = (path: string, options: BootOptions = {}): AppModel =>
	shellBootReturn(path, options).model

/** Folds AppMessages through the shell's update, dropping their Commands. */
export const shellAfter = (model: AppModel, messages: ReadonlyArray<AppMessage>): AppModel =>
	messages.reduce((current, message) => shellUpdate(current, message).model, model)

/** The Router moved to `path`: the shell's update for it (the Model and its Commands). */
export const shellNavigate = (model: AppModel, path: string) => {
	goTo(path)
	return shellUpdate(model, AppMessage.ChangedRoute({ route: routeOf(path) }))
}

/** What the auth, `user.me`, organization and member Subscriptions report for a signed-in owner. */
export const sessionMessages = (member: Member | null = owner): ReadonlyArray<AppMessage> => [
	AppMessage.ChangedAuth({ auth: "SignedIn" }),
	AppMessage.SucceededFetchCurrentUser({ user: ada }),
	AppMessage.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
	AppMessage.UpdatedMember({ organizationId: hazelOrg.id, member }),
]

/** The shell at `path` once the session has loaded. */
export const shellSignedIn = (path: string, member: Member | null = owner, options: BootOptions = {}) =>
	shellAfter(shellBoot(path, options), sessionMessages(member))

/** A Command as data: its name and args (an interrupt has none). */
export const callOf = (command: AppCommand | { readonly name: string; readonly args: unknown }) => ({
	name: command.name,
	args: "args" in command ? command.args : undefined,
})

export const namesOf = (commands: ReadonlyArray<AppCommand> | undefined): ReadonlyArray<string> =>
	(commands ?? []).map((command) => command.name)

export const callsOf = (commands: ReadonlyArray<AppCommand> | undefined) => (commands ?? []).map(callOf)

/** The Router navigations among `commands`, as `push /path` or `replace /path`. */
export const navigationsOf = (commands: ReadonlyArray<AppCommand> | undefined): ReadonlyArray<string> =>
	(commands ?? []).flatMap((command) => {
		const kind = command.name.endsWith("/Push")
			? "push"
			: command.name.endsWith("/Replace")
				? "replace"
				: null
		if (kind === null) return []
		const { route } = callOf(command).args as { readonly route: AppRoute }
		return [`${kind} ${hrefOf(route)}`]
	})

/** What the shell published to the Foldkit host (`ToHost`). */
export const hostRequestsOf = (commands: ReadonlyArray<AppCommand> | undefined) =>
	(commands ?? [])
		.filter((command) => command.name === "ToHost")
		.map((command) => (callOf(command).args as { readonly request: unknown }).request)

// HOST

/** The Foldkit host started from the shell's `context`. */
export const hostBootReturn = (context: HostContext) => init(context, { isCreateChannelHintDismissed: false })

/** The host at `path` before the session is known (the shell's boot context). */
export const boot = (path: string, options: BootOptions = {}): Model =>
	hostBootReturn(hostContextOf(shellBoot(path, options))).model

/** Folds Messages through the host's update, dropping their Commands. */
export const after = (model: Model, messages: ReadonlyArray<Message>): Model =>
	messages.reduce((current, message) => update(current, message).model, model)

/** The host at `path` once the shell's session has loaded (the org shell renders). */
export const signedIn = (path: string, member: Member | null = owner, options: BootOptions = {}): Model =>
	hostBootReturn(hostContextOf(shellSignedIn(path, member, options))).model

/** The shell's context changed: `path` (signed in as Ada in `hazel`), or `change` to the current one. */
export const changedContext = (model: Model, change: Partial<HostContext>): Message =>
	Message.ChangedContext({ context: { ...model.context, ...change } })

/** The Router moved to `path`: the context the shell sends next, entering a new route. */
export const navigated = (model: Model, path: string): Message => {
	const shell = shellNavigate(shellSignedIn("/hazel"), path).model
	return Message.ChangedContext({
		context: { ...hostContextOf(shell), navigation: model.context.navigation + 1 },
	})
}

/** A hotkey the shell heard and handed to the host. */
export const hotkey = (actionId: Parameters<typeof AppMessage.PressedHotkey>[0]["actionId"]): Message =>
	Message.ReceivedShellRequest({ request: { _tag: "PressedHotkey", actionId } })

/** The host's report of a page's request to the shell (`Emit`). */
export const toShell = (outMessage: PageOutMessage) => emit({ _tag: "Page", outMessage })

/** The host asking the shell to navigate to `path`. */
export const navigation = (path: string, options: { readonly replace?: boolean } = {}) =>
	toShell(PageOutMessage.RequestedNavigation({ route: routeOf(path), replace: options.replace ?? false }))

/** Scene config for the Foldkit host: its view is the regions the shell adopts. */
export const rootScene = {
	update,
	view: (model: Model, h: HtmlBuilder<Message>) => view(model, h),
}
