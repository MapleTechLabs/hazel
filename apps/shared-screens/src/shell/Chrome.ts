// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The sidebar chrome every section shares: the org switcher at the top and the account card at the
 * bottom (`sidebar/user-menu.tsx`, the `channels-sidebar.tsx` header). Each choice goes to the app
 * as a request: a page, a modal, signing out, or another organization.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Match, Schema } from "effect"
import { Navigate, OpenModal, SignOut } from "../app/requests"
import { accountEntries, ChromeHrefs, choiceOf, initialsOf, switcherEntries } from "./menus"
import { organizationsStream, statusStream, SwitcherOrg, UserStatus } from "./queries"

/** Another organization: the host knows its route (its home, or its setup when it has no slug). */
export class SwitchOrganization extends Command.Service<SwitchOrganization>()(
	"hazel/shell/SwitchOrganization",
	{
		args: { organizationId: OrganizationId, slug: Schema.NullOr(Schema.String) },
		success: Component.Noop,
	},
) {
	static readonly layerWith = (switchTo: (organizationId: OrganizationId, slug: string | null) => void) =>
		this.toLayer(
			Effect.succeed(({ organizationId, slug }) =>
				Effect.sync(() => {
					switchTo(organizationId, slug)
					return Component.noop
				}),
			),
		)
}

const ChromeMessage = UiSchema.TaggedEnum({
	UpdatedOrgs: { orgs: Schema.Array(SwitcherOrg) },
	UpdatedStatus: { status: Schema.NullOr(UserStatus) },
	Selected: { id: Schema.String },
})
type ChromeMessage = typeof ChromeMessage.Type

const ChromeModel = Schema.Struct({ orgs: Schema.Array(SwitcherOrg), status: Schema.NullOr(UserStatus) })
type ChromeModel = typeof ChromeModel.Type

const choose = (
	$: { readonly props: { readonly hrefs: ChromeHrefs; readonly organizationId: string } },
	model: ChromeModel,
	id: string,
) =>
	Match.valueTags(
		choiceOf(id, { hrefs: $.props.hrefs, orgs: model.orgs, organizationId: $.props.organizationId }),
		{
			Link: ({ href }) => [Navigate.make({ href, replace: false })],
			Modal: ({ modal }) => [OpenModal.make({ modal: { _tag: modal } })],
			SignOut: () => [SignOut.make({})],
			Organization: ({ org }) => [
				SwitchOrganization.make({ organizationId: OrganizationId.make(org.id), slug: org.slug }),
			],
			None: () => [],
		},
	)

export const OrgSwitcherProps = Schema.Struct({
	organizationId: Schema.String,
	orgName: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	userId: UserId,
	hrefs: ChromeHrefs,
	/** A phone: only the organizations, as a checked list. */
	compact: Schema.Boolean,
	/** Chat's longer menu (create channel and section, emojis, integrations). */
	isChat: Schema.Boolean,
	canCreateChannel: Schema.Boolean,
})
export type OrgSwitcherProps = typeof OrgSwitcherProps.Type

export const OrgSwitcher = Hazel.component({
	name: "OrgSwitcher",
	props: OrgSwitcherProps,
	model: ChromeModel,
	message: ChromeMessage,
}).make({
	init: () => ({ orgs: [], status: null }),
	update: {
		UpdatedOrgs: ($, { orgs }) => $.evolve({ orgs: () => orgs }),
		UpdatedStatus: ($) => $.model,
		Selected: ($, { id }) => $.run(...choose($, $.model, id)),
	},
	subscriptions: ({ props }) => [
		Subscription.make("orgs", [props.userId], ([userId]) =>
			organizationsStream(userId, (orgs) => ChromeMessage.UpdatedOrgs({ orgs })),
		),
	],
	view: (h, model) => {
		const { orgName } = h.props
		return h.menu
			.key("org-switcher")
			.label("Switch organization")
			.entries(
				switcherEntries({
					organizationId: h.props.organizationId,
					orgs: model.orgs,
					compact: h.props.compact,
					isChat: h.props.isChat,
					canCreateChannel: h.props.canCreateChannel,
				}),
			)
			.on("select", ({ id }) => ChromeMessage.Selected({ id }))
			.trigger(
				h.item
					.title(orgName)
					.style("switcher")
					.leading(
						h.avatar
							.name(orgName)
							.initials(initialsOf(orgName))
							.src(h.props.logoUrl ?? undefined),
					)
					.trailing(h.icon.name("chevron-up-down")),
			)
	},
})

export const AccountMenuProps = Schema.Struct({
	organizationId: Schema.String,
	userId: UserId,
	name: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	hrefs: ChromeHrefs,
})
export type AccountMenuProps = typeof AccountMenuProps.Type

export const AccountMenu = Hazel.component({
	name: "AccountMenu",
	props: AccountMenuProps,
	model: ChromeModel,
	message: ChromeMessage,
}).make({
	init: () => ({ orgs: [], status: null }),
	update: {
		UpdatedOrgs: ($) => $.model,
		UpdatedStatus: ($, { status }) => $.evolve({ status: () => status }),
		Selected: ($, { id }) => $.run(...choose($, $.model, id)),
	},
	subscriptions: ({ props }) => [
		Subscription.make("status", [props.userId], ([userId]) =>
			statusStream(userId, (status) => ChromeMessage.UpdatedStatus({ status })),
		),
	],
	view: (h, model) => {
		const { name, email } = h.props
		const emoji = model.status?.emoji ?? null
		// The menu opens on a header: the name over the email (`p4-menu-header`).
		const entries = accountEntries(emoji)
		return h.menu
			.key("account")
			.label("Profile")
			.entries([{ title: name, subtitle: email, entries: entries[0]?.entries ?? [] }, ...entries.slice(1)])
			.on("select", ({ id }) => ChromeMessage.Selected({ id }))
			.trigger(
				h.item
					.title(emoji === null ? name : `${name} ${emoji}`)
					.subtitle(email)
					.style("account")
					.leading(
						h.avatar
							.name(name)
							.initials(initialsOf(name))
							.src(h.props.avatarUrl ?? undefined),
					)
					.trailing(h.icon.name("chevron-up-down")),
			)
	},
})

export type { ChromeMessage }
