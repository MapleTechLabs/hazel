// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Scene } from "@effect/ui/testing"
import { UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { CreateDmMessage, CreateDmModalNoDeps, StartConversation } from "./CreateDmModal"
import { ModalEvents } from "./feedback"
import {
	ClearStatus,
	expirationDate,
	SaveStatus,
	SetStatusMessage,
	SetStatusModalNoDeps,
} from "./SetStatusModal"
import { ada, button, byProp, organizationId, session, subscriptionKey, typed } from "./test-support"

/** Start a conversation, and set a status. */

const close = ModalEvents.RequestedClose()
const grace = {
	id: UserId.make("00000001-0000-4000-8000-000000000002"),
	firstName: "Grace",
	lastName: "Hopper",
	avatarUrl: null,
	online: true,
	customMessage: null,
}
const alan = {
	...grace,
	id: UserId.make("00000001-0000-4000-8000-000000000003"),
	firstName: "Alan",
	lastName: "Turing",
	online: false,
	customMessage: "Numbers",
}
const me = { ...grace, id: ada.id, firstName: "Ada", lastName: "Lovelace" }
const row = (title: string) => byProp("item", "title", title)

describe("create DM modal", () => {
	const start = () =>
		Scene.start(CreateDmModalNoDeps, { session }).subscription(
			subscriptionKey("users", organizationId),
			CreateDmMessage.UpdatedUsers({ users: [me, grace, alan] }),
		)

	test("lists everyone else, searchable", () => {
		const s = start().expect(row("Ada Lovelace")).toBeAbsent()
		expect(s.get(row("Grace Hopper")).props?.["subtitle"]).toBe("Active now")
		expect(s.get(row("Alan Turing")).props?.["subtitle"]).toBe("Numbers")
		s.fire(byProp("searchField", "placeholder", "Search team members..."), "change", typed("tur"))
			.expect(row("Grace Hopper"))
			.toBeAbsent()
	})

	test("one person starts a direct conversation, and the modal closes", () => {
		const s = start().fire(row("Grace Hopper"), "press")
		expect(s.get(row("Grace Hopper")).props?.["selected"]).toBe(true)
		s.fire(button("Start conversation"), "press")
			.expectExact(
				StartConversation.make({
					organizationId,
					orgSlug: "hazel",
					currentUserId: ada.id,
					participantIds: [grace.id],
					name: null,
					created: "Started conversation with Grace",
				}),
			)
			.resolve(StartConversation, CreateDmMessage.SucceededStartConversation())
			.emitted(close)
	})

	test("several people make a named group", () => {
		start()
			.fire(row("Grace Hopper"), "press")
			.fire(row("Alan Turing"), "press")
			.fire(button("Start group conversation (2)"), "press")
			.expectExact(
				StartConversation.make({
					organizationId,
					orgSlug: "hazel",
					currentUserId: ada.id,
					participantIds: [grace.id, alan.id],
					name: "Grace, Alan",
					created: "Created group conversation with 2 people",
				}),
			)
			.resolve(StartConversation, CreateDmMessage.FailedStartConversation())
			.expect(button("Start group conversation (2)"))
			.toExist()
	})
})

describe("set status modal", () => {
	const nowMs = new Date(2026, 10, 26, 15, 20).getTime()
	const start = () => Scene.start(SetStatusModalNoDeps, { session, nowMs })

	test("save is off until there is an emoji or a message; a preset fills both", () => {
		const s = start()
		expect(s.get(button("Save")).props?.["disabled"]).toBe(true)
		s.fire(byProp("choiceGroup", "label", "Quick presets"), "change", { selected: ["Commuting"] })
		expect(s.get(button("🚗")).props).toBeDefined()
		expect(s.get(byProp("textField", "label", "Status")).props?.["value"]).toMatchObject({
			text: "Commuting",
		})
		s.fire(button("Save"), "press")
			.expectExact(
				SaveStatus.make({
					statusEmoji: "🚗",
					customMessage: "Commuting",
					expiration: "never",
					customDate: null,
					customTime: null,
					suppressNotifications: false,
				}),
			)
			.resolve(SaveStatus, SetStatusMessage.SucceededSaveStatus())
			.emitted(close)
	})

	test("a custom expiry starts at today and the next hour, and needs both", () => {
		const s = start()
			.fire(byProp("textField", "label", "Status"), "change", typed("Heads down"))
			.fire(byProp("select", "label", "Clear after"), "change", { value: "custom" })
		expect(s.get(byProp("datePicker", "label", "Date")).props?.["value"]).toBe("2026-11-26")
		expect(s.get(byProp("datePicker", "label", "Time")).props?.["value"]).toBe("16:00")
		s.fire(byProp("datePicker", "label", "Time"), "change", { value: null })
		expect(s.get(button("Save")).props?.["disabled"]).toBe(true)
	})

	test("an existing status can be cleared", () => {
		start()
			.expect(button("Clear status"))
			.toBeAbsent()
			.subscription(
				subscriptionKey("presence", ada.id),
				SetStatusMessage.UpdatedPresence({ presence: { statusEmoji: "🌴", customMessage: null } }),
			)
			.fire(button("Clear status"), "press")
			.expectExact(ClearStatus.make({}))
			.resolve(ClearStatus, SetStatusMessage.SucceededSaveStatus())
			.emitted(close)
	})

	test("expiry times are today's rules", () => {
		const now = new Date(2026, 10, 26, 15, 20)
		expect(expirationDate("never", null, null, now)).toBeNull()
		expect(expirationDate("30min", null, null, now)?.getTime()).toBe(now.getTime() + 30 * 60 * 1000)
		expect(expirationDate("today", null, null, now)?.getHours()).toBe(23)
		expect(expirationDate("custom", "2026-11-30", "09:30", now)).toEqual(new Date(2026, 10, 30, 9, 30))
	})
})
