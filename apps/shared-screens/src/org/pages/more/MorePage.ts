// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/more` (`web-foldkit/src/page/more`, now deleted), a phone's More tab as Slack's: who you
 * are at the top, then the workspace's other sections and your own settings, each a row that opens
 * its page. Every row is a link, so the page sends nothing.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import type { IconName } from "@hazel/ui/vocabulary/options"
import { Schema } from "effect"
import { initialsOf } from "../../../activity/format"
import { Session } from "../../../app/session"

/** Each row's page, as the host's routes name it. */
export { moreHrefsOf } from "./hrefs"

export const MoreHrefs = Schema.Struct({
	profile: Schema.String,
	customers: Schema.String,
	members: Schema.String,
	invite: Schema.String,
	workspaceSettings: Schema.String,
	notifications: Schema.String,
	appearance: Schema.String,
	switchWorkspace: Schema.String,
})
export type MoreHrefs = typeof MoreHrefs.Type

export const MoreProps = Schema.Struct({ session: Session, hrefs: MoreHrefs })
export type MoreProps = typeof MoreProps.Type

const MoreMessage = UiSchema.TaggedEnum({})

const MoreDef = Hazel.component({
	name: "MorePage",
	props: MoreProps,
	model: Schema.Struct({}),
	message: MoreMessage,
})

type H = Parameters<Parameters<typeof MoreDef.make>[0]["view"]>[0]

interface Row {
	readonly title: string
	readonly href: string
	readonly icon: IconName
}

const row = (h: H, entry: Row) =>
	h.item
		.key(entry.href)
		.title(entry.title)
		.href(entry.href)
		// HAZEL-GAP(p4-item-list-row): today's phone list row is `min-h-12 px-4 py-2.5`, a 20pt glyph in a
		// 32pt box, a medium 14pt title and a 16pt muted chevron; `row` is the sidebar's.
		.leading(h.icon.name(entry.icon))
		.trailing(h.icon.name("chevron-right"))

const section = (h: H, title: string, rows: ReadonlyArray<Row>) =>
	h.section
		.key(title)
		.style("list")
		.title(title)
		.children(...rows.map((entry) => row(h, entry)))

export const MorePage = MoreDef.make({
	init: () => ({}),
	update: {},
	view: (h) => {
		const { user, organization } = h.props.session
		const { hrefs } = h.props
		if (user === null) return h.screen.key("more").surface("page").title("More")
		const name = `${user.firstName} ${user.lastName}`.trim() || user.email
		return h.screen
			.key("more")
			.surface("page")
			.title("More")
			.children(
				h.section
					.key("profile")
					.style("list")
					.children(
						h.item
							.key("profile")
							.title(name)
							.subtitle(user.email)
							.href(hrefs.profile)
							.leadingSize("large")
							.leading(
								h.avatar
									.name(name)
									.initials(initialsOf(name))
									.src(user.avatarUrl ?? undefined)
									.size("medium"),
							)
							.trailing(h.icon.name("chevron-right")),
					),
				section(h, organization?.name ?? "Workspace", [
					{ title: "Customers", href: hrefs.customers, icon: "office" },
					{ title: "Members", href: hrefs.members, icon: "users" },
					{ title: "Invite people", href: hrefs.invite, icon: "user-plus" },
					{ title: "Workspace settings", href: hrefs.workspaceSettings, icon: "gear" },
				]),
				section(h, "You", [
					{ title: "Notifications", href: hrefs.notifications, icon: "bell" },
					{ title: "Appearance", href: hrefs.appearance, icon: "paintbrush" },
					{ title: "Switch workspace", href: hrefs.switchWorkspace, icon: "refresh" },
				]),
			)
	},
})
