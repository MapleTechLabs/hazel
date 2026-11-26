import { describe, expect, test } from "vitest"
import { defineKeymap } from "./keymap"

const keymap = defineKeymap({
	open: { label: "Open", description: "", category: "A", defaultKey: "Mod+K" },
	inbox: { label: "Inbox", description: "", category: "A", defaultKey: "Mod+I" },
})

describe("defineKeymap (Foldkit bindings)", () => {
	test("bindings skip unbound actions", () => {
		const keys = keymap.resolve({ inbox: null }, "linux")
		const bindings = keymap.bindings(keys, ["open", "inbox"], (id) => ({ mapEvent: () => id }))
		expect(bindings.map((binding) => binding.keys)).toEqual(["Mod+K"])
	})
})
