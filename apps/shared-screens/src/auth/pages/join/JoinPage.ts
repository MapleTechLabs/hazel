// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/join/$slug`, a workspace's public invite link (`web-foldkit/src/page/join`, now deleted): the
 * workspace and its size, then sign in, or join and open it.
 */
import { Command, Component, Query, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Match, Option, Schema } from "effect"
import { Navigate, Leave, ShowToast } from "../../../app/requests"
import { isSessionLoading, Session } from "../../../app/session"
import { errorToast, reasonOf } from "../../../modals/feedback"
import { authWaiting, brandPanel, HOME_HREF, textLink } from "../../components/AuthFrame"
import { CommonReason, failureMessage } from "../../domain/AuthFailure"

export const PublicOrganization = Schema.Struct({
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	memberCount: Schema.Finite,
})
export type PublicOrganization = typeof PublicOrganization.Type

/** Why `organization.joinViaPublicInvite` failed, beyond the shared reasons. */
export const JoinFailure = Schema.Union([
	Schema.Literals(["NotFound", "PublicInvitesDisabled", "AlreadyMember"]),
	CommonReason,
])
export type JoinFailure = typeof JoinFailure.Type

export const JoinMessage = UiSchema.TaggedEnum({
	PressedRetryLookup: {},
	PressedSignIn: {},
	PressedJoin: {},
	PressedHome: {},
	SucceededJoin: {},
	FailedJoin: { reason: JoinFailure },
})
export type JoinMessage = typeof JoinMessage.Type

export const JoinProps = Schema.Struct({
	slug: Schema.String,
	session: Session,
	/** Sign in, then come back to this link (the host's URL for it). */
	signInHref: Schema.String,
})
export type JoinProps = typeof JoinProps.Type

export const JoinModel = Schema.Struct({
	/** Counts "Try again": a failed lookup is fetched again under a new key. */
	attempt: Schema.Finite,
	isJoining: Schema.Boolean,
	/** The link stopped working after the lookup (a join said so): shown as not found. */
	isGone: Schema.Boolean,
})
export type JoinModel = typeof JoinModel.Type

/** `organization.getBySlugPublic`; `null` is an unknown slug or a workspace without public invites. */
export class GetPublicOrganization extends Query.Service<GetPublicOrganization>()(
	"hazel/join/GetPublicOrganization",
	{
		args: { slug: Schema.String, attempt: Schema.Finite },
		success: Schema.NullOr(PublicOrganization),
		error: CommonReason,
		staleTime: "5 minutes",
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ slug }) =>
				rpc("organization.getBySlugPublic", { slug }).pipe(
					Effect.map((organization): PublicOrganization | null =>
						organization
							? {
									name: organization.name,
									logoUrl: organization.logoUrl ?? null,
									memberCount: organization.memberCount,
								}
							: null,
					),
					Effect.tapError((error) => Effect.logWarning("public workspace lookup failed", error)),
					Effect.mapError(reasonOf),
				)
		}),
	)
}

export class JoinWorkspace extends Command.Service<JoinWorkspace>()("hazel/join/Join", {
	args: { slug: Schema.String },
	success: JoinMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const failed = (reason: JoinFailure) => Effect.succeed(JoinMessage.FailedJoin({ reason }))
			return ({ slug }) =>
				rpc("organization.joinViaPublicInvite", { slug }).pipe(
					Effect.as(JoinMessage.SucceededJoin()),
					Effect.catchTags({
						OrganizationNotFoundError: () => failed("NotFound"),
						PublicInviteDisabledError: () => failed("PublicInvitesDisabled"),
						AlreadyMemberError: () => failed("AlreadyMember"),
					}),
					// BOUNDARY: the shared reasons (offline, signed out, the server) read as today's copy.
					Effect.catchCause((cause) =>
						Option.match(Cause.findErrorOption(cause), {
							onSome: (error) => failed(reasonOf(error)),
							onNone: () =>
								Effect.logError("join failed unexpectedly", cause).pipe(
									Effect.andThen(failed("Unexpected")),
								),
						}),
					),
				)
		}),
	)
}

const JoinDef = Hazel.component({
	name: "JoinPage",
	props: JoinProps,
	model: JoinModel,
	message: JoinMessage,
	queries: {
		organization: {
			query: GetPublicOrganization,
			args: ({ props, model }) => ({ slug: props.slug, attempt: model.attempt }),
		},
	},
	// After Back, a join that was in flight is not running any more.
	restore: (model) => (model.isJoining ? { ...model, isJoining: false } : model),
})

type H = Parameters<Parameters<typeof JoinDef.make>[0]["view"]>[0]

/** The workspace's home, where a join lands (the web's `/<slug>`). */
const homeOf = (slug: string) => `/${slug}`

const INVITED_TAGLINE =
	"You've been invited to join a workspace. Accept the invitation to start collaborating with your team."

/**
 * Today's join card (`animatedCard`): centred, a mark over a display heading and a muted line, then
 * the card's rows. The screen's header aligns to the start, so the card draws its own heading.
 * HAZEL-GAP(p4-join-card): `screen` `centered` has no centred header; the rows sit 24px under the
 * line where today's are 32px (`p4-stack-gap-8`).
 */
const card = (
	h: H,
	tagline: string | null,
	mark: unknown,
	title: string,
	line: string,
	...rows: Array<unknown>
) =>
	h.screen
		.surface("centered")
		.aside(brandPanel(h, tagline))
		.children(
			h.stack.density("relaxed").children(
				h.stack
					.align("center")
					.density("relaxed")
					.children(
						mark as never,
						h.stack
							.align("center")
							.density("compact")
							.children(
								h.text.role("display").strong().children(title),
								h.text.tone("muted").children(line),
							),
					),
				...(rows as Array<never>),
			),
		)

