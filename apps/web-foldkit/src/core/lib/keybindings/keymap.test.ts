import { describe, expect, test } from "vitest"
import { appKeymap } from "./app-keymap"
import { combo, identityOf, isTypingSafe, type Platform } from "./key-combo"
import { defineKeymap } from "./keymap"

const keymap = defineKeymap({
	open: { label: "Open", description: "", category: "A", defaultKey: "Mod+K" },
	search: { label: "Search", description: "", category: "A", defaultKey: "Mod+Shift+F" },
	inbox: { label: "Inbox", description: "", category: "A", defaultKey: "Mod+I" },
	bold: { label: "Bold", description: "", category: "B", defaultKey: "Mod+B", rebindable: false },
})

describe("defineKeymap", () => {
	test("with no overrides every action has its default", () => {
		expect(keymap.resolve({}, "mac")).toEqual({
			open: "Mod+K",
			search: "Mod+Shift+F",
			inbox: "Mod+I",
			bold: "Mod+B",
		})
	})

	test("the same overrides resolve to the same table, per platform", () => {
		const overrides = { open: combo("Mod+P") }
		expect(keymap.resolve(overrides, "mac")).toBe(keymap.resolve(overrides, "mac"))
		expect(keymap.resolve(overrides, "windows")).not.toBe(keymap.resolve(overrides, "mac"))
		expect(keymap.resolve({ ...overrides }, "mac")).toEqual(keymap.resolve(overrides, "mac"))
	})

	test("an override replaces the default; null unbinds", () => {
		expect(keymap.resolve({ open: combo("Mod+P"), inbox: null }, "mac")).toMatchObject({
			open: "Mod+P",
			inbox: null,
		})
	})

	test("a default an override took is dropped, so no two actions share a key", () => {
		// Meta+K is Mod+K on a Mac, but not on Windows.
		expect(keymap.resolve({ search: combo("Meta+K") }, "mac").open).toBeNull()
		expect(keymap.resolve({ search: combo("Meta+K") }, "windows").open).toBe("Mod+K")
	})

	test("assign takes the key from the action that had it", () => {
		const { overrides, displaced, shadows } = keymap.assign({}, "search", combo("Mod+K"), "linux")
		expect(displaced).toEqual(["open"])
		expect(shadows).toEqual([])
		expect(keymap.resolve(overrides, "linux")).toMatchObject({ search: "Mod+K", open: null })
	})

	test("assign reports a fixed key it shadows", () => {
		expect(keymap.assign({}, "inbox", combo("Mod+B"), "linux").shadows).toEqual(["bold"])
	})

	test("assigning an action's own default clears its override", () => {
		const moved = keymap.assign({}, "open", combo("Mod+P"), "linux").overrides
		expect(keymap.assign(moved, "open", combo("Mod+K"), "linux").overrides).toEqual({})
	})

	test("reset and unbind", () => {
		expect(keymap.reset({ open: combo("Mod+P") }, "open", "linux")).toEqual({
			overrides: {},
			displaced: [],
		})
		expect(keymap.unbind({}, "open")).toEqual({ open: null })
	})

	test("reset takes the default key back from the action that was given it", () => {
		const moved = keymap.assign({}, "search", combo("Mod+K"), "linux").overrides
		const { overrides, displaced } = keymap.reset(moved, "open", "linux")
		expect(displaced).toEqual(["search"])
		expect(keymap.resolve(overrides, "linux")).toMatchObject({ open: "Mod+K", search: null })
	})

	test("clean drops unknown actions, fixed actions, and values that are not a safe key", () => {
		expect(
			keymap.clean({
				open: "Mod+P",
				removed: "Mod+J",
				bold: "Mod+J",
				search: "Mod+",
				inbox: null,
			}),
		).toEqual({ open: "Mod+P", inbox: null })
		// One bad entry (a number, a bare letter) leaves the rest.
		expect(keymap.clean({ open: 42, search: "J", inbox: "Mod+J" })).toEqual({ inbox: "Mod+J" })
	})

	test("bindings skip unbound actions", () => {
		const keys = keymap.resolve({ inbox: null }, "linux")
		const bindings = keymap.bindings(keys, ["open", "inbox"], (id) => ({ mapEvent: () => id }))
		expect(bindings.map((binding) => binding.keys)).toEqual(["Mod+K"])
	})
})

describe("appKeymap", () => {
	test.each<Platform>(["mac", "windows", "linux"])(
		"no two rebindable defaults share a key on %s",
		(platform) => {
			const seen = new Map<string, string>()
			for (const action of appKeymap.actions) {
				if (!action.rebindable || action.defaultKey === null) continue
				const identity = identityOf(action.defaultKey, platform)
				expect(seen.get(identity), `${action.id} and ${seen.get(identity)}`).toBeUndefined()
				seen.set(identity, action.id)
			}
		},
	)

	test("with no overrides every action keeps its default", () => {
		expect(appKeymap.resolve({}, "mac")).toEqual(appKeymap.defaults)
	})

	test("every rebindable default is safe to bind, so Reset never restores a key the recorder refuses", () => {
		for (const action of appKeymap.actions) {
			if (action.rebindable && action.defaultKey !== null)
				expect(isTypingSafe(action.defaultKey), action.id).toBe(true)
		}
	})
})
