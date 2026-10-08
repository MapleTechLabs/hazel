// @vitest-environment jsdom
import { OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Mount, expect as sceneExpect, given, role, scene } from "foldkit/scene"
import { fromString } from "foldkit/url"
import { describe, expect, test } from "vitest"
import { init, update } from "../main"
import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { defaultThemePreference } from "../theme"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import { Message } from "./message"
import type { Model } from "./model"
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
				},
				url,
			).model,
	})

const after = (model: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, message) => update(current, message).model, model)

const config = { update, view: (model: Model, h: Parameters<typeof view>[1]) => view(model, h).body }
const loader = role("progressbar", { name: "Loading" })

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

	test("an unknown slug stops loading once its query answers", () => {
		const model = after(boot("/nope/settings/team"), [
			Message.ChangedAuth({ auth: "SignedIn" }),
			Message.SucceededFetchCurrentUser({ user: ada }),
			Message.UpdatedOrganization({ orgSlug: "nope", organization: null }),
		])
		expectLoader(model, false)
	})
})
