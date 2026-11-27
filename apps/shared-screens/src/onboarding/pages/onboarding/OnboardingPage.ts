// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/onboarding` (today's `web-foldkit/src/page/onboarding` shell): the flow beside the brand panel.
 * It waits for the user's first membership (creator or invited flow) and the browser's time zone,
 * starts on the URL's `?step=` when it belongs to the flow, and keeps the URL on the step shown.
 * Steps come from `steps/registry.ts`; one with no entry shows the `legacyStep` slot.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import type { ClientData } from "@hazel/client-data"
import { OrganizationId, UserId } from "@hazel/schema"
import { BrandPanel } from "@hazel/ui/extensions/BrandPanel"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { withData } from "../../../app/live"
import { Navigate } from "../../../app/requests"
import { Session } from "../../../app/session"
import {
	Direction,
	directionOf,
	emptyData,
	Flow,
	Membership,
	nextStep,
	OnboardingData,
	previousStep,
	Step,
	stepFromUrl,
	userTypeOf,
} from "../../domain/OnboardingFlow"
import { DataPatch, type StepInput } from "../../steps/OnboardingStep"
import { onboardingSteps } from "../../steps/registry"

export const OnboardingProps = Schema.Struct({
	session: Session,
	/** The route's `?step=`: where the flow starts, and where a step the host draws moved it. */
	urlStep: Schema.NullOr(Schema.String),
	/** The route's `?orgId=`, kept in every step's URL. */
	orgId: Schema.NullOr(OrganizationId),
})
export type OnboardingProps = typeof OnboardingProps.Type

/**
 * `Starting`: waiting for the browser time zone and the membership query, both needed to pick the
 * flow. `Leaving`: an onboarded user who landed here is on the way to `/`.
 */
export const OnboardingPhase = UiSchema.TaggedEnum({
	Starting: {
		/** `undefined` until the membership query answered (`null`: no membership). */
		membership: Schema.optionalKey(Schema.NullOr(Membership)),
		browserTimezone: Schema.NullOr(Schema.String),
	},
	Leaving: {},
	Running: {
		flow: Flow,
		step: Step,
		direction: Direction,
		data: OnboardingData,
	},
})
export type OnboardingPhase = typeof OnboardingPhase.Type
type Running = Extract<OnboardingPhase, { readonly _tag: "Running" }>

export const OnboardingModel = Schema.Struct({ phase: OnboardingPhase })
export type OnboardingModel = typeof OnboardingModel.Type

export const OnboardingMessage = UiSchema.TaggedEnum({
	CompletedReadBrowserTimezone: { browserTimezone: Schema.String },
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	ChangedUrlStep: { step: Schema.NullOr(Schema.String) },
	FoundOnboardedUser: {},
	ContinuedStep: { patch: DataPatch },
	RequestedBackStep: {},
})
export type OnboardingMessage = typeof OnboardingMessage.Type

/** `Intl`'s time zone, read once as the flow starts. */
export class ReadBrowserTimezone extends Command.Service<ReadBrowserTimezone>()(
	"hazel/onboarding/ReadBrowserTimezone",
	{ args: {}, success: OnboardingMessage },
) {
	static readonly layer = this.toLayer(
		Effect.succeed(() =>
			Effect.sync(() =>
				OnboardingMessage.CompletedReadBrowserTimezone({
					browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				}),
			),
		),
	)
}

/** The web's `onboardingHref`: the step in the URL, with the organization it was opened for. */
export const onboardingHref = (orgId: OrganizationId | null, step: Step) =>
	orgId === null ? `/onboarding?step=${step}` : `/onboarding?orgId=${orgId}&step=${step}`

interface MembershipRow {
	readonly member: { readonly id: Membership["memberId"] }
	readonly org: { readonly id: OrganizationId; readonly name: string; readonly slug?: string | null }
}

/** The oldest membership decides the flow (today's `routes/_app/onboarding/index.tsx` query). */
const membershipStream = (userId: UserId): Stream.Stream<OnboardingMessage, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<MembershipRow, OnboardingMessage>(
			(q) =>
				q
					.from({ member: data.collections.organizationMemberCollection })
					.innerJoin({ org: data.collections.organizationCollection }, ({ member, org }) =>
						eq(member.organizationId, org.id),
					)
					.where(({ member }) => eq(member.userId, userId))
					.orderBy(({ member }) => member.createdAt, "asc")
					.findOne(),
			(rows) => {
				const row = rows[0]
				return OnboardingMessage.UpdatedMembership({
					membership:
						row === undefined
							? null
							: {
									organizationId: row.org.id,
									memberId: row.member.id,
									name: row.org.name,
									slug: row.org.slug ?? null,
								},
				})
			},
			// The org sources start as last load's set: a just-made org's membership is missing until
			// its source answers, not "no membership".
			{ holdEmptyUntil: data.orgSourcesSettled },
		),
	)

const OnboardingDef = Hazel.component({
	name: "OnboardingPage",
	props: OnboardingProps,
	model: OnboardingModel,
	message: OnboardingMessage,
	slots: ["legacyStep"],
})

type H = Parameters<Parameters<typeof OnboardingDef.make>[0]["view"]>[0]

/** Both known: the flow starts on the URL's step when it is one of the flow's, else on welcome. */
const startWhenReady = (
	starting: Extract<OnboardingPhase, { readonly _tag: "Starting" }>,
	urlStep: string | null,
): OnboardingPhase => {
	const { membership, browserTimezone } = starting
	if (membership === undefined || browserTimezone === null) return starting
	const userType = userTypeOf(membership)
	return OnboardingPhase.Running({
		flow: { userType, membership, browserTimezone },
		step: stepFromUrl(urlStep, userType) ?? "welcome",
		direction: "forward",
		data: emptyData,
	})
}

