// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A person's profile card, the body of the message list's profile popover: who they are (avatar,
 * name, email or platform), where they are (presence, custom status, local time and how far it is
 * from yours) and what you can do (message, mention, open their profile, copy their email or id).
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Match, Schema } from "effect"
import { getEffectivePresenceStatus, type PresenceStatus } from "../../lib/utils/presence"
import { formatStatusExpiration } from "../../lib/utils/status"
import { formatTimezoneDelta, formatUserLocalTime, getTimezoneAbbreviation } from "../../lib/utils/timezone"

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

/** What the card asks for, besides "Edit profile": each one a host request (`HostRequest`). */
export const ProfileAction = Schema.Literals(["message", "mention", "viewProfile", "copyEmail", "copyId"])
export type ProfileAction = typeof ProfileAction.Type

export interface ProfileCardInputs<M> {
	readonly person: ProfilePerson
	/** Null while the presence query has not answered, or the person has no row (offline). */
	readonly presence: ProfilePresence | null
	/** "Edit profile", on the viewer's own card. */
	readonly onEditProfile: M
	readonly onAction: (action: ProfileAction) => M
}

/** The avatar's dot; the app's `dnd` draws as `busy`, as the DMs tab does. */
const dotOf = (status: PresenceStatus) =>
	Match.value(status).pipe(
		Match.when("online", () => "online" as const),
		Match.when("away", () => "away" as const),
		Match.whenOr("busy", "dnd", () => "busy" as const),
		Match.orElse(() => "offline" as const),
	)

const isPresent = (value: string | null | undefined): value is string =>
	value !== null && value !== undefined && value !== ""

const providerLabel = (provider: "slack" | "discord") =>
	Match.value(provider).pipe(
		Match.when("slack", () => "Slack"),
		Match.when("discord", () => "Discord"),
		Match.exhaustive,
	)

/** Under the name: the email for a person, the platform for a synced person, "App" for a bot. */
const subtitleOf = (person: ProfilePerson): string | null =>
	person.provider !== undefined
		? `${providerLabel(person.provider)} member`
		: person.isBot
			? "App"
			: isPresent(person.email)
				? person.email
				: null

const isProfileAction = Schema.is(ProfileAction)

/** The overflow menu: what the buttons do not already offer. */
const moreEntries = (person: ProfilePerson, canMessage: boolean) => [
	{
		entries: [
			...(person.isOwn ? [] : [{ id: "mention", label: "Mention", icon: "message-pen" as const }]),
			...(canMessage || person.isOwn
				? [{ id: "viewProfile", label: "View profile", icon: "user" as const }]
				: []),
		],
	},
	{
		entries: [
			...(person.provider === undefined && !person.isBot && isPresent(person.email)
				? [{ id: "copyEmail", label: "Copy email", icon: "envelope" as const }]
				: []),
			{ id: "copyId", label: "Copy user ID", icon: "copy" as const },
		],
	},
]

/**
 * The card's actions. Your own: "Edit profile". A Hazel person or an app: "Message" (their DM).
 * A Slack or Discord person has no Hazel DM, so "Mention" leads. The rest is in the menu.
 */
const Actions = <M>(h: Hazel.H<M>, { person, onEditProfile, onAction }: ProfileCardInputs<M>) => {
	const canMessage = !person.isOwn && person.provider === undefined
	const primary = person.isOwn
		? h.button.key("edit").label("Edit profile").icon("edit").size("small").on("press", onEditProfile)
		: canMessage
			? h.button
					.key("message")
					.label("Message")
					.icon("chat")
					.size("small")
					.on("press", onAction("message"))
			: h.button
					.key("mention")
					.label("Mention")
					.icon("message-pen")
					.variant("secondary")
					.size("small")
					.on("press", onAction("mention"))
	const more = h.menu
		.key("more")
		.label("More options")
		.entries(moreEntries(person, canMessage))
		.trigger(h.button.label("More options").icon("dots").iconOnly().variant("ghost").size("small"))
		// Every entry's id is a `ProfileAction`; an unknown one cannot be chosen.
		.on("select", ({ id }) => onAction(isProfileAction(id) ? id : "viewProfile"))
	return [primary, h.spacer, more]
}

export const ProfileCard = <M>(h: Hazel.H<M>, inputs: ProfileCardInputs<M>) => {
	const { person, presence } = inputs
	// Neither an app nor a Slack or Discord person has Hazel presence, a status or a local time.
	const isExternal = person.isBot || person.provider !== undefined
	const status = getEffectivePresenceStatus(presence)
	const localTime = !isExternal && isPresent(person.timezone) ? formatUserLocalTime(person.timezone) : ""
	const delta = localTime === "" ? "" : formatTimezoneDelta(person.timezone)
	const expiration =
		presence?.statusExpiresAtMs == null
			? null
			: formatStatusExpiration(new Date(presence.statusExpiresAtMs))
	const hasStatus = !isExternal && (isPresent(presence?.statusEmoji) || isPresent(presence?.customMessage))
	const subtitle = subtitleOf(person)
	return h.stack.density("regular").children(
		// Who: the avatar beside the name, read left to right like a message row.
		h.stack
			.axis("horizontal")
			.align("center")
			.density("cozy")
			.children(
				h.avatar
					.name(person.name)
					.initials(person.initials)
					.src(person.avatar)
					.size("large")
					.presence(isExternal ? "none" : dotOf(status))
					.mark(person.provider ?? "none"),
				h.stack.density("tight").children(
					h.stack
						.axis("horizontal")
						.align("center")
						.density("compact")
						.children(
							h.text.role("title").strong().truncate().children(person.name),
							person.isBot && person.provider === undefined
								? h.badge.label("APP").tone("accent").size("small")
								: null,
						),
					subtitle === null
						? null
						: h.text.role("label").tone("muted").truncate().children(subtitle),
				),
			),
		// Their custom status, as they wrote it.
		hasStatus
			? h.frame.surface("muted").children(
					h.stack
						.axis("horizontal")
						.align("center")
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
		// Their clock (the avatar's dot is their presence), so you know whether they will answer now.
		localTime === ""
			? null
			: h.stack
					.axis("horizontal")
					.align("center")
					.density("compact")
					.children(
						h.icon.name("clock"),
						h.text
							.role("label")
							.tone("muted")
							// How far their clock is from yours, else (same clock) its zone.
							.children(
								[localTime, delta === "" ? getTimezoneAbbreviation(person.timezone) : delta]
									.filter(isPresent)
									.join(" · "),
							),
					),
		h.divider,
		h.stack
			.axis("horizontal")
			.align("center")
			.density("compact")
			.children(...Actions(h, inputs)),
	)
}
