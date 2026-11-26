// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The sidebar's Model and update as Stories: what each message does and which Command it asks for. */
import { Story } from "@effect/ui/testing"
import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
	ChannelSidebar,
	NavTarget,
	RequestNavigation,
	RequestSidebarAction,
	SidebarAction,
	SidebarMessage,
} from "./ChannelSidebar"
import { channelMenu, type Entry, listedThreads, sectionActionsOf, sectionMenu, unreadSetOf } from "./model"

const general = ChannelId.make("00000005-0000-4000-8000-000000000001")
const design = ChannelId.make("00000005-0000-4000-8000-000000000005")
const team = ChannelSectionId.make("00000004-0000-4000-8000-000000000001")

const props = {
	organizationId: OrganizationId.make("00000001-0000-4000-8000-000000000001"),
	userId: UserId.make("00000002-0000-4000-8000-000000000001"),
	orgSlug: "hazel",
	activeChannelId: general,
	membersActive: false,
	hintDismissed: false,
	paletteKey: null,
	chrome: false,
}

const entry = (id: ChannelId, overrides: Partial<Entry> = {}): Entry => ({
	id,
	name: "general",
	type: "public",
	icon: null,
	sectionId: team,
	memberId: ChannelMemberId.make("00000007-0000-4000-8000-000000000001"),
	isMuted: false,
	mutedUntilMs: null,
	notificationLevel: null,
	isFavorite: false,
	notificationCount: 0,
	...overrides,
})

describe("ChannelSidebar", () => {
	it.effect("subscribes to its queries, keyed by org and user", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSidebar, props)
			for (const key of ["clock", "sections", "memberships", "role", "unread", "customers", "discover"])
				assert.isTrue(
					s.subscriptions.some((sub) => sub.startsWith(key)),
					`${key} in ${s.subscriptions.join(", ")}`,
				)
			assert.isFalse(s.subscriptions.some((sub) => sub.startsWith("chrome")))
		}),
	)

	it.effect("live rows land in the Model and mark it loaded", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSidebar, props)
			assert.isFalse(s.model.loaded)
			s.send(SidebarMessage.UpdatedMemberships({ entries: [entry(general)], threads: [] }))
			assert.isTrue(s.model.loaded)
			assert.strictEqual(s.model.entries.length, 1)
			s.send(SidebarMessage.UpdatedUnreadCounts({ counts: { [general]: 2 } }))
			assert.strictEqual(s.model.unreadCounts[general], 2)
		}),
	)

	it.effect("a row press selects at once and asks the host to navigate", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSidebar, props)
			s.send(SidebarMessage.PressedRow({ id: design })).expectExact(RequestNavigation)
			assert.strictEqual(s.model.activeChannelId, design)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				to: NavTarget.Channel({ channelId: design }),
			})
			s.resolve(RequestNavigation, SidebarMessage.CompletedRequest())
			// The host's route change is the truth.
			s.send(SidebarMessage.ChangedRoute({ activeChannelId: null, membersActive: true }))
			assert.isNull(s.model.activeChannelId)
			assert.isTrue(s.model.membersActive)
		}),
	)

	it.effect("menu choices go to the host by today's keys", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSidebar, props)
			s.send(SidebarMessage.SelectedRowMenu({ id: general, entry: "mute:60" })).expectExact(
				RequestSidebarAction,
			)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				action: SidebarAction.RowMenu({ channelId: general, key: "mute:60" }),
			})
			s.resolve(RequestSidebarAction, SidebarMessage.CompletedRequest())
			s.send(SidebarMessage.SelectedSectionMenu({ key: team, entry: "delete-section" })).expectExact(
				RequestSidebarAction,
			)
			assert.deepStrictEqual(s.pending[0]?.command.args, {
				action: SidebarAction.SectionMenu({ sectionKey: team, key: "delete-section" }),
			})
			s.resolve(RequestSidebarAction, SidebarMessage.CompletedRequest())
		}),
	)

	it.effect("folds and unfolds a section; dismisses the hint and tells the host", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(ChannelSidebar, props)
			s.send(SidebarMessage.ToggledSection({ key: team, collapsed: true }))
			assert.deepStrictEqual(s.model.collapsed, [team])
			s.send(SidebarMessage.ToggledSection({ key: team, collapsed: false }))
			assert.deepStrictEqual(s.model.collapsed, [])
			s.send(SidebarMessage.DismissedHint()).expectExact(RequestSidebarAction)
			assert.isTrue(s.model.hintDismissed)
			s.resolve(RequestSidebarAction, SidebarMessage.CompletedRequest())
		}),
	)
})

describe("sidebar rules", () => {
	it("channel menu: Unmute while muted, the level in force checked, move targets", () => {
		const groups = channelMenu(entry(general, { notificationLevel: "all" }), {
			isMuted: true,
			inheritedLevel: "mentions",
			sections: [{ id: team, name: "Team" }],
			canDelete: false,
			isCustomerRow: false,
		})
		const first = groups[0]!.entries
		assert.deepStrictEqual(first[0], { id: "mute", label: "Unmute", icon: "bell" })
		const levels = first.find((e) => e.id === "notifications")!.entries!
		assert.deepStrictEqual(
			levels.map((l) => [l.id, l.label, l.checked]),
			[
				["level:default", "Default (Only @mentions)", false],
				["level:all", "All messages", true],
				["level:mentions", "Only @mentions", false],
				["level:nothing", "Nothing", false],
			],
		)
		const move = first.find((e) => e.id === "move")!.entries!
		assert.deepStrictEqual(
			move.map((m) => [m.id, m.checked]),
			[
				["section:default", false],
				[`section:${team}`, true],
			],
		)
		assert.isFalse(groups.flatMap((g) => g.entries).some((e) => e.id === "delete"))
	})

	it("section actions: a member only joins; DMs start a conversation", () => {
		assert.deepStrictEqual(sectionActionsOf("default", "member"), {
			actions: ["join-channel"],
			isEditable: false,
		})
		assert.deepStrictEqual(sectionActionsOf(team, "admin"), {
			actions: ["create-channel", "join-channel"],
			isEditable: true,
		})
		assert.deepStrictEqual(sectionActionsOf("dms", "owner"), {
			actions: ["create-dm"],
			isEditable: false,
		})
		const menu = sectionMenu(["join-channel"], true, null)
		assert.deepStrictEqual(menu.at(-1)!.entries[0]!.id, "delete-section")
	})

	it("threads: recent, unread or open ones are listed under their channel", () => {
		const now = Date.UTC(2026, 10, 26, 12)
		const old = now - 30 * 24 * 3600 * 1000
		const thread = (n: number, createdAtMs: number, notificationCount = 0) => ({
			id: ChannelId.make(`0000000e-0000-4000-8000-00000000000${n}`),
			name: `t${n}`,
			parentChannelId: general,
			createdAtMs,
			notificationCount,
		})
		const threads = [thread(1, now - 1000), thread(2, old), thread(3, old, 1), thread(4, old)]
		const listed = listedThreads(threads, threads[3]!.id, now, new Set())
		assert.deepStrictEqual(
			listed.get(general)?.map((t) => t.name),
			["t1", "t3", "t4"],
		)
	})

	it("unread: a timed mute still ahead hides it", () => {
		const now = 1_000
		const set = unreadSetOf(
			[
				{ channelId: general, mutedUntilMs: null },
				{ channelId: design, mutedUntilMs: 2_000 },
			],
			now,
		)
		assert.deepStrictEqual([...set], [general])
	})
})
