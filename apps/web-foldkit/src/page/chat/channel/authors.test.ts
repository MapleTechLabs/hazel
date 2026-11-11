// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest"
import { toDeriveContext } from "../derive"
import { emptyLookups, type UserInfo } from "../lookups"
import { starterNameOf } from "../thread-panel"
import type { MessageRow } from "../rows"
import { ada, grace, loadedMessages, messages, shared } from "./fixtures.test-support"
import { init, Message, type Model, update } from "./page"

/**
 * Messages carry no author (their query does not wait on the org's users); each row's author comes
 * from the users lookup, which may answer before or after the messages.
 */

// The Files tab's `ui/aria/interaction` and ProseMirror's view read `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const user = (id: UserInfo["id"], firstName: string, userType = "user"): UserInfo => ({
	id,
	firstName,
	lastName: "Test",
	email: `${firstName.toLowerCase()}@hazel.sh`,
	avatarUrl: `https://img.test/${firstName}.png`,
	userType,
	timezone: null,
})

const users = [user(ada, "Ada"), user(grace, "Grace")]

const apply = (model: Model, ...steps: ReadonlyArray<Message>): Model =>
	steps.reduce((current, step) => update(current, step, shared).model, model)

const authorsOf = (model: Model) =>
	model.rows
		.filter((row): row is MessageRow => row._tag === "MessageRow")
		.map((row) => [row.message.content, row.author.displayName, row.author.avatarUrl])

const hasAuthor = (model: Model) =>
	model.rows.filter((row): row is MessageRow => row._tag === "MessageRow").map((row) => row.hasAuthor)

const start = () => init(messages[0]!.channelId, "hazel", ada)

describe("message authors", () => {
	test("messages show as soon as they arrive, before the users lookup", () => {
		const model = apply(start(), loadedMessages(messages))
		expect(model.hasLoadedMessages).toBe(true)
		// No header until the author is known.
		expect(hasAuthor(model)).toEqual([false, false])
		expect(authorsOf(model)).toEqual([
			["Launch window confirmed", "", null],
			["Shipped the onboarding copy", "", null],
		])
	})

	test("authors fill in when the users lookup answers after the messages", () => {
		const model = apply(start(), loadedMessages(messages), Message.UpdatedUsers({ users }))
		expect(authorsOf(model)).toEqual([
			["Launch window confirmed", "Grace Test", "https://img.test/Grace.png"],
			["Shipped the onboarding copy", "Ada Test", "https://img.test/Ada.png"],
		])
		expect(hasAuthor(model)).toEqual([true, true])
	})

	test("authors are there at once when the users lookup answered first", () => {
		const model = apply(start(), Message.UpdatedUsers({ users }), loadedMessages(messages))
		expect(authorsOf(model).map(([, name]) => name)).toEqual(["Grace Test", "Ada Test"])
	})

	test("a bot author shows its bot name", () => {
		const model = apply(
			start(),
			Message.UpdatedUsers({ users: [user(ada, "Ada"), user(grace, "Grace", "machine")] }),
			Message.UpdatedBots({ bots: [{ userId: grace, name: "Maple" }] }),
			loadedMessages(messages),
		)
		const graceRow = model.rows.find(
			(row): row is MessageRow => row._tag === "MessageRow" && row.message.authorId === grace,
		)!
		expect(graceRow.author).toMatchObject({ displayName: "Maple", isBot: true })
	})
})

describe("thread starter", () => {
	const original = messages[1]!
	const contextWith = (known: ReadonlyArray<UserInfo>) =>
		toDeriveContext({ ...emptyLookups, users: known }, ada)

	test('no "Started by" until the users lookup has the author', () => {
		expect(starterNameOf(contextWith([]), original)).toBeNull()
	})

	test("the author's name once it has them", () => {
		expect(starterNameOf(contextWith(users), original)).toBe("Grace Test")
	})
})
