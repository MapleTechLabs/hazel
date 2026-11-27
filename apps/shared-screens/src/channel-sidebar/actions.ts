// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The sidebar menus' writes (once `web-foldkit/src/shell/channels-sidebar/actions.ts`): a row's or a
 * section's choice, resolved from the sidebar's Model into one write, run optimistically through the
 * app's data, ending in today's toast.
 */
import { Command, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Clock, Effect, Layer, Match, Option, Schema } from "effect"
import { AppToast } from "../app/requests"
import { choiceOfKey, NotificationChoice } from "../chat/header/notifications"
import { commonCopy, errorToast, reasonOf, successToast } from "../modals/feedback"
import {
	DEFAULT_SECTION_KEY,
	type Entry,
	isDmType,
	type ScopeSetting,
	type Section,
	SectionAction,
	sectionKeyOf,
} from "./model"

/** One write a menu choice makes. */
export const SidebarWrite = UiSchema.TaggedEnum({
	Notify: { memberId: ChannelMemberId, choice: NotificationChoice },
	SetFavorite: { memberId: ChannelMemberId, value: Schema.Boolean },
	Hide: { memberId: ChannelMemberId },
	Leave: { memberId: ChannelMemberId },
	Move: { channelId: ChannelId, sectionId: Schema.NullOr(ChannelSectionId) },
	DeleteSection: { sectionId: ChannelSectionId },
	SectionNotify: {
		organizationId: OrganizationId,
		sectionId: ChannelSectionId,
		choice: NotificationChoice,
	},
})
export type SidebarWrite = typeof SidebarWrite.Type

/** What a choice asks for: a write, a request of the app, or nothing (a submenu's parent). */
export type MenuOutcome =
	| { readonly _tag: "Write"; readonly write: SidebarWrite }
	| { readonly _tag: "Modal"; readonly modal: { readonly _tag: string; readonly [key: string]: unknown } }
	| { readonly _tag: "Navigate"; readonly href: string }
	| { readonly _tag: "None" }

const none: MenuOutcome = { _tag: "None" }
const write = (w: SidebarWrite): MenuOutcome => ({ _tag: "Write", write: w })

const notify = (entry: Entry, key: string): Option.Option<MenuOutcome> =>
	Option.map(choiceOfKey(key, entry.isMuted || entry.mutedUntilMs !== null), (choice) =>
		write(SidebarWrite.Notify({ memberId: entry.memberId, choice })),
	)

/** A row's choice by today's keys (`menu-update.ts`); a DM row has its own few. */
export const rowOutcome = (
	entry: Entry,
	key: string,
	context: { readonly orgSlug: string; readonly sections: ReadonlyArray<Section> },
): MenuOutcome => {
	const favorite = write(SidebarWrite.SetFavorite({ memberId: entry.memberId, value: !entry.isFavorite }))
	if (isDmType(entry.type))
		return key === "favorite"
			? favorite
			: key === "hide"
				? write(SidebarWrite.Hide({ memberId: entry.memberId }))
				: Option.getOrElse(notify(entry, key), () => none)
	if (key === "favorite") return favorite
	if (key === "leave") return write(SidebarWrite.Leave({ memberId: entry.memberId }))
	if (key === "delete")
		return {
			_tag: "Modal",
			modal: { _tag: "DeleteChannel", channelId: entry.id, channelName: entry.name },
		}
	if (key === "settings")
		return { _tag: "Navigate", href: `/${context.orgSlug}/channels/${entry.id}/settings` }
	// "Move to section": the section it is in already is a no-op, as today.
	const target =
		key === DEFAULT_SECTION_KEY
			? Option.some(null)
			: Option.map(
					Option.fromNullishOr(
						context.sections.find((section) => sectionKeyOf(section.id) === key),
					),
					(section) => section.id,
				)
	return Option.match(target, {
		onNone: () => Option.getOrElse(notify(entry, key), () => none),
		onSome: (sectionId) =>
			sectionId === entry.sectionId
				? none
				: write(SidebarWrite.Move({ channelId: entry.id, sectionId })),
	})
}

const sectionModals = {
	"create-channel": { _tag: "NewChannel" },
	"join-channel": { _tag: "JoinChannel" },
	"create-dm": { _tag: "CreateDm" },
} as const satisfies { readonly [A in SectionAction]: { readonly _tag: string } }

const isSectionAction = Schema.is(SectionAction)

/** A section's choice: its action's modal, "Delete section", or its notifications. */
export const sectionOutcome = (
	sectionKey: string,
	key: string,
	context: {
		readonly organizationId: OrganizationId
		readonly sections: ReadonlyArray<Section>
		readonly settings: ReadonlyArray<ScopeSetting>
	},
): MenuOutcome => {
	if (isSectionAction(key)) return { _tag: "Modal", modal: sectionModals[key] }
	const section = context.sections.find((candidate) => candidate.id === sectionKey)
	if (section === undefined) return none
	if (key === "delete-section") return write(SidebarWrite.DeleteSection({ sectionId: section.id }))
	const setting = context.settings.find((candidate) => candidate.sectionId === section.id)
	const wasMuted = setting !== undefined && (setting.isMuted || setting.mutedUntilMs !== null)
	return Option.match(choiceOfKey(key, wasMuted), {
		onNone: () => none,
		onSome: (choice) =>
			write(
				SidebarWrite.SectionNotify({
					organizationId: context.organizationId,
					sectionId: section.id,
					choice,
				}),
			),
	})
}

