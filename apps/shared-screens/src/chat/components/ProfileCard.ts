// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A person's profile card, the body of the message list's profile popover (today's
 * `web-foldkit/src/chat/profile-popover.ts`): avatar, name, email, status, local time and actions.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"
import { getEffectivePresenceStatus, type PresenceStatus } from "../../lib/utils/presence"
import { formatStatusExpiration, getStatusLabel } from "../../lib/utils/status"
import { formatUserLocalTime, getTimezoneAbbreviation } from "../../lib/utils/timezone"

/** A person's presence row, as the card reads it. */
export const ProfilePresence = Schema.Struct({
	status: Schema.String,
	statusEmoji: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
	statusExpiresAtMs: Schema.NullOr(Schema.Finite),
})
export type ProfilePresence = typeof ProfilePresence.Type

/** Who the card shows. */
export interface ProfilePerson {
	readonly name: string
	readonly initials: string
	readonly avatar: string | undefined
	readonly email: string | null
	readonly timezone: string | null
	readonly isBot: boolean
	/** A Slack or Discord person (a chat sync shadow user): no presence, no Hazel email. */
	readonly provider: "slack" | "discord" | undefined
	readonly isOwn: boolean
}

export interface ProfileCardInputs<M> {
	readonly person: ProfilePerson
	/** Null while the presence query has not answered, or the person has no row (offline). */
	readonly presence: ProfilePresence | null
	/** "Edit profile", on the viewer's own card. */
	readonly onEditProfile: M
}

/** The avatar's dot; the app's `dnd` draws as `busy`, as the DMs tab does. */
const dotOf = (status: PresenceStatus) =>
	Match.value(status).pipe(
		Match.when("online", () => "online" as const),
		Match.when("away", () => "away" as const),
		Match.whenOr("busy", "dnd", () => "busy" as const),
		Match.orElse(() => "offline" as const),
	)

/** Today's status badge intent (`statusIntent`); `secondary` is the neutral tone. */
const toneOf = (status: PresenceStatus) =>
	Match.value(status).pipe(
		Match.when("online", () => "success" as const),
		Match.when("away", () => "warning" as const),
		Match.when("dnd", () => "danger" as const),
		Match.orElse(() => "neutral" as const),
	)

const isPresent = (value: string | null | undefined): value is string =>
	value !== null && value !== undefined && value !== ""

/** The card's actions: "Edit profile" on your own, else Message, Call (people only) and More. */
const Actions = <M>(h: Hazel.H<M>, { person, onEditProfile }: ProfileCardInputs<M>, isExternal: boolean) =>
	person.isOwn
		? [h.button.key("edit").label("Edit profile").size("small").on("press", onEditProfile)]
		: [
				// Today's Message, Call and More buttons have no action yet; they are drawn as today.
				h.button.key("message").label("Message").icon("chat").size("small"),
				isExternal
					? null
					: h.button
							.key("call")
							.label("Call")
							.icon("phone")
							.iconOnly()
							.variant("secondary")
							.size("small"),
				h.button
					.key("more")
					.label("More options")
					.icon("dots-vertical")
					.iconOnly()
					.variant("secondary")
					.size("small"),
			]

export const ProfileCard = <M>(h: Hazel.H<M>, inputs: ProfileCardInputs<M>) => {
	const { person, presence } = inputs
	// Neither an app nor a Slack or Discord person has Hazel presence, a status or a reachable email.
	const isExternal = person.isBot || person.provider !== undefined
	const status = getEffectivePresenceStatus(presence)
	const localTime = isPresent(person.timezone) ? formatUserLocalTime(person.timezone) : ""
	const expiration =
		presence?.statusExpiresAtMs == null
			? null
			: formatStatusExpiration(new Date(presence.statusExpiresAtMs))
	const hasStatus = !isExternal && (isPresent(presence?.statusEmoji) || isPresent(presence?.customMessage))
	return h.stack.density("regular").children(
		// HAZEL-GAP(p4-profile-popover): today's card hangs a 3xl avatar over a tinted banner; `large` is the biggest, stacked.
		h.stack
			.align("center")
			.density("tight")
			.children(
				h.avatar
					.name(person.name)
					.initials(person.initials)
					.src(person.avatar)
					.size("large")
					.presence(isExternal ? "none" : dotOf(status))
					.mark(person.provider ?? "none"),
				h.stack
					.axis("horizontal")
					.align("center")
					.density("compact")
					.children(
						h.text.role("title").strong().children(person.name),
						person.isBot && person.provider === undefined
							? h.badge.label("APP").tone("accent").size("small")
							: null,
					),
				isExternal || !isPresent(person.email)
					? null
					: h.text.role("label").tone("muted").children(person.email),
				!isExternal && status !== "online"
					? h.badge.label(getStatusLabel(status)).tone(toneOf(status)).size("small")
					: null,
			),
		hasStatus
			? h.frame.surface("muted").children(
					h.stack
						.axis("horizontal")
						.density("compact")
						.children(
							isPresent(presence?.statusEmoji)
								? h.text.role("title").children(presence.statusEmoji)
								: null,
							h.stack.density("tight").children(
								isPresent(presence?.customMessage)
									? h.text.role("label").children(presence.customMessage)
									: null,
								presence?.statusExpiresAtMs == null
									? null
									: h.text
											.role("caption")
											.tone("muted")
											.children(`Until ${expiration ?? ""}`),
							),
						),
				)
			: null,
		!isExternal && localTime !== ""
			? h.stack
					.axis("horizontal")
					.align("center")
					.density("compact")
					.children(
						h.icon.name("clock"),
						h.text
							.role("label")
							.tone("muted")
							.children(`${localTime} (${getTimezoneAbbreviation(person.timezone)})`),
					)
			: null,
		h.divider,
		h.stack
			.axis("horizontal")
			.density("compact")
			.children(...Actions(h, inputs, isExternal)),
	)
}
