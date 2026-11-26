// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Phase 1 exit screen: the channel sidebar (`web-foldkit/src/shell/channels-sidebar/view.ts`,
 * `items.ts`, `menus.ts`) in `hazel`, beyond G2's channel list: goto rows, favourites, sections that
 * collapse, thread rows, DMs with avatars, the discover hint, and each row's menu. Not rendered yet.
 */
import { UiSchema } from "@effect/ui"
import { ChannelId, ChannelSectionId } from "@hazel/schema"
import { type Content, Hazel, IconName } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"

export const Row = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	kind: Schema.Literals(["public", "private", "dm", "group", "thread"]),
	icon: Schema.optional(IconName),
	emoji: Schema.optional(Schema.String),
	/** DM avatars: initials of the other members, and how many more there are. */
	people: Schema.Array(Schema.String),
	more: Schema.Finite,
	status: Schema.optional(Schema.String),
	unread: Schema.Finite,
	muted: Schema.Boolean,
	favorite: Schema.Boolean,
})
export type Row = typeof Row.Type

export const Group = Schema.Struct({
	key: Schema.String,
	sectionId: Schema.NullOr(ChannelSectionId),
	title: Schema.String,
	collapsed: Schema.Boolean,
	rows: Schema.Array(Row),
})
export type Group = typeof Group.Type

export const SidebarMessage = UiSchema.TaggedEnum({
	PressedRow: { id: ChannelId },
	PressedBrowse: {},
	PressedMembers: {},
	ToggledGroup: { key: Schema.String, collapsed: Schema.Boolean },
	PressedCreate: { key: Schema.String },
	SelectedRowMenu: { id: ChannelId, entry: Schema.String },
	DismissedHint: {},
})
export type SidebarMessage = typeof SidebarMessage.Type

const rowMenu = (row: Row): Content.MenuGroups =>
	row.kind === "dm" || row.kind === "group"
		? [
				{
					entries: [
						{ id: "mute", label: row.muted ? "Unmute" : "Mute", icon: "volume-mute" },
						{ id: "favorite", label: row.favorite ? "Unfavorite" : "Favorite", icon: "star" },
					],
				},
				{ entries: [{ id: "hide", label: "Hide conversation", icon: "close", destructive: true }] },
			]
		: [
				{
					entries: [
						{ id: "mute", label: row.muted ? "Unmute" : "Mute", icon: "volume-mute" },
						// HAZEL-GAP(menu-submenu): "Notifications" and "Move to section" are submenus.
						{ id: "notifications", label: "Notifications", icon: "bell" },
						{ id: "favorite", label: row.favorite ? "Unfavorite" : "Favorite", icon: "star" },
					],
				},
				{
					entries: [
						{ id: "settings", label: "Settings", icon: "gear" },
						{ id: "delete", label: "Delete", icon: "trash", destructive: true },
					],
				},
				{ entries: [{ id: "leave", label: "Leave", icon: "leave", destructive: true }] },
			]