/** Before the flow runs, or while it still can: finishing it must not race a redirect. */
const canRedirect = (phase: OnboardingPhase): boolean =>
	phase._tag === "Starting" ||
	(phase._tag === "Running" && phase.step !== "finalization" && phase.step !== "completed")

/** The step entered, and the URL replaced to name it. */
const enter = (running: Running, step: Step, direction: Direction, data = running.data): Running => ({
	...running,
	step,
	direction,
	data,
})

/**
 * The panel's card. HAZEL-GAP(p4-brand-panel-progress): today's card also has a mono "Step N of M"
 * line under the tagline (white/80, its number sliding in); `BrandPanel` has only the tagline.
 */
const TAGLINE = "Welcome to your new workspace. Let's get you set up in just a few steps."

const panel = (h: H) =>
	h.extension(BrandPanel, { pictures: "/images/onboarding", homeHref: "/", tagline: TAGLINE })

/**
 * The step's column. HAZEL-GAP(p4-onboarding-column): today's column is `max-w-2xl` with `p-3 pt-6`
 * to `md:p-12` padding, and the panel shows from `lg`; `centered` is the auth card's 384px column with
 * the panel from `sm`.
 */
const frame = (h: H, ...children: ReadonlyArray<unknown>) =>
	h.screen
		.surface("centered")
		.aside(panel(h))
		.children(...(children as Array<never>))

const waiting = (h: H) => frame(h, h.progress.style("spinner").label("Loading..."))

const stepView = (h: H, running: Running) => {
	const view = onboardingSteps[running.step]
	const input: StepInput<OnboardingMessage> = {
		flow: running.flow,
		data: running.data,
		session: h.props.session,
		continued: (patch) => OnboardingMessage.ContinuedStep({ patch }),
		back: OnboardingMessage.RequestedBackStep(),
	}
	// HAZEL-GAP(p4-onboarding-step-motion): today's step slides and unblurs in (300ms, by direction).
	return h.stack
		.key(`step-${running.step}`)
		.children(view === undefined ? h.slots.legacyStep : (view(h, input) as never))
}

export const OnboardingPageNoDeps = OnboardingDef.make({
	init: ($) =>
		$.set({ phase: OnboardingPhase.Starting({ browserTimezone: null }) }).run(
			ReadBrowserTimezone.make({}),
		),
	update: {
		CompletedReadBrowserTimezone: ($, { browserTimezone }) =>
			$.model.phase._tag === "Starting"
				? $.evolve({
						phase: () =>
							startWhenReady(
								OnboardingPhase.Starting({ ...$.model.phase, browserTimezone }),
								$.props.urlStep,
							),
					})
				: $.model,
		// A running flow keeps its user type; the membership itself stays current.
		UpdatedMembership: ($, { membership }) => {
			const { phase } = $.model
			if (phase._tag === "Starting")
				return $.evolve({
					phase: () =>
						startWhenReady(OnboardingPhase.Starting({ ...phase, membership }), $.props.urlStep),
				})
			if (phase._tag === "Leaving") return $.model
			return $.evolve({ phase: () => ({ ...phase, flow: { ...phase.flow, membership } }) })
		},
		// A step the host draws moved the flow (its Continue or Back): follow it.
		ChangedUrlStep: ($, { step: value }) => {
			const { phase } = $.model
			if (phase._tag !== "Running") return $.model
			const step = stepFromUrl(value, phase.flow.userType)
			if (step === null || step === phase.step) return $.model
			return $.evolve({
				phase: () => enter(phase, step, directionOf(phase.step, step, phase.flow.userType)),
			})
		},
		FoundOnboardedUser: ($) =>
			canRedirect($.model.phase)
				? $.evolve({ phase: () => OnboardingPhase.Leaving() }).run(
						Navigate.make({ href: "/", replace: false }),
					)
				: $.model,
		ContinuedStep: ($, { patch }) => {
			const { phase } = $.model
			if (phase._tag !== "Running") return $.model
			const step = nextStep(phase.step, phase.flow.userType)
			return $.evolve({
				phase: () => enter(phase, step, "forward", { ...phase.data, ...patch }),
			}).run(Navigate.make({ href: onboardingHref($.props.orgId, step), replace: true }))
		},
		RequestedBackStep: ($) => {
			const { phase } = $.model
			if (phase._tag !== "Running") return $.model
			const step = previousStep(phase.step, phase.flow.userType)
			return step === null
				? $.model
				: $.evolve({ phase: () => enter(phase, step, "backward") }).run(
						Navigate.make({ href: onboardingHref($.props.orgId, step), replace: true }),
					)
		},
	},
	subscriptions: ({ props }) => {
		const user = props.session.user
		return [
			user === null
				? null
				: Subscription.make("membership", [user.id], ([userId]) => membershipStream(userId)),
			Subscription.make("urlStep", [props.urlStep ?? ""], ([step]) =>
				Stream.make(OnboardingMessage.ChangedUrlStep({ step: step === "" ? null : step })),
			),
			user?.isOnboarded === true
				? Subscription.make("onboarded", Stream.make(OnboardingMessage.FoundOnboardedUser()))
				: null,
		]
	},
	// `AppShell` waits for `user.me`; onboarding also waits for its flow to be known.
	view: (h, model) =>
		h.props.session.user === null || model.phase._tag !== "Running"
			? waiting(h)
			: frame(h, stepView(h, model.phase)),
})

/** The page with its Command, on the host's `ClientData`. */
export const OnboardingPage = OnboardingPageNoDeps.pipe(Component.provide(ReadBrowserTimezone.layer))
