// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A section's sidebar beside the nav rail (`web-foldkit/src/shell/sidebars.ts`, now deleted): the
 * settings one (Account above Workspace, the org switcher on top) and Activity's (its three views
 * and "Mark all as read"), both over the account card. Rows are links; the root owns the routes.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { IconName } from "@hazel/ui/vocabulary/options"
import { Effect, Schema } from "effect"
import { AccountMenu, AccountMenuProps, OrgSwitcher, OrgSwitcherProps } from "./Chrome"

export const NavRow = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	icon: IconName,
	href: Schema.String,
	/** The row of the page shown (an integration's own page keeps "Integrations" current). */
	selected: Schema.Boolean,
})
export type NavRow = typeof NavRow.Type

/** Rows under an optional eyebrow (`Account`, `Workspace`) or a group title (`Apps & integrations`). */
export const NavGroup = Schema.Struct({
	key: Schema.String,
	eyebrow: Schema.NullOr(Schema.String),
	title: Schema.NullOr(Schema.String),
	rows: Schema.Array(NavRow),
})
export type NavGroup = typeof NavGroup.Type

/** "Mark all as read": every unread notification of the member (the host runs the calls). */
export class MarkAllNotificationsRead extends Command.Service<MarkAllNotificationsRead>()(
	"hazel/shell/MarkAllNotificationsRead",
	{ args: {}, success: Component.Noop },
) {
	static readonly layerWith = (mark: () => void) =>
		this.toLayer(
			Effect.succeed(() =>
				Effect.sync(() => {
					mark()
					return Component.noop
				}),
			),
		)
}

export const SectionSidebarProps = Schema.Struct({
	/** `settings` opens on the org switcher; `activity` on its label. */
	kind: Schema.Literals(["settings", "activity"]),
	groups: Schema.Array(NavGroup),
	/** Activity's unread count and whether the calls are in flight; no button at 0. */
	unreadCount: Schema.Finite,
	isMarkingAllRead: Schema.Boolean,
	switcher: OrgSwitcherProps,
	account: AccountMenuProps,
	/** A phone: the sidebar is a sheet its top bar opens; null on a wide screen, where it is docked. */
	sheet: Schema.NullOr(Schema.Struct({ open: Schema.Boolean })),
})
export type SectionSidebarProps = typeof SectionSidebarProps.Type

export const SectionSidebarMessage = UiSchema.TaggedEnum({ PressedMarkAllRead: {}, DismissedSheet: {} })
export type SectionSidebarMessage = typeof SectionSidebarMessage.Type

/** The phone's sheet asks to close (a swipe, Escape, the scrim). */
export const SectionSidebarEvents = UiSchema.TaggedEnum({ RequestedClose: {} })
export type SectionSidebarEvents = typeof SectionSidebarEvents.Type

export const SectionSidebar = Hazel.component({
	name: "SectionSidebar",
	props: SectionSidebarProps,
	model: Schema.Struct({}),
	message: SectionSidebarMessage,
	events: SectionSidebarEvents,
}).make({
	init: () => ({}),
	update: {
		PressedMarkAllRead: ($) => $.run(MarkAllNotificationsRead.make({})),
		DismissedSheet: ($) => $.emit(SectionSidebarEvents.RequestedClose()),
	},
	view: (h) => {
		const { props } = h
		const row = (item: NavRow) =>
			h.item
				.key(item.id)
				.title(item.label)
				.leading(h.icon.name(item.icon))
				.selected(item.selected)
				.href(item.href)
		const group = (navGroup: NavGroup) => {
			const section = h.section.key(navGroup.key)
			return (navGroup.title === null ? section : section.title(navGroup.title)).children(
				...navGroup.rows.map(row),
			)
		}
		// HAZEL-GAP(sidebar-eyebrow): today's `heading` `label` eyebrow over a run of sections; an overline text stands in.
		const eyebrow = (text: string) =>
			h.text.key(`eyebrow:${text}`).role("overline").tone("muted").children(text)
		const docked = props.sheet === null
		const header = docked
			? null
			: props.kind === "settings"
				? OrgSwitcher(h, { key: "switcher", props: props.switcher })
				: h.text.key("activity").role("overline").tone("muted").children("Activity")
		const markAll =
			props.kind === "activity" && props.unreadCount > 0
				? h.section
						.key("mark-all")
						.children(
							h.button
								.label("Mark all as read")
								.variant("outline")
								.size("small")
								.loading(props.isMarkingAllRead)
								.on("press", SectionSidebarMessage.PressedMarkAllRead()),
						)
				: null
		// Docked, the frame draws the header and the account card around these rows (`root/sections.ts`).
		const body = h.stack
			.density("tight")
			.children(
				header,
				docked ? null : h.divider,
				...props.groups.flatMap((navGroup) =>
					navGroup.eyebrow === null
						? [group(navGroup)]
						: [eyebrow(navGroup.eyebrow), group(navGroup)],
				),
				markAll,
				docked ? null : h.spacer,
				docked ? null : AccountMenu(h, { key: "account", props: props.account }),
			)
		return props.sheet === null
			? body
			: h.sheet
					.open(props.sheet.open)
					.on("dismiss", () => SectionSidebarMessage.DismissedSheet())
					.children(body)
	},
})