export const ChannelSidebar = Hazel.component({
	name: "ChannelSidebar",
	props: Schema.Struct({ orgSlug: Schema.String }),
	model: Schema.Struct({
		favorites: Schema.Array(Row),
		groups: Schema.Array(Group),
		discover: Schema.Array(Row),
		showHint: Schema.Boolean,
		activeId: Schema.NullOr(ChannelId),
	}),
	message: SidebarMessage,
}).make({
	init: () => ({ favorites: [], groups: [], discover: [], showHint: false, activeId: null }),
	update: {
		PressedRow: ($, { id }) => $.evolve({ activeId: () => id }),
		PressedBrowse: ($) => $.model,
		PressedMembers: ($) => $.model,
		ToggledGroup: ($, { key, collapsed }) =>
			$.evolve({
				groups: (all) => all.map((group) => (group.key === key ? { ...group, collapsed } : group)),
			}),
		PressedCreate: ($) => $.model,
		SelectedRowMenu: ($) => $.model,
		DismissedHint: ($) => $.evolve({ showHint: () => false }),
	},
	view: (h, model) => {
		const leading = (row: Row) =>
			Match.value(row.kind).pipe(
				Match.when("dm", () => h.avatar.name(row.name).initials(row.people[0])),
				Match.when("group", () =>
					h.avatarStack
						.overflow(row.more)
						.children(
							...row.people
								.slice(0, 2)
								.map((initials) => h.avatar.key(initials).initials(initials)),
						),
				),
				// HAZEL-GAP(thread-elbow): a thread row hangs off its channel with an elbow; `item` has no nesting.
				Match.when("thread", () => h.icon.name("thread")),
				Match.when("private", () => h.icon.name("lock")),
				Match.when("public", () =>
					row.emoji === undefined ? h.icon.name(row.icon ?? "hashtag") : h.text.children(row.emoji),
				),
				Match.exhaustive,
			)

		const row = (item: Row) => {
			const selected = model.activeId === item.id
			return h.contextMenu
				.key(item.id)
				.entries(rowMenu(item))
				.on("select", ({ id }) => SidebarMessage.SelectedRowMenu({ id: item.id, entry: id }))
				.children(
					h.item
						.title(item.name)
						.leading(leading(item))
						.badge(item.unread)
						.emphasized(item.unread > 0)
						.selected(selected)
						// HAZEL-GAP(item-muted): a muted channel's row is dimmed; `disabled` is not the same state.
						.href(selected ? undefined : `/${h.props.orgSlug}/chat/${item.id}`)
						.trailing(
							item.status === undefined ? null : h.text.children(item.status),
							// The row's dots menu (shown on hover on the web; iOS uses the context menu).
							h.menu
								.label(`${item.name} options`)
								.entries(rowMenu(item))
								.on("select", ({ id }) =>
									SidebarMessage.SelectedRowMenu({ id: item.id, entry: id }),
								)
								.trigger(
									h.button
										.icon("dots")
										.iconOnly()
										.variant("ghost")
										.size("xsmall")
										.label("Options"),
								),
						)
						.on("press", SidebarMessage.PressedRow({ id: item.id })),
				)
		}

		const group = (entry: Group) =>
			h.section
				.key(entry.key)
				.title(entry.title)
				.collapsible()
				.collapsed(entry.collapsed)
				.on("toggle", ({ collapsed }) => SidebarMessage.ToggledGroup({ key: entry.key, collapsed }))
				// HAZEL-GAP(section-action-menu): a user section's "+" opens a menu (create, join, delete section).
				.action(
					h.icon.name("plus"),
					SidebarMessage.PressedCreate({ key: entry.key }),
					`New in ${entry.title}`,
				)
				// HAZEL-GAP(drag-reorder): channels and sections reorder by drag.
				.children(...(entry.collapsed ? [] : entry.rows.map(row)))

		return h.stack.density("compact").children(
			h.section.key("goto").children(
				h.item
					.title("Browse channels")
					.leading(h.icon.name("search"))
					// HAZEL-GAP(kbd-hint): the row shows its keyboard shortcut (`⌘K`) at its end.
					.on("press", SidebarMessage.PressedBrowse()),
				h.item
					.title("Members")
					.leading(h.icon.name("users"))
					.on("press", SidebarMessage.PressedMembers()),
			),
			model.favorites.length === 0
				? null
				: h.section
						.key("favorites")
						.title("Favorites")
						.children(...model.favorites.map(row)),
			...model.groups.map(group),
			model.discover.length === 0
				? null
				: h.section
						.key("discover")
						.title("Discover")
						.children(
							// HAZEL-GAP(item-muted): discover rows are dimmed until joined.
							...model.discover.map((item) =>
								h.item
									.key(item.id)
									.title(item.name)
									.leading(h.icon.name("hashtag"))
									.on("press", SidebarMessage.PressedRow({ id: item.id })),
							),
							h.item
								.key("browse-all")
								.title("Browse all channels...")
								.on("press", SidebarMessage.PressedBrowse()),
						),
			model.showHint
				? h.frame
						.surface("muted")
						.children(
							h.stack
								.axis("horizontal")
								.align("start")
								.children(
									h.icon.name("lightbulb"),
									h.text
										.role("caption")
										.children("Create a channel for each project or team."),
									h.button
										.icon("close")
										.iconOnly()
										.variant("ghost")
										.size("xsmall")
										.label("Dismiss")
										.on("press", SidebarMessage.DismissedHint()),
								),
						)
				: null,
		)
	},
})
