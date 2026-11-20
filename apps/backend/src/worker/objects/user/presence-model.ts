/**
 * Discord's presence rules, pure: what other people see, from the status the user picked and the
 * sessions (one per connected client) they have open. `./presence.ts` stores the inputs and
 * projects the result; every rule is tested in `./presence-model.test.ts`.
 *
 * - No live session: offline.
 * - Invisible: offline to everyone else (their own clients still know the pick).
 * - Do Not Disturb: dnd. Idle: idle (stored as `away`).
 * - Online: online while any session is in use, idle once every session is idle.
 *
 * Each kind of device (desktop, web, mobile) gets the same rule over its own sessions, so others
 * can see that someone is only on their phone.
 */
import type { schema } from "@hazel/db"
import type { ChannelId } from "@hazel/schema"
import { SESSION_TIMEOUT_MS } from "./presence-timing"

export type PreferredStatus = schema.UserPresenceSettings["status"]
export type ClientType = NonNullable<schema.PresenceSession["clientType"]>
export type PublicStatus = "online" | "away" | "dnd" | "offline"
export type ClientStatus = "online" | "away" | "dnd"

export interface Preference {
	readonly status: PreferredStatus
	readonly statusExpiresAt: Date | null
}

export type Session = Omit<schema.PresenceSession, "connectedAt">

/** What other people see: the computed fields of the `user_presence_status` row. */
export interface PublicPresence {
	readonly status: PublicStatus
	readonly desktopStatus: ClientStatus | null
	readonly webStatus: ClientStatus | null
	readonly mobileStatus: ClientStatus | null
	readonly afk: boolean
	readonly activeChannelId: ChannelId | null
}

export const OFFLINE: PublicPresence = {
	status: "offline",
	desktopStatus: null,
	webStatus: null,
	mobileStatus: null,
	afk: true,
	activeChannelId: null,
}

/** A timed pick past its expiry is back to online; no pick at all is online. */
export const effectiveStatus = (preference: Preference | undefined, nowMs: number): PreferredStatus => {
	if (preference === undefined) return "online"
	const isExpired = preference.statusExpiresAt !== null && preference.statusExpiresAt.getTime() <= nowMs
	return isExpired ? "online" : preference.status
}

/** A session an older client opened says nothing of its kind: it counts as web. */
export const clientTypeOf = (session: Pick<Session, "clientType">): ClientType => session.clientType ?? "web"

export const sessionDeadline = (session: Pick<Session, "lastBeatAt">) =>
	session.lastBeatAt.getTime() + SESSION_TIMEOUT_MS

/** Is `session` still live at `nowMs`: pinged within the timeout, and (when known) its socket open. */
export const isLive = (
	session: Pick<Session, "id" | "lastBeatAt">,
	nowMs: number,
	openSessionIds?: ReadonlySet<string>,
) => sessionDeadline(session) > nowMs && (openSessionIds === undefined || openSessionIds.has(session.id))

const statusOver = (
	preferred: Exclude<PreferredStatus, "invisible">,
	sessions: ReadonlyArray<Session>,
): ClientStatus => {
	switch (preferred) {
		case "dnd":
			return "dnd"
		case "idle":
			return "away"
		case "online":
			return sessions.some((session) => !session.idle) ? "online" : "away"
	}
}

/** The channel the user is reading: a focused session's, preferring one in use, then the latest. */
const activeChannelOf = (sessions: ReadonlyArray<Session>): ChannelId | null => {
	const focused = sessions
		.filter((session) => session.focusedChannelId !== null)
		.sort(
			(a: Session, b: Session) =>
				Number(a.idle) - Number(b.idle) || b.lastBeatAt.getTime() - a.lastBeatAt.getTime(),
		)
	return focused[0]?.focusedChannelId ?? null
}

/** What others see, given the pick and the sessions that are live (`isLive`). */
export const aggregate = (
	preference: Preference | undefined,
	liveSessions: ReadonlyArray<Session>,
	nowMs: number,
): PublicPresence => {
	const preferred = effectiveStatus(preference, nowMs)
	if (liveSessions.length === 0 || preferred === "invisible") return OFFLINE
	const of = (type: ClientType) => {
		const sessions = liveSessions.filter((session) => clientTypeOf(session) === type)
		return sessions.length === 0 ? null : statusOver(preferred, sessions)
	}
	return {
		status: statusOver(preferred, liveSessions),
		desktopStatus: of("desktop"),
		webStatus: of("web"),
		mobileStatus: of("mobile"),
		afk: !liveSessions.some((session) => clientTypeOf(session) !== "mobile" && !session.afk),
		activeChannelId: activeChannelOf(liveSessions),
	}
}
