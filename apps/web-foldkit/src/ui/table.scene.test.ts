// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { installCssEscape } from "../test/kit-collections-fixtures"
import { Announce, init, Message, update } from "./table"
import { view } from "./table-view"

installCssEscape()

/** Table through the view: grid, columnheader aria-sort, row aria-selected, select all, keyboard. */

const sceneView = Scene.withViewInputs(view, {
	label: "Members",
	columns: [
		{ key: "name", content: "Name", isRowHeader: true, allowsSorting: true },
		{ key: "role", content: "Role" },
	],
	rows: [
		{ key: "ada", cells: ["Ada Lovelace", "Owner"] },
		{ key: "grace", cells: ["Grace Hopper", "Admin"] },
		{ key: "katherine", cells: ["Katherine Johnson", "Guest"], isDisabled: true },
		{ key: "alan", cells: ["Alan Turing", "Member"] },
	],
})
const config = { update, view: sceneView() }
const row = (name: string) => Scene.role("row", { name })
const column = (name: string) => Scene.role("columnheader", { name: new RegExp(`^${name}`) })
const resolveAnnouncement = Scene.Command.resolve(Announce, Message.CompletedAnnounce())

describe("table scene", () => {
	test("renders a labelled grid with sortable headers, row headers and disabled rows", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "members" })),
			Scene.expect(Scene.role("grid", { name: "Members" })).toExist(),
			Scene.expect(column("Name")).toHaveAttr("aria-sort", "none"),
			Scene.expect(column("Role")).not.toHaveAttr("aria-sort"),
			Scene.expect(Scene.role("rowheader", { name: "Ada Lovelace" })).toExist(),
			Scene.expect(row("Katherine Johnson")).toHaveAttr("aria-disabled", "true"),
			Scene.expect(row("Ada Lovelace")).not.toHaveAttr("aria-selected"),
		)
	})

	test("clicking a sortable header sorts ascending, then descending", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "members" })),
			Scene.click(column("Name")),
			resolveAnnouncement,
			Scene.expect(column("Name")).toHaveAttr("aria-sort", "ascending"),
			Scene.click(column("Name")),
			resolveAnnouncement,
			Scene.expect(column("Name")).toHaveAttr("aria-sort", "descending"),
			Scene.expect(column("Name")).toHaveAttr("data-sort-direction", "descending"),
		)
	})

	test("a header that does not sort has no click handler", () => {
		Scene.scene(config, Scene.given(init({ id: "members" })), Scene.expect(column("Role")).not.toHaveHandler("click"))
	})

	test("pressing a row in single mode selects it and announces its row header", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "members", selectionMode: "single" })),
			Scene.pointerDown(row("Grace Hopper")),
			Scene.Command.expectExact(Announce({ message: "Grace Hopper selected.", timeout: 7000 })),
			resolveAnnouncement,
			Scene.expect(row("Grace Hopper")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Ada Lovelace")).toHaveAttr("aria-selected", "false"),
			Scene.expect(row("Katherine Johnson")).not.toHaveHandler("pointerdown"),
		)
	})

	test("ArrowDown from a cell skips the disabled row and selects the next one in single mode", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "members", selectionMode: "single", selectedKeys: ["grace"] })),
			Scene.keydown(Scene.role("gridcell", { name: "Admin" }), "ArrowDown"),
			Scene.Command.expectExact(Announce({ message: "Alan Turing selected.", timeout: 7000 })),
			resolveAnnouncement,
			Scene.expect(row("Alan Turing")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Grace Hopper")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("multiple mode adds a Select All header that is indeterminate while some rows are selected", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "invite", selectionMode: "multiple", selectedKeys: ["grace"] })),
			Scene.expect(Scene.role("checkbox", { name: "Select All" })).not.toBeChecked(),
			Scene.expect(Scene.selector("#invite-__selection label")).toHaveAttr("data-indeterminate", "true"),
			Scene.expect(row("Grace Hopper")).toHaveAttr("aria-selected", "true"),
			Scene.expect(Scene.selector("#invite-row-grace-select")).toBeChecked(),
			Scene.expect(Scene.selector("#invite-row-katherine-select")).toBeDisabled(),
		)
	})

	test("Select All selects every enabled row but leaves the disabled one alone", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "invite", selectionMode: "multiple", selectedKeys: ["grace"] })),
			Scene.click(Scene.selector("#invite-__selection label")),
			Scene.Command.expectExact(Announce({ message: "All items selected.", timeout: 7000 })),
			resolveAnnouncement,
			Scene.expect(Scene.role("checkbox", { name: "Select All" })).toBeChecked(),
			Scene.expect(row("Ada Lovelace")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Alan Turing")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Katherine Johnson")).toHaveAttr("aria-selected", "false"),
		)
	})

	test("pressing a row in multiple mode toggles it without touching the others", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "invite", selectionMode: "multiple", selectedKeys: ["grace"] })),
			Scene.pointerDown(row("Ada Lovelace")),
			Scene.Command.expectExact(Announce({ message: "Ada Lovelace selected. 2 items selected.", timeout: 7000 })),
			resolveAnnouncement,
			Scene.expect(row("Ada Lovelace")).toHaveAttr("aria-selected", "true"),
			Scene.expect(row("Grace Hopper")).toHaveAttr("aria-selected", "true"),
		)
	})

	test("a table without rows shows its empty state", () => {
		Scene.scene(
			{ update, view: sceneView({ rows: [], emptyState: ["No members yet"] }) },
			Scene.given(init({ id: "empty" })),
			Scene.expect(Scene.role("rowheader")).toHaveText("No members yet"),
			Scene.expectAll(Scene.all.role("row")).toHaveCount(2),
		)
	})
})