/**
 * A dead end (`problemCard`): the danger tile over the heading, and one way on.
 * HAZEL-GAP(p4-join-card): today's tile is 80pt with a 40pt glyph; `iconTile` is 40pt at most.
 */
const problem = (h: H, title: string, line: string, action: unknown) =>
	card(
		h,
		null,
		h.iconTile.name("warning").tone("danger"),
		title,
		line,
		h.stack.align("center").children(action as never),
	)

const notFound = (h: H) =>
	problem(
		h,
		"Workspace not found",
		"This invite link is invalid or the workspace doesn't have public invites enabled.",
		// HAZEL-GAP(p4-button-href): today's "Go to Hazel" is a link drawn as a secondary button.
		h.button.label("Go to Hazel").variant("secondary").on("press", JoinMessage.PressedHome()),
	)

const failed = (h: H, reason: CommonReason) => {
	const message = failureMessage(reason, {})
	return problem(
		h,
		"Couldn't load this workspace",
		message.description === undefined ? message.title : `${message.title}. ${message.description}`,
		h.button.label("Try again").variant("secondary").on("press", JoinMessage.PressedRetryLookup()),
	)
}

const actions = (h: H, model: JoinModel) =>
	h.props.session.user === null
		? [h.button.label("Sign in to join").on("press", JoinMessage.PressedSignIn())]
		: [
				h.button
					.label(model.isJoining ? "Joining..." : "Join workspace")
					.loading(model.isJoining)
					.disabled(model.isJoining)
					.on("press", JoinMessage.PressedJoin()),
				// Only someone signed in has a workspace to be in instead.
				// HAZEL-GAP(p4-inline-text): today's is one muted sentence ending on the link.
				h.stack.align("center").children(
					h.stack
						.axis("horizontal")
						.density("tight")
						.children(
							h.text.role("label").tone("muted").children("Wrong workspace?"),
							textLink(h, "Go to Hazel", HOME_HREF),
						),
				),
			]

const invitation = (h: H, model: JoinModel, organization: PublicOrganization) =>
	card(
		h,
		INVITED_TAGLINE,
		// HAZEL-GAP(p4-join-card): today's logo is the kit's `4xl` (96pt) with a large shadow.
		h.avatar
			.name(organization.name)
			.src(organization.logoUrl ?? undefined)
			.size("xlarge"),
		organization.name,
		`${organization.memberCount} ${organization.memberCount === 1 ? "member" : "members"}`,
		h.stack.density("cozy").children(...actions(h, model)),
	)

export const JoinPageNoDeps = JoinDef.make({
	init: () => ({ attempt: 0, isJoining: false, isGone: false }),
	update: {
		PressedRetryLookup: ($) => $.evolve({ attempt: (attempt) => attempt + 1, isGone: () => false }),
		PressedSignIn: ($) => $.run(Leave.make({ href: $.props.signInHref })),
		PressedHome: ($) => $.run(Navigate.make({ href: HOME_HREF, replace: false })),
		PressedJoin: ($) =>
			$.model.isJoining
				? $.model
				: $.set({ ...$.model, isJoining: true }).run(JoinWorkspace.make({ slug: $.props.slug })),
		SucceededJoin: ($) => {
			const organization = $.queries.organization
			const name =
				organization._tag === "Success" && organization.value !== null
					? `You joined ${organization.value.name}`
					: "You joined the workspace"
			return $.set({ ...$.model, isJoining: false }).run(
				Navigate.make({
					href: homeOf($.props.slug),
					replace: false,
					toast: { intent: "success", title: name, description: null },
				}),
			)
		},
		FailedJoin: ($, { reason }) => {
			const settled = { ...$.model, isJoining: false }
			return Match.value(reason).pipe(
				// Nothing to join: they are in already, so take them there instead of a dead button.
				Match.when("AlreadyMember", () =>
					$.set(settled).run(
						Navigate.make({
							href: homeOf($.props.slug),
							replace: false,
							toast: {
								intent: "info",
								title: "You're already a member of this workspace",
								description: null,
							},
						}),
					),
				),
				// The link stopped working since the page loaded: not found, not a button that keeps failing.
				Match.whenOr("NotFound", "PublicInvitesDisabled", () => $.set({ ...settled, isGone: true })),
				Match.orElse((common) =>
					$.set(settled).run(ShowToast.make({ toast: errorToast(failureMessage(common, {})) })),
				),
			)
		},
	},
	view: (h, model) => {
		if (isSessionLoading(h.props.session)) return authWaiting(h, "Loading workspace...", null)
		if (model.isGone) return notFound(h)
		return Match.value(h.queries.organization).pipe(
			Match.tag("Initial", () => authWaiting(h, "Loading workspace...", null)),
			Match.tag("Failure", ({ cause }) =>
				failed(
					h,
					Option.getOrElse(Cause.findErrorOption(cause), (): CommonReason => "Unexpected"),
				),
			),
			Match.tag("Success", ({ value }) => (value === null ? notFound(h) : invitation(h, model, value))),
			Match.exhaustive,
		)
	},
})

/** The page with its lookup query and join Command, on the host's `HazelRpc`. */
export const JoinPage = JoinPageNoDeps.pipe(
	Component.provide(Layer.mergeAll(GetPublicOrganization.layer, JoinWorkspace.layer)),
)
