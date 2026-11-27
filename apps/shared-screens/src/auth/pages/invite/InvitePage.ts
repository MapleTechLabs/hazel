// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/invite/$token`, the link in an invitation email (`web-foldkit/src/page/invite`, now deleted):
 * the workspace it joins, then sign in, accept with the invited account, or why it can't be used.
 */
import { Command, Component, Query, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Effect, Layer, Match, Option, Schema } from "effect"
import { LoadPage, SignOut } from "../../../app/requests"
import { authFrame, homeLink } from "../../components/AuthFrame"
import { isSessionLoading, Session } from "../../../app/session"

export const Preview = Schema.Struct({
	organizationName: Schema.String,
	organizationLogoUrl: Schema.NullOr(Schema.String),
	email: Schema.String,
	status: Schema.Literals(["Pending", "Accepted", "Revoked", "Expired"]),
})
export type Preview = typeof Preview.Type

/** Why `invitation.preview` failed; a malformed token reads as `NotFound` without asking. */
export const PreviewFailure = Schema.Literals(["NotFound", "Other"])
export type PreviewFailure = typeof PreviewFailure.Type

/** Why `invitation.accept` failed. */
export const AcceptFailure = Schema.Literals(["EmailMismatch", "NoLongerValid", "WorkspaceGone", "Other"])
export type AcceptFailure = typeof AcceptFailure.Type

/** Accepting stays in flight until the browser loads the workspace. */
export const Acceptance = UiSchema.TaggedEnum({
	Idle: {},
	Accepting: {},
	Failed: { reason: AcceptFailure },
})
export type Acceptance = typeof Acceptance.Type

export const InviteMessage = UiSchema.TaggedEnum({
	PressedRetryPreview: {},
	PressedSignIn: {},
	PressedAccept: {},
	PressedSignOut: {},
	/** Joined: `href` is the workspace, loaded in full so its data starts syncing. */
	SucceededAccept: { href: Schema.String },
	FailedAccept: { reason: AcceptFailure },
})
export type InviteMessage = typeof InviteMessage.Type

export const InviteProps = Schema.Struct({
	token: Schema.String,
	session: Session,
	/** Sign in, then come back to this link (the host's URL for it). */
	signInHref: Schema.String,
})
export type InviteProps = typeof InviteProps.Type

export const InviteModel = Schema.Struct({
	/** Counts "Try again": a failed preview is fetched again under a new key. */
	attempt: Schema.Finite,
	acceptance: Acceptance,
})
export type InviteModel = typeof InviteModel.Type

/** The contract's token length: anything else would fail the payload schema, so it can't be one. */
export const isWellFormedToken = (token: string) => token.length >= 16 && token.length <= 128

export class GetInvitationPreview extends Query.Service<GetInvitationPreview>()("hazel/invite/GetPreview", {
	args: { token: Schema.String, attempt: Schema.Finite },
	success: Preview,
	error: PreviewFailure,
	staleTime: "5 minutes",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ token }) =>
				rpc("invitation.preview", { token }).pipe(
					Effect.map((preview): Preview => ({
						organizationName: preview.organizationName,
						organizationLogoUrl: preview.organizationLogoUrl,
						email: preview.email,
						status: preview.status,
					})),
					Effect.tapError((error) =>
						error._tag === "InvitationNotFoundError"
							? Effect.void
							: Effect.logWarning("invitation preview failed", error),
					),
					Effect.mapError((error): PreviewFailure =>
						error._tag === "InvitationNotFoundError" ? "NotFound" : "Other",
					),
				)
		}),
	)
}

/** Joins the workspace; the page then loads it (`/` when it has no slug yet). */
export class AcceptInvitation extends Command.Service<AcceptInvitation>()("hazel/invite/Accept", {
	args: { token: Schema.String },
	success: InviteMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const failed = (reason: AcceptFailure) => Effect.succeed(InviteMessage.FailedAccept({ reason }))
			return ({ token }) =>
				rpc("invitation.accept", { token }).pipe(
					// The web's org home is `/<slug>`, as every in-app link names it.
					Effect.map((accepted) =>
						InviteMessage.SucceededAccept({ href: accepted.slug ? `/${accepted.slug}` : "/" }),
					),
					Effect.catchTags({
						InvitationEmailMismatchError: () => failed("EmailMismatch"),
						InvitationUnavailableError: () => failed("NoLongerValid"),
						InvitationNotFoundError: () => failed("NoLongerValid"),
						OrganizationNotFoundError: () => failed("WorkspaceGone"),
					}),
					// BOUNDARY: every other failure (offline, signed out, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("invitation accept failed", cause)),
					Effect.catchCause(() => failed("Other")),
				)
		}),
	)
}

const statusMessage = (status: Preview["status"]) =>
	Match.value(status).pipe(
		Match.when("Accepted", () => "This invitation has already been used."),
		Match.when("Revoked", () => "This invitation was withdrawn. Ask for a new one."),
		Match.orElse(() => "This invitation has expired. Ask for a new one."),
	)

