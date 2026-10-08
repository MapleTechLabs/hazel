// @vitest-environment jsdom
import { Function } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import {
	AnnounceSelection,
	type ChoiceBoxItem,
	type ChoiceBoxOptions,
	choiceBox,
	FocusItem,
	init,
	Message,
	type Model,
	update,
} from "./choice-box"

/** ChoiceBox through the view: grid and row roles, selection state, keyboard and checkbox flows. */

const planItems: ReadonlyArray<ChoiceBoxItem> = [
	{ key: "free", label: "Free", description: "For trying things out" },
	{ key: "pro", label: "Pro", description: "For growing teams" },
	{ key: "enterprise", label: "Enterprise", description: "Talk to sales", isDisabled: true },
]

const viewWith =
	(options: Partial<ChoiceBoxOptions<Message>> = {}) =>
	(model: Model, h: HtmlBuilder<Message>) =>
		h.div(
			[],
			choiceBox(
				h,
				{ model, toParentMessage: Function.identity, ariaLabel: "Plan", ...options },
				planItems,
			),
		)

const config = { update, view: viewWith() }
const grid = Scene.role("grid", { name: "Plan" })
const row = (label: string) => Scene.role("row", { name: new RegExp(`^${label}`) })
const plan = init({ id: "plan", selectedKeys: ["pro"] })

describe("choice-box scene", () => {
	test("renders a labelled grid whose rows expose selection and disabled state", () => {
		Scene.scene(
			config,
			Scene.given(plan),
			Scene.expectAll(Scene.all.role("row")).toHaveCount(3),
			Scene.expect(grid).not.toHaveAttr("aria-multiselectable"),
			Scene.expect(row("Pro")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Free")).toHaveAttr("aria-selected", "false"),
			Scene.expect(row("Enterprise")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(row("Enterprise")).not.toHaveHandler("click"),
		)
	})

	test("clicking a row selects it and deselects the previous choice", () => {
		Scene.scene(
			config,
			Scene.given(plan),
			Scene.click(row("Free")),
			Scene.Command.expectNone(),
			Scene.expect(row("Free")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Free")).toHaveAttr("data-selected", "true"),
			Scene.expect(row("Pro")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("tabbing into the grid sends focus to the selected row", () => {
		Scene.scene(
			config,
			Scene.given(plan),
			Scene.focus(grid),
			Scene.Command.expectExact(FocusItem({ elementId: "plan-pro" })),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
		)
	})

	test("ArrowUp then Space selects the row above from the keyboard", () => {
		Scene.scene(
			config,
			Scene.given({ ...plan, focusedKey: "pro" }),
			Scene.keydown(grid, "ArrowUp"),
			Scene.Command.expectExact(FocusItem({ elementId: "plan-free" })),
			Scene.Command.resolve(FocusItem, Message.CompletedFocusItem()),
			Scene.keydown(grid, " "),
			Scene.expect(row("Free")).toHaveAttr("aria-selected", "true"),
		)
	})

	test("ArrowDown never lands on the disabled row", () => {
		Scene.scene(
			config,
			Scene.given({ ...plan, focusedKey: "pro" }),
			Scene.keydown(grid, "ArrowDown"),
			Scene.Command.expectNone(),
		)
	})

	test("keys that do not navigate or select are left to the browser", () => {
		Scene.scene(config, Scene.given(plan), Scene.keydown(grid, "a"), Scene.expectIgnored())
	})

	test("a read-only choice box ignores row clicks", () => {
		Scene.scene(
			{ update, view: viewWith({ isReadOnly: true }) },
			Scene.given(plan),
			Scene.expect(row("Free")).not.toHaveHandler("click"),
		)
	})

	// T3: read-only drops the keyboard toggle as well as the row click.
	test("a read-only choice box ignores Space on the focused row", () => {
		Scene.scene(
			{ update, view: viewWith({ isReadOnly: true }) },
			Scene.given({ ...plan, focusedKey: "free" }),
			Scene.keydown(grid, " "),
			Scene.expect(row("Free")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("multiple mode adds selection checkboxes that toggle their row and announce the count", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "plan", selectionMode: "multiple", selectedKeys: ["pro"] })),
			Scene.expect(grid).toHaveAttr("aria-multiselectable", "true"),
			Scene.click(Scene.selector("#plan-free label")),
			Scene.Command.expectExact(AnnounceSelection({ message: "2 items selected." })),
			Scene.Command.resolve(AnnounceSelection, Message.CompletedAnnounceSelection()),
			Scene.expect(row("Free")).toHaveAttr("aria-selected", "true"),
			Scene.expect(Scene.selector("#plan-free-selection")).toBeChecked(),
		)
	})

	// T2: a disabled row's selection checkbox is disabled too.
	test("a disabled row's selection checkbox cannot select it", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "plan", selectionMode: "multiple" })),
			Scene.expect(Scene.selector("#plan-enterprise label")).not.toHaveHandler("click"),
			Scene.expect(Scene.selector("#plan-enterprise-selection")).not.toHaveHandler("change"),
			Scene.expect(Scene.selector("#plan-enterprise-selection")).toBeDisabled(),
			Scene.expect(Scene.selector("#plan-enterprise-selection")).not.toBeChecked(),
		)
	})
})
