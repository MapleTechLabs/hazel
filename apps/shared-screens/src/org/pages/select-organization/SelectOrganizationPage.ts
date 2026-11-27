// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/select-organization` (`web-foldkit/src/page/select-organization`, now deleted): the user's
 * workspaces to pick from, over the org switcher's own query and its `SwitchOrganization` (PH1).
 * A single workspace is opened at once; none offers to create one.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { OrganizationId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { initialsOf } from "../../../activity/format"
import { Navigate } from "../../../app/requests"
import { Session } from "../../../app/session"
import { SwitchOrganization } from "../../../shell/Chrome"
import { organizationsStream, UserOrganization } from "../../../shell/queries"
import { CreateWorkspace } from "../../components/CreateWorkspace"

export const SelectOrganizationMessage = UiSchema.TaggedEnum({
	UpdatedOrganizations: { organizations: Schema.Array(UserOrganization) },
	PressedOrganization: { id: Schema.String },
	PressedCreateNew: {},
})
export type SelectOrganizationMessage = typeof SelectOrganizationMessage.Type

export const SelectOrganizationProps = Schema.Struct({
	session: Session,
	/** Where a workspace opens is the host's: a phone's chat list, a wide screen's home. */
	isMobile: Schema.Boolean,
	/** Onboarding's setup step for a new workspace (not `/onboarding`, which sends an onboarded user back). */
	createHref: Schema.String,
	/** The host the create form shows the workspace URL under. */
	shareHost: Schema.String,
})
export type SelectOrganizationProps = typeof SelectOrganizationProps.Type

export const SelectOrganizationModel = Schema.Struct({
	/** Null until the query is ready. */
	organizations: Schema.NullOr(Schema.Array(UserOrganization)),
	/** A single workspace sent the user on; later emissions change nothing. */
	hasRedirected: Schema.Boolean,
})
export type SelectOrganizationModel = typeof SelectOrganizationModel.Type

const switchTo = (organization: UserOrganization) =>
	SwitchOrganization.make({ organizationId: OrganizationId.make(organization.id), slug: organization.slug })

const capitalize = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

const SelectOrganizationDef = Hazel.component({
	name: "SelectOrganizationPage",
	props: SelectOrganizationProps,
	model: SelectOrganizationModel,
	message: SelectOrganizationMessage,
})

type H = Parameters<Parameters<typeof SelectOrganizationDef.make>[0]["view"]>[0]

const loading = (h: H) =>
	h.screen
		.key("select-organization")
		.surface("centered")
		.children(h.progress.style("spinner").label("Loading"))

/** A workspace's card: its logo, name and handle, the user's role, and a way in. */
const organizationCard = (h: H, organization: UserOrganization) =>
	// HAZEL-GAP(p4-org-card): today's card is a 48pt logo, a 14pt name over the muted `@slug` and a
	// primary pill with a chevron, with a primary ring on hover; a `flush` frame around a `large` row.
	h.frame
		.key(organization.id)
		.surface("flush")
		.children(
			h.item
				.title(organization.name)
				.subtitle(organization.slug === null ? undefined : `@${organization.slug}`)
				.leadingSize("large")
				.leading(
					h.avatar
						.name(organization.name)
						.initials(initialsOf(organization.name))
						.src(organization.logoUrl ?? undefined)
						.size("medium"),
				)
				.trailing(
					h.stack
						.axis("horizontal")
						.align("center")
						.density("compact")
						.children(
							h.badge.label(capitalize(organization.role)).tone("accent").pill(),
							h.icon.name("chevron-right"),
						),
				)
				.on("press", SelectOrganizationMessage.PressedOrganization({ id: organization.id })),
		)

const picker = (h: H, organizations: ReadonlyArray<UserOrganization>) =>
	h.screen
		.key("select-organization")
		.surface("centered")
		.title("Choose a workspace")
		.subtitle("Pick the workspace you want to open.")
		.children(
			h.stack
				.density("cozy")
				.children(...organizations.map((organization) => organizationCard(h, organization))),
			// HAZEL-GAP(p4-inline-text): today's line is one sentence with the button inside it.
			h.stack
				.axis("horizontal")
				.align("center")
				.density("none")
				.children(
					h.spacer,
					h.text.role("caption").tone("muted").children("Don't see your workspace?"),
					h.button
						.label("Create a workspace")
						.variant("ghost")
						.size("xsmall")
						.on("press", SelectOrganizationMessage.PressedCreateNew()),
					h.spacer,
				),
		)

/** No workspaces: create one here (a redirect to `/onboarding` would loop). */
const create = (h: H) =>
	h.screen
		.key("select-organization")
		.surface("centered")
		.title("Create your workspace")
		.subtitle("Create a workspace for your team, or ask a teammate to invite you.")
		.children(CreateWorkspace(h, { key: "create", props: { shareHost: h.props.shareHost } }))

export const SelectOrganizationPage = SelectOrganizationDef.make({
	init: () => ({ organizations: null, hasRedirected: false }),
	update: {
		UpdatedOrganizations: ($, { organizations }) => {
			if ($.model.hasRedirected) return $.model
			const [single] = organizations
			// `<Navigate>` with a single workspace: there is nothing to pick.
			return organizations.length === 1 && single !== undefined
				? $.set({ organizations, hasRedirected: true }).run(switchTo(single))
				: $.evolve({ organizations: () => organizations })
		},
		PressedOrganization: ($, { id }) => {
			const organization = $.model.organizations?.find((entry) => entry.id === id)
			return organization === undefined ? $.model : $.run(switchTo(organization))
		},
		PressedCreateNew: ($) => $.run(Navigate.make({ href: $.props.createHref, replace: false })),
	},
	subscriptions: ({ props }) => {
		const userId = props.session.user?.id ?? null
		return userId === null
			? []
			: [
					Subscription.make("organizations", [userId], ([id]) =>
						organizationsStream(id, (organizations) =>
							SelectOrganizationMessage.UpdatedOrganizations({ organizations }),
						),
					),
				]
	},
	view: (h, model) => {
		const { organizations } = model
		if (h.props.session.user === null || organizations === null || model.hasRedirected) return loading(h)
		return organizations.length === 0 ? create(h) : picker(h, organizations)
	},
})