const acceptFailureMessage = (reason: AcceptFailure): string =>
	Match.value(reason).pipe(
		Match.when("EmailMismatch", () => "This invitation was sent to a different email address"),
		Match.when("NoLongerValid", () => "This invitation is no longer valid. Ask for a new one."),
		Match.when("WorkspaceGone", () => "This workspace no longer exists"),
		Match.orElse(() => "Something went wrong. Please try again."),
	)

const InviteDef = Hazel.component({
	name: "InvitePage",
	props: InviteProps,
	model: InviteModel,
	message: InviteMessage,
	queries: {
		preview: {
			query: GetInvitationPreview,
			args: ({ props, model }) =>
				isWellFormedToken(props.token) ? { token: props.token, attempt: model.attempt } : undefined,
		},
	},
	// After Back, a join that was in flight is not running any more.
	restore: (model) =>
		model.acceptance._tag === "Accepting" ? { ...model, acceptance: Acceptance.Idle() } : model,
})

type H = Parameters<Parameters<typeof InviteDef.make>[0]["view"]>[0]

/** The auth frame (`components/AuthFrame.ts`): one stack, which `centered` widens to the card. */
const frame = (h: H, title: string, subtitle: string, ...children: ReadonlyArray<unknown>) =>
	authFrame(h, { title, subtitle }, h.stack.density("relaxed").children(...(children as Array<never>)))

const loading = (h: H) =>
	h.screen.surface("centered").children(h.progress.style("spinner").label("Loading invitation..."))

const actions = (h: H, model: InviteModel, preview: Preview) => {
	const { user } = h.props.session
	if (user === null)
		return [
			h.button.label("Sign in to accept").on("press", InviteMessage.PressedSignIn()),
			h.text.role("caption").tone("muted").children(`Use the account for ${preview.email}.`),
		]
	if (user.email.toLowerCase() !== preview.email)
		return [
			h.banner
				.tone("danger")
				.description(
					`This invitation is for ${preview.email}, but you're signed in as ${user.email}.`,
				),
			h.button
				.label("Sign in with another account")
				.variant("outline")
				.on("press", InviteMessage.PressedSignOut()),
		]
	const isAccepting = model.acceptance._tag === "Accepting"
	return [
		h.button
			.label(isAccepting ? "Joining..." : "Accept invitation")
			.loading(isAccepting)
			.disabled(isAccepting)
			.on("press", InviteMessage.PressedAccept()),
	]
}

const invitation = (h: H, model: InviteModel, preview: Preview) =>
	preview.status !== "Pending"
		? frame(h, "Invitation unavailable", statusMessage(preview.status), homeLink(h))
		: frame(
				h,
				`Join ${preview.organizationName}`,
				"You've been invited to this workspace on Hazel.",
				// HAZEL-GAP(p4-avatar-xl): today's logo is `xl` (64px) above the heading; `large` is the biggest, under it.
				h.stack.axis("horizontal").children(
					h.avatar
						.name(preview.organizationName)
						.src(preview.organizationLogoUrl ?? undefined)
						.size("large"),
				),
				...actions(h, model, preview),
				model.acceptance._tag === "Failed"
					? h.banner.tone("danger").description(acceptFailureMessage(model.acceptance.reason))
					: null,
			)

const notFound = (h: H) =>
	frame(
		h,
		"Invitation not found",
		"This link doesn't match an invitation. Check that it was copied in full.",
		homeLink(h),
	)

export const InvitePageNoDeps = InviteDef.make({
	init: () => ({ attempt: 0, acceptance: Acceptance.Idle() }),
	update: {
		PressedRetryPreview: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		PressedSignIn: ($) => $.run(LoadPage.make({ href: $.props.signInHref })),
		PressedAccept: ($) =>
			$.model.acceptance._tag === "Accepting"
				? $.model
				: $.set({ ...$.model, acceptance: Acceptance.Accepting() }).run(
						AcceptInvitation.make({ token: $.props.token }),
					),
		PressedSignOut: ($) => $.run(SignOut.make({})),
		// The page stays on "Joining..." until the workspace loads.
		SucceededAccept: ($, { href }) => $.run(LoadPage.make({ href })),
		FailedAccept: ($, { reason }) => $.evolve({ acceptance: () => Acceptance.Failed({ reason }) }),
	},
	view: (h, model) => {
		if (isSessionLoading(h.props.session)) return loading(h)
		if (!isWellFormedToken(h.props.token)) return notFound(h)
		return Match.value(h.queries.preview).pipe(
			Match.tag("Initial", () => loading(h)),
			Match.tag("Failure", ({ cause }) =>
				Option.contains(Cause.findErrorOption(cause), "NotFound")
					? notFound(h)
					: frame(
							h,
							"Couldn't load the invitation",
							"Check your connection and try again.",
							h.button
								.label("Try again")
								.variant("outline")
								.on("press", InviteMessage.PressedRetryPreview()),
						),
			),
			Match.tag("Success", ({ value }) => invitation(h, model, value)),
			Match.exhaustive,
		)
	},
})

/** The page with its preview query and accept Command, on the host's `HazelRpc`. */
export const InvitePage = InvitePageNoDeps.pipe(
	Component.provide(Layer.mergeAll(GetInvitationPreview.layer, AcceptInvitation.layer)),
)
