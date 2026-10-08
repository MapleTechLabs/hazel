// @vitest-environment jsdom
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import * as Select from "../../../ui/select"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { GenerateRemixOptions } from "./command"
import { Message } from "./message"
import { Customization } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The appearance page through its view: every pick asks the root to apply and persist the theme. */

const shared = makeShared()
const { mode, customization } = shared.theme
const ocean = Schema.decodeSync(Customization)({
	primary: "#0EA5E9",
	grayPalette: "gray-cool",
	radius: "round",
})
/** The gray palette Select's trigger mounts its focus-on-press keeper on the first render. */
const selectTriggerMounted = Scene.Mount.resolve(
	{ name: "FocusSelectTriggerOnPress" },
	Select.Message.CompletedPortalSelect(),
)
const themeRequest = (preference: { mode: typeof mode; customization: Customization }) =>
	PageOutMessage.RequestedTheme({ preference })

describe("appearance scene", () => {
	test("picking Dark mode keeps the customization", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			selectTriggerMounted,
			Scene.click(Scene.role("radio", { name: "Dark mode" })),
			Scene.expectOutMessage(themeRequest({ mode: "dark", customization })),
		)
	})

	// Bug: ui/aria-radio uses `#${groupId}-${value}` as focusSelector; a hex value makes it invalid CSS, so querySelector throws before dispatch.
	test("a brand color swatch changes only the primary color", () => {
		const green = Schema.decodeSync(Customization)({ ...customization, primary: "#099250" })
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			selectTriggerMounted,
			Scene.click(Scene.role("radio", { name: "green" })),
			Scene.expectOutMessage(themeRequest({ mode, customization: green })),
		)
	})

	test("Generate lists remix options, and picking one applies it", () => {
		const hint = Scene.text("Click generate to create random theme combinations.")
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(undefined, shared).model),
			selectTriggerMounted,
			Scene.expect(hint).toExist(),
			Scene.click(Scene.role("button", { name: /Generate/ })),
			Scene.Command.expectExact(GenerateRemixOptions),
			Scene.Command.resolve(GenerateRemixOptions, Message.GeneratedRemixOptions({ options: [ocean] })),
			Scene.expect(hint).toBeAbsent(),
			Scene.click(Scene.role("button", { name: /#0EA5E9/ })),
			Scene.expectOutMessage(themeRequest({ mode, customization: ocean })),
		)
	})
})
