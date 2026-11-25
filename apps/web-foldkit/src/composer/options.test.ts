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

	test("groups come after @channel and @here, before people, as @handle with their size", () => {
		const model: Composer.Model = {
			...Composer.init("composer-test"),
			autocomplete: { trigger: "mention", search: "de" },
			members: [
				{ userId: userId(1), firstName: "Dede", lastName: "", avatarUrl: null, provider: null },
			],
			userGroups: [
				{ id: "g-1", handle: "design", name: "Design team", memberCount: 3 },
				{ id: "g-2", handle: "ops", name: "Operations", memberCount: 1 },
				{ id: "g-3", handle: "eng", name: "Developers", memberCount: 1 },
			],
		}
		expect(
			mentionOptions(model).map(({ type, label, description }) => ({ type, label, description })),
		).toEqual([
			{ type: "group", label: "@design", description: "Design team, 3 members" },
			// Found by name too.
			{ type: "group", label: "@eng", description: "Developers, 1 member" },
			{ type: "user", label: "Dede", description: null },
		])
	})
})
