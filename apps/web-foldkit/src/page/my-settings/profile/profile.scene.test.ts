// @vitest-environment jsdom
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import type { Shared } from "../../contract"
import * as ComboBox from "../../../ui/combo-box"
import { Message } from "./message"
import { init, update } from "./update"
import { profileView } from "./view"

/** The profile form through its view: typing validates and toggles Save, as the legacy form does. */

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
		organizationId: null,
	},
	organization: null,
	member: null,
	nowMs: 0,
}

const config = {
	update: (model: Parameters<typeof update>[0], message: Message) => update(model, message, shared),
	view: (model: Parameters<typeof update>[0], h: Parameters<typeof profileView>[2]) =>
		profileView(model, shared, h),
}

const save = Scene.role("button", { name: "Save" })

/** The timezone ComboBox mounts its input-focus keeper on the first render (raw child Message). */
const comboBoxMounted = Scene.Mount.resolve(
	{ name: "KeepComboBoxInputFocus" },
	ComboBox.Message.CompletedPortalComboBox(),
)

describe("profile form scene", () => {
	test("Save is disabled until a field changes", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxMounted,
			Scene.expect(save).toBeDisabled(),
			Scene.type("#profile-first-name-input", "Augusta Ada"),
			Scene.expect(save).toBeEnabled(),
		)
	})

	test("clearing the last name shows the error and disables Save", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, shared).model),
			comboBoxMounted,
			Scene.type("#profile-last-name-input", ""),
			Scene.expect(Scene.text("lastName must be non-empty")).toExist(),
			Scene.expect(save).toBeDisabled(),
		)
	})
})
