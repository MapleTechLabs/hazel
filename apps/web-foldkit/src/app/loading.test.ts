// @vitest-environment jsdom
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import * as Scene from "foldkit/scene"
import { Mount, expect as sceneExpect, given, role, scene, text } from "foldkit/scene"
import { fromString } from "foldkit/url"
import { describe, expect, test } from "vitest"
import { init, update } from "../main"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { defaultThemePreference } from "../theme"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import { urlOf } from "../test/root-fixtures"
import { CheckSession, FetchCurrentUser } from "./command"
import { Message } from "./message"
import { type Model, sharedOf } from "./model"
import { view } from "./view"

/** `_app/layout.tsx` and `$orgSlug/layout.tsx`: the full-page loader until `user.me` and the org answer. */

const ada = {
	id: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001"),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
	organizationId: null,
}
const hazel = {
	id: Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000002"),
	name: "Hazel",
	slug: "hazel",
	logoUrl: null,
}

const boot = (path: string): Model =>
	Option.match(fromString(`http://localhost${path}`), {
		onNone: () => expect.unreachable("url"),
		onSome: (url) =>
			init(
				{
					themePreference: defaultThemePreference(),
					systemTheme: "light",
					soundSettings: DEFAULT_SOUND_SETTINGS,
					sessionStartMs: 0,
					isMobile: false,
					isCreateChannelHintDismissed: false,
				},
				url,
			).model,
	})

const after = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message).model, model)

const config = { update, view: (model: Model, h: Parameters<typeof view>[1]) => view(model, h).body }
const loader = role("progressbar", { name: "Loading" })
const reload = role("button", { name: "Reload" })
const tryAgain = role("button", { name: "Try again" })

/** Whether the root renders the loader (`<ProgressBar aria-label="Loading">`). */
const expectLoader = (model: Model, isShown: boolean) =>
	isShown
		? scene(config, given(model), sceneExpect(loader).toExist())
		: scene(
				config,
				given(model),
				sceneExpect(loader).toBeAbsent(),
				// The sidebar's two section menus focus their trigger on press.
				Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
				Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress()),
			)

describe("root loading states", () => {
	test("a signed-in org route waits for user.me, then for the organization", () => {
		const signedIn = after(boot("/hazel/settings/team"), [Message.ChangedAuth({ auth: "SignedIn" })])
		expectLoader(signedIn, true)
		const withUser = after(signedIn, [Message.SucceededFetchCurrentUser({ user: ada })])
		expectLoader(withUser, true)
		const withOrg = after(withUser, [
			Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazel }),
		])
		expectLoader(withOrg, false)
	})

	test("an unknown slug says so once its query answers, with a way back", () => {
		const model = after(boot("/nope/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			Message.SucceededFetchCurrentUser({ user: ada }),
			Message.UpdatedOrganization({ orgSlug: "nope", organization: null }),
		])
		scene(
			config,
			given(model),
			sceneExpect(loader).toBeAbsent(),
			sceneExpect(text("Workspace not found")).toExist(),
			sceneExpect(role("link", { name: "Go to your workspace" })).toHaveAttr("href", "/"),
		)
	})

	test("a stalled organization keeps the loader and offers a reload, until the org arrives", () => {
		const withUser = after(boot("/hazel/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			Message.SucceededFetchCurrentUser({ user: ada }),
		])
		scene(config, given(withUser), sceneExpect(reload).toBeAbsent())
		const stalled = after(withUser, [Message.StalledOrganization({ orgSlug: "hazel" })])
		scene(config, given(stalled), sceneExpect(loader).toExist(), sceneExpect(reload).toExist())
		expectLoader(
			after(stalled, [Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazel })]),
			false,
		)
	})

	test("a stall after the organization loaded leaves the shell up", () => {
		const loaded = after(boot("/hazel/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			Message.SucceededFetchCurrentUser({ user: ada }),
			Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazel }),
			Message.StalledOrganization({ orgSlug: "hazel" }),
		])
		expectLoader(loaded, false)
	})

	// P0: an unreachable API is not "signed out": the app says it can't reach Hazel and offers Try again.
	test("an unanswered session check shows the error with Try again, never sign-in", () => {
		const unreachable = after(boot("/hazel/settings/team"), [
			Message.FailedCheckSession({ reason: "Offline" }),
		])
		scene(
			config,
			given(unreachable),
			sceneExpect(loader).toBeAbsent(),
			sceneExpect(text("Can't reach Hazel")).toExist(),
			sceneExpect(tryAgain).toExist(),
			Scene.click(tryAgain),
			Scene.Command.expectHas(CheckSession()),
			Scene.Command.resolve(CheckSession, Message.ChangedAuth({ auth: "SignedIn" })),
			Scene.Command.resolve(FetchCurrentUser, Message.SucceededFetchCurrentUser({ user: ada })),
			sceneExpect(loader).toExist(),
		)
	})

	test("a user.me that keeps failing shows the error once its retries ran out", () => {
		const offline = Message.FailedFetchCurrentUser({ reason: "Offline" })
		const retrying = after(boot("/hazel/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			offline,
		])
		scene(config, given(retrying), sceneExpect(loader).toExist())
		const failed = after(retrying, [offline, offline, offline])
		scene(
			config,
			given(failed),
			sceneExpect(text("Couldn't load your account")).toExist(),
			sceneExpect(tryAgain).toExist(),
		)
	})

	test("switching organizations drops the previous organization's role", () => {
		const acme = {
			...hazel,
			id: Schema.decodeSync(OrganizationId)("00000000-0000-4000-8000-000000000003"),
			slug: "acme",
		}
		const member = {
			id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000004"),
			role: "owner" as const,
		}
		const inHazel = after(boot("/hazel/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			Message.SucceededFetchCurrentUser({ user: ada }),
			Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazel }),
			Message.UpdatedMember({ organizationId: hazel.id, member }),
		])
		expect(
			sharedOf(after(inHazel, [Message.UpdatedOrganization({ orgSlug: "hazel", organization: hazel })]))
				.member,
		).toEqual(member)
		const inAcme = after(inHazel, [
			Message.ChangedUrl({ url: urlOf("/acme/settings/team") }),
			Message.UpdatedOrganization({ orgSlug: "acme", organization: acme }),
		])
		expect(sharedOf(inAcme).organization).toEqual(acme)
		expect(sharedOf(inAcme).member).toBeNull()
	})
})