const choiceTitle = (choice: NotificationChoice, section: boolean) =>
	Match.valueTags(choice, {
		Mute: () => (section ? "Section muted" : "Channel muted"),
		Unmute: () => (section ? "Section unmuted" : "Channel unmuted"),
		SetLevel: () => "Notification settings updated",
		Unfollow: () => "Unfollowed thread",
	})

/** Today's success toast for each write; hiding a DM only removes its row. */
export const successTitle = (w: SidebarWrite): string | null =>
	Match.valueTags(w, {
		Notify: ({ choice }) => choiceTitle(choice, false),
		SetFavorite: ({ value }) => (value ? "Added to favorites" : "Removed from favorites"),
		Hide: () => null,
		Leave: () => "Left channel",
		Move: ({ sectionId }) =>
			sectionId === null ? "Channel moved to default" : "Channel moved to section",
		DeleteSection: () => "Section deleted",
		SectionNotify: ({ choice }) => choiceTitle(choice, true),
	})

const OWN_COPY = {
	ChannelMemberNotFoundError: {
		title: "Membership not found",
		description: "You may no longer be a member of this item.",
	},
	ChannelNotFoundError: { title: "Channel not found", description: "This channel may have been deleted." },
	ChannelSectionNotFoundError: {
		title: "Section not found",
		description: "This section may have been deleted.",
	},
} as const

/** Today's failure toast: the write's own cases, else the common reason's. */
export const failureToast = (w: SidebarWrite, error: unknown): AppToast => {
	const tag =
		typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : undefined
	if (w._tag === "DeleteSection" && tag === "ChannelSectionNotFoundError")
		return errorToast({
			title: "Section not found",
			description: "This section may have already been deleted.",
		})
	// Not a member of the organization any more: nothing a retry fixes.
	if (w._tag === "SectionNotify" && tag === "UnauthorizedError") return errorToast(commonCopy("Unexpected"))
	const own =
		tag !== undefined && Object.hasOwn(OWN_COPY, tag) ? OWN_COPY[tag as keyof typeof OWN_COPY] : undefined
	return errorToast(own ?? commonCopy(reasonOf(error)))
}

/** Runs one write; answers with the toast it ends with (none for a silent success). */
export class WriteSidebar extends Command.Service<WriteSidebar>()("hazel/sidebar/WriteSidebar", {
	args: { write: SidebarWrite },
	success: Schema.NullOr(AppToast),
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { updateChannelMemberAction, moveChannelToSectionAction, deleteChannelSectionAction } =
				data.actions
			const run = (w: SidebarWrite): Effect.Effect<unknown, unknown, HazelRpc> =>
				Match.valueTags(w, {
					Notify: ({ memberId, choice }) =>
						Match.valueTags(choice, {
							Mute: ({ minutes }) =>
								Effect.flatMap(Clock.currentTimeMillis, (nowMs) =>
									updateChannelMemberAction(
										minutes === null
											? { memberId, isMuted: true, mutedUntil: null }
											: {
													memberId,
													isMuted: false,
													mutedUntil: new Date(nowMs + minutes * 60_000),
												},
									),
								),
							Unmute: () =>
								updateChannelMemberAction({ memberId, isMuted: false, mutedUntil: null }),
							SetLevel: ({ level }) =>
								updateChannelMemberAction({ memberId, notificationLevel: level }),
							Unfollow: () => run(SidebarWrite.Leave({ memberId })),
						}),
					SetFavorite: ({ memberId, value }) =>
						updateChannelMemberAction({ memberId, isFavorite: value }),
					Hide: ({ memberId }) => updateChannelMemberAction({ memberId, isHidden: true }),
					Leave: ({ memberId }) =>
						rpc("channelMember.delete", {
							id: memberId,
							organizationId: data.hints.orgOfChannelMember(memberId),
						}),
					Move: ({ channelId, sectionId }) => moveChannelToSectionAction({ channelId, sectionId }),
					DeleteSection: ({ sectionId }) => deleteChannelSectionAction({ sectionId }),
					SectionNotify: ({ organizationId, sectionId, choice }) =>
						Effect.gen(function* () {
							const nowMs = yield* Clock.currentTimeMillis
							const scope = { organizationId, scope: "section" as const, scopeId: sectionId }
							const fields = Match.valueTags(choice, {
								Mute: ({ minutes }) =>
									minutes === null
										? { isMuted: true, mutedUntil: null }
										: { isMuted: false, mutedUntil: new Date(nowMs + minutes * 60_000) },
								Unmute: () => ({ isMuted: false, mutedUntil: null }),
								SetLevel: ({ level }) => ({ level }),
								Unfollow: () => ({}),
							})
							yield* rpc("channelMember.setScopeNotifications", { ...scope, ...fields })
						}),
				})
			return ({ write: w }) =>
				run(w).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.map(() => {
						const title = successTitle(w)
						return title === null ? null : successToast(title)
					}),
					// BOUNDARY: every failure becomes its toast (the optimistic row rolls back).
					Effect.tapError((error) => Effect.logWarning("sidebar write failed", error)),
					Effect.catch((error) => Effect.succeed(failureToast(w, error))),
				)
		}),
	)
}

/** The writes over the app's data and RPC client. */
export const sidebarWritesLayer = (data: ClientData["Service"], rpc: HazelRpc["Service"]) =>
	WriteSidebar.layer.pipe(
		Layer.provide(Layer.mergeAll(Layer.succeed(ClientData, data), Layer.succeed(HazelRpc, rpc))),
	)
