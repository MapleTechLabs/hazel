// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Story } from "@effect/ui/testing"
import {
	type Dm,
	Dms,
	DmsMessage,
	ordered,
	partnerIds,
	presenceOf,
	RequestCompose,
	RequestNavigation,
} from "@hazel/shared-screens/dms/Dms"
import { dmTimeOf, previewOf, titleOf } from "@hazel/shared-screens/dms/format"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, it } from "vitest"

const me = UserId.make("00000002-0000-4000-8000-000000000001")
const grace = UserId.make("00000002-0000-4000-8000-000000000002")
const alan = UserId.make("00000002-0000-4000-8000-000000000003")
const graceDm = ChannelId.make("00000005-0000-4000-8000-000000000009")
const groupDm = ChannelId.make("00000005-0000-4000-8000-00000000000a")
const third = ChannelId.make("00000005-0000-4000-8000-00000000000b")
const NOW = Date.UTC(2026, 10, 26, 12, 0)

const props = {
	organizationId: OrganizationId.make("00000001-0000-4000-8000-000000000001"),
	userId: me,
	orgSlug: "hazel",
	nowMs: NOW,
}

const person = (userId: UserId, firstName: string, lastName: string) => ({
	userId,
	firstName,
	lastName,
	avatarUrl: null,
})
const ada = person(me, "Ada", "Lovelace")
const gracePerson = person(grace, "Grace", "Hopper")
const alanPerson = person(alan, "Alan", "Turing")

const dm = (id: ChannelId, patch: Partial<Dm>): Dm => ({
	id,
	name: "",
	type: "single",
	isMuted: false,
	unread: 0,
	lastMessageAtMs: null,
	lastMessageAuthorId: null,
	lastMessagePreview: null,
	...patch,
})

describe("Dms story", () => {
	it("starts loading, with the clock from props and the DM query subscribed", () => {
		const s = Story.start(Dms, props)
		expect(s.model.loaded).toBe(false)
		expect(s.model.nowMs).toBe(NOW)
		// Keyed by name and dependencies; the members and presence queries wait for rows.
		expect(s.subscriptions.map((key) => key.split(":")[0])).toEqual([
			"dms",
			"members",
			"presence",
			"clock",
		])
	})

	it("takes live rows, members and presence, and follows the partners", () => {
		const s = Story.start(Dms, props)
		s.send(
			DmsMessage.UpdatedDms({
				dms: [
					dm(graceDm, { unread: 2, lastMessageAtMs: NOW - 4 * 60_000 }),
					dm(groupDm, { type: "direct" }),
				],
			}),
		)
		expect(s.model.loaded).toBe(true)
		expect(s.model.dms).toHaveLength(2)
		s.send(
			DmsMessage.UpdatedMembers({
				members: { [graceDm]: [ada, gracePerson], [groupDm]: [ada, gracePerson, alanPerson] },
			}),
		)
		// Only a one-to-one DM's partner has a presence to show.
		expect(partnerIds(s.model, me)).toEqual([grace])
		s.send(DmsMessage.UpdatedPresence({ presence: { [grace]: "online" } }))
		expect(s.model.presence[grace]).toBe("online")
	})

	it("switches the filter and moves the clock", () => {
		const s = Story.start(Dms, props)
		s.send(DmsMessage.PressedFilter({ filter: "unreads" }))
		expect(s.model.filter).toBe("unreads")
		s.send(DmsMessage.Ticked({ nowMs: NOW + 60_000 }))
		expect(s.model.nowMs).toBe(NOW + 60_000)
	})

	it("asks the host to open a DM, and to compose", () => {
		const s = Story.start(Dms, props)
		s.send(DmsMessage.PressedDm({ id: graceDm })).expectExact(RequestNavigation)
		expect(s.pending[0]?.command.args).toEqual({ channelId: graceDm })
		s.resolve(RequestNavigation, DmsMessage.CompletedRequestNavigation())
		s.send(DmsMessage.PressedCompose()).expectExact(RequestCompose)
		s.resolve(RequestCompose, DmsMessage.CompletedRequestCompose())
		expect(s.pending).toHaveLength(0)
	})
})

describe("Dms rows", () => {
	it("orders newest first, with no-message DMs last", () => {
		const rows = ordered([
			dm(groupDm, {}),
			dm(graceDm, { lastMessageAtMs: NOW - 1 }),
			dm(third, { lastMessageAtMs: NOW - 10 }),
		])
		expect(rows.map((row) => row.id)).toEqual([graceDm, third, groupDm])
	})

	it("titles and previews as today's DMs tab", () => {
		const single = dm(graceDm, {
			lastMessageAtMs: NOW,
			lastMessageAuthorId: grace,
			lastMessagePreview: "Sent it",
		})
		expect(titleOf(single, [gracePerson])).toBe("Grace Hopper")
		expect(previewOf(single, [ada, gracePerson], [gracePerson], me)).toBe("Sent it")
		const group = dm(groupDm, {
			type: "direct",
			lastMessageAtMs: NOW,
			lastMessageAuthorId: alan,
			lastMessagePreview: "Ship it",
		})
		const others = [gracePerson, alanPerson]
		expect(titleOf(group, others)).toBe("Grace, Alan")
		expect(previewOf(group, [ada, ...others], others, me)).toBe("Alan: Ship it")
		expect(previewOf({ ...group, lastMessageAuthorId: me }, [ada, ...others], others, me)).toBe(
			"You: Ship it",
		)
		expect(previewOf({ ...group, lastMessageAtMs: null }, [ada, ...others], others, me)).toBe("3 people")
		expect(previewOf({ ...single, lastMessageAtMs: null }, [ada], [gracePerson], me)).toBe("Say hello 👋")
	})

	it("formats times short, and maps presence onto the avatar's options", () => {
		expect(dmTimeOf(NOW - 20_000, NOW)).toBe("now")
		expect(dmTimeOf(NOW - 12 * 60_000, NOW)).toBe("12m")
		expect(presenceOf("dnd")).toBe("busy")
		expect(presenceOf(undefined)).toBe("offline")
	})
})
