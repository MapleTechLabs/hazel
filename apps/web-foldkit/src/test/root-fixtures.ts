import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { fromString, type Url } from "foldkit/url"
import { expect } from "vitest"
import { Message } from "../app/message"
import type { Model } from "../app/model"
import { view } from "../app/view"
import { init, update } from "../main"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import type { Shared } from "../page/contract"
import { sharedDefaults } from "../page/test-shared"
import type { CurrentUser, Member, Organization } from "../session"
import { defaultThemePreference, type ThemePreference } from "../theme"

/** Root program fixtures: boot the app at a URL and feed it the session facts the Subscriptions report. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const ada: CurrentUser = {
	id: Schema.decodeSync(UserId)(uuid(1)),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
	organizationId: null,
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

export interface BootOptions {
	readonly themePreference?: ThemePreference
	readonly systemTheme?: "light" | "dark"
}

/** `init` at `path` with default flags (the Model and its Commands). */
export const bootReturn = (path: string, options: BootOptions = {}) =>
	init(
		{
			themePreference: options.themePreference ?? defaultThemePreference(),
			systemTheme: options.systemTheme ?? "light",
			soundSettings: DEFAULT_SOUND_SETTINGS,
		},
		urlOf(path),
	)

export const boot = (path: string, options: BootOptions = {}): Model => bootReturn(path, options).model

/** Folds Messages through the root update, dropping their Commands. */
export const after = (model: Model, messages: ReadonlyArray<Message>): Model =>
	messages.reduce((current, message) => update(current, message).model, model)

/** What the auth, `user.me`, organization and member Subscriptions report for a signed-in owner. */
export const sessionMessages = (member: Member | null = owner): ReadonlyArray<Message> => [
	Message.ChangedAuth({ auth: "SignedIn" }),
	Message.SucceededFetchCurrentUser({ user: ada }),
	Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazelOrg }),
	Message.UpdatedMember({ member }),
]

/** The app at `path` once the session has loaded (the org shell renders). */
export const signedIn = (path: string, member: Member | null = owner, options: BootOptions = {}): Model =>
	after(boot(path, options), sessionMessages(member))

/** Scene config for the root program; the view's `Document` is reduced to its body. */
export const rootScene = {
	update,
	view: (model: Model, h: HtmlBuilder<Message>) => view(model, h).body,
}

/** `Shared` as the root derives it for a signed-in owner of `hazel` (for overlay and shell tests). */
export const signedInShared = (member: Member | null = owner): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: ada,
	organization: hazelOrg,
	member,
	nowMs: 0,
	...sharedDefaults,
})
