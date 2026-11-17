import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "./composer"
import { mentionOptions } from "./options"

// ProseMirror's view reads `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const userId = (n: number) =>
	Schema.decodeSync(UserId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)

describe("mentionOptions", () => {
	test("a synced channel's Slack or Discord people carry their platform instead of presence", () => {
		const model: Composer.Model = {
			...Composer.init("composer-test"),
			autocomplete: { trigger: "mention", search: "da" },
			members: [
				{ userId: userId(1), firstName: "Dave", lastName: "Hazel", avatarUrl: null, provider: null },
				{ userId: userId(2), firstName: "Dana", lastName: "", avatarUrl: null, provider: "discord" },
			],
			presence: [{ userId: userId(1), status: "online" }],
		}
		expect(
			mentionOptions(model)
				.filter((option) => option.type === "user")
				.map(({ label, provider, status }) => ({ label, provider, status })),
		).toEqual([
			{ label: "Dave Hazel", provider: null, status: "online" },
			{ label: "Dana", provider: "discord", status: null },
		])
	})
})
