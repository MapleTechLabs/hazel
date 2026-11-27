// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/my-settings/notifications` (today's `page/my-settings/notifications`): sounds (the
 * app's, changed through `SetSoundSettings`), do not disturb and quiet hours (the user's row),
 * "This organization" and the channels or sections with a setting of their own. A settings write
 * runs one at a time; a change made meanwhile is queued as the latest snapshot.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { User } from "@hazel/domain/models"
import { OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema, Stream } from "effect"
import { SetSoundSettings, ShowToast, SoundSettings } from "../../../app/requests"
import { Session } from "../../../app/session"
import { muteStatusOf } from "../../../lib/notification-settings"
import { copyOf, errorToast, reasonOf } from "../../../modals/feedback"
import { modalServices } from "../../../modals/services"
import { FieldLabel, SettingsPage, SettingsRow } from "../../components"
import { NotificationPreviews } from "../../platform"
import {
	applied,
	Change,
	channelOverridesOf,
	channelResetOf,
	DEFAULTS,
	isInEffect,
	LEVELS,
	muteOfKey,
	muteSegmentsOf,
	OrganizationSettings,
	organizationSettingsOf,
	Override,
	payloadOf,
	sameSettings,
	sectionOverridesOf,
	summaryOf,
	UserSettings,
	userSettingsOf,
} from "./data"

export const NotificationStatus = Schema.Literals(["idle", "sent", "unavailable"])
export type NotificationStatus = typeof NotificationStatus.Type

/** `Writing`: one write runs; `WritingWithQueued`: and a newer snapshot waits for it. */
export const SettingsWrite = Schema.Literals(["Idle", "Writing", "WritingWithQueued"])
export type SettingsWrite = typeof SettingsWrite.Type

export const UpdateUserFailure = Schema.Literals([
	"UserNotFound",
	"Offline",
	"Timeout",
	"SignedOut",
	"RateLimited",
	"Unavailable",
	"Unexpected",
])
export type UpdateUserFailure = typeof UpdateUserFailure.Type

export const NotificationsMessage = UiSchema.TaggedEnum({
	ToggledSounds: { checked: Schema.Boolean },
	SelectedSound: { selected: Schema.Array(Schema.String) },
	ChangedVolume: { value: Schema.Finite },
	PressedTestSound: {},
	CompletedTestSound: {},
	PressedTestNotification: {},
	SucceededSendTestNotification: {},
	FailedSendTestNotification: {},
	ExpiredNotificationStatus: { version: Schema.Finite },
	UpdatedUserSettings: { settings: Schema.NullOr(UserSettings) },
	ToggledDoNotDisturb: { checked: Schema.Boolean },
	ToggledShowQuietHours: { checked: Schema.Boolean },
	ChangedQuietHours: { field: Schema.Literals(["start", "end"]), value: Schema.NullOr(Schema.String) },
	SucceededUpdateUserSettings: {},
	FailedUpdateUserSettings: { reason: UpdateUserFailure },
	UpdatedOrganizationSettings: { settings: OrganizationSettings },
	ChangedOrganizationSettings: { change: Change },
	SucceededSaveOrganizationSettings: {},
	FailedSaveOrganizationSettings: {},
	UpdatedChannelOverrides: { overrides: Schema.Array(Override) },
	UpdatedSectionOverrides: { overrides: Schema.Array(Override) },
	PressedResetOverride: { override: Override },
	CompletedResetOverride: { isSuccess: Schema.Boolean },
})
export type NotificationsMessage = typeof NotificationsMessage.Type
const M = NotificationsMessage

/** The chosen sound once; a failure has nothing to show (`testSound` reports its own outcomes). */
export class TestSound extends Command.Service<TestSound>()("hazel/my-settings/TestSound", {
	args: {},
	success: NotificationsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(NotificationPreviews),
			(previews) => () => previews.testSound.pipe(Effect.ignore, Effect.as(M.CompletedTestSound())),
		),
	)
}

/** A test notification; either failure reads as "unavailable" (desktop app only). */
export class TestNotification extends Command.Service<TestNotification>()(
	"hazel/my-settings/TestNotification",
	{ args: {}, success: NotificationsMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(NotificationPreviews),
			(previews) => () =>
				previews.testNotification.pipe(
					Effect.match({
						onSuccess: (isSent) =>
							isSent ? M.SucceededSendTestNotification() : M.FailedSendTestNotification(),
						onFailure: () => M.FailedSendTestNotification(),
					}),
				),
		),
	)
}

/** Today's `setTimeout(() => setNotificationStatus("idle"), 3000)`. */
export class ExpireNotificationStatus extends Command.Service<ExpireNotificationStatus>()(
	"hazel/my-settings/ExpireNotificationStatus",
	{ args: { version: Schema.Finite }, success: NotificationsMessage },
) {
	static readonly layer = this.toLayer(
		Effect.succeed(({ version }) =>
			Effect.sleep("3 seconds").pipe(Effect.as(M.ExpiredNotificationStatus({ version }))),
		),
	)
}

/** `user.update` with the whole settings snapshot. */
export class UpdateUserSettings extends Command.Service<UpdateUserSettings>()(
	"hazel/my-settings/UpdateUserSettings",
	{ args: { userId: UserId, settings: UserSettings }, success: NotificationsMessage },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ userId, settings }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client("user.update", { id: userId, settings })
						}),
					).pipe(
						Effect.match({
							onSuccess: () => M.SucceededUpdateUserSettings(),
							onFailure: (error) =>
								M.FailedUpdateUserSettings({
									reason:
										(error as { readonly _tag?: string })._tag === "UserNotFoundError"
											? "UserNotFound"
											: reasonOf(error),
								}),
						}),
					),
		),
	)
}

/** "This organization": the chosen snapshot as the user's organization-scoped settings. */
export class SaveOrganizationSettings extends Command.Service<SaveOrganizationSettings>()(
	"hazel/my-settings/SaveOrganizationSettings",
	{
		args: { organizationId: OrganizationId, settings: OrganizationSettings },
		success: NotificationsMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ run }) =>
				({ organizationId, settings }) =>
					run(
						Effect.gen(function* () {
							const client = yield* HazelRpc
							yield* client(
								"channelMember.setScopeNotifications",
								payloadOf(organizationId, settings),
							)
						}),
					).pipe(
						Effect.match({
							onSuccess: () => M.SucceededSaveOrganizationSettings(),
							onFailure: () => M.FailedSaveOrganizationSettings(),
						}),
					),
		),
	)
}

/** "Reset": the channel's or section's own level and mute go, so what is above applies again. */
export class ResetOverride extends Command.Service<ResetOverride>()("hazel/my-settings/ResetOverride", {
	args: { organizationId: OrganizationId, override: Override },
	success: NotificationsMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ organizationId, override }) =>
					run(
						override._tag === "Channel"
							? Effect.asVoid(
									data.actions.updateChannelMemberAction(channelResetOf(override.memberId)),
								)
							: Effect.gen(function* () {
									const client = yield* HazelRpc
									yield* client("channelMember.resetScopeNotifications", {
										organizationId,
										scope: "section",
										scopeId: override.sectionId,
									})
								}),
					).pipe(
						Effect.match({
							onSuccess: () => M.CompletedResetOverride({ isSuccess: true }),
							onFailure: () => M.CompletedResetOverride({ isSuccess: false }),
						}),
					),
		),
	)
}

const SOUND_OPTIONS = [
	{ value: "notification01", label: "Sound 1", description: "Classic notification" },
	{ value: "notification03", label: "Sound 2", description: "Modern alert" },
] as const

const DEFAULT_QUIET_START = "22:00"
const DEFAULT_QUIET_END = "08:00"

const volumeText = (volume: number) => `${Math.round(volume * 100)}%`
const isTimeString = Schema.is(User.TimeString)

export const NotificationsModel = Schema.Struct({
	/** The user row's settings, as synced. */
	settings: Schema.NullOr(UserSettings),
	/** The settings chosen while a write is in flight. */
	optimisticSettings: Schema.NullOr(UserSettings),
	settingsWrite: SettingsWrite,
	notificationStatus: NotificationStatus,
	/** Bumped per test result, so an older expiry leaves a newer status alone. */
	notificationStatusVersion: Schema.Finite,
	organizationSettings: OrganizationSettings,
	optimisticOrganizationSettings: Schema.NullOr(OrganizationSettings),
	organizationWrite: SettingsWrite,
	channelOverrides: Schema.Array(Override),
	sectionOverrides: Schema.Array(Override),
})
export type NotificationsModel = typeof NotificationsModel.Type

export const settingsOf = (model: NotificationsModel) => model.optimisticSettings ?? model.settings
export const organizationSettingsOfModel = (model: NotificationsModel) =>
	model.optimisticOrganizationSettings ?? model.organizationSettings

export const NotificationsProps = Schema.Struct({
	session: Session,
	soundSettings: SoundSettings,
	nowMs: Schema.Finite,
})
export type NotificationsProps = typeof NotificationsProps.Type

const NotificationsDef = Hazel.component({
	name: "NotificationsPage",
	props: NotificationsProps,
	model: NotificationsModel,
	message: NotificationsMessage,
	// After Back, no write is running any more.
	restore: (model) => ({
		...model,
		optimisticSettings: null,
		settingsWrite: "Idle" as const,
		optimisticOrganizationSettings: null,
		organizationWrite: "Idle" as const,
		notificationStatus: "idle" as const,
	}),
})

type Dollar = Component.Update<NotificationsModel, NotificationsMessage, never, NotificationsProps>

const withSound = ($: Dollar, patch: Partial<SoundSettings>) =>
	$.run(SetSoundSettings.make({ settings: { ...$.props.soundSettings, ...patch } }))

/** `updateUser({ settings: { ...current, ...patch } })`, shown at once. */
const withUserSettings = ($: Dollar, patch: Partial<UserSettings>) => {
	const userId = $.props.session.user?.id
	if (userId === undefined) return $.model
	const settings = { ...settingsOf($.model), ...patch }
	return $.model.settingsWrite === "Idle"
		? $.evolve({ optimisticSettings: settings, settingsWrite: "Writing" }).run(
				UpdateUserSettings.make({ userId, settings }),
			)
		: $.evolve({ optimisticSettings: settings, settingsWrite: "WritingWithQueued" })
}

/** A write settled: send the queued snapshot, or finish with `settled`. */
const settleWrite = ($: Dollar, settled: UserSettings | null) => {
	const userId = $.props.session.user?.id
	const queued = $.model.optimisticSettings
	if ($.model.settingsWrite === "WritingWithQueued" && queued !== null && userId !== undefined)
		return $.evolve({ settingsWrite: "Writing" }).run(
			UpdateUserSettings.make({ userId, settings: queued }),
		)
	return $.evolve({ settings: settled, optimisticSettings: null, settingsWrite: "Idle" })
}

const withOrganizationSettings = ($: Dollar, settings: OrganizationSettings) => {
	const organizationId = $.props.session.organization?.id
	if (organizationId === undefined) return $.model
	return $.model.organizationWrite === "Idle"
		? $.evolve({ optimisticOrganizationSettings: settings, organizationWrite: "Writing" }).run(
				SaveOrganizationSettings.make({ organizationId, settings }),
			)
		: $.evolve({ optimisticOrganizationSettings: settings, organizationWrite: "WritingWithQueued" })
}

const settleOrganizationWrite = ($: Dollar, settled: OrganizationSettings) => {
	const organizationId = $.props.session.organization?.id
	const queued = $.model.optimisticOrganizationSettings
	if ($.model.organizationWrite === "WritingWithQueued" && queued !== null && organizationId !== undefined)
		return $.evolve({ organizationWrite: "Writing" }).run(
			SaveOrganizationSettings.make({ organizationId, settings: queued }),
		)
	return $.evolve({
		organizationSettings: settled,
		optimisticOrganizationSettings: null,
		organizationWrite: "Idle",
	})
}

const showStatus = ($: Dollar, status: NotificationStatus) => {
	const version = $.model.notificationStatusVersion + 1
	return $.evolve({ notificationStatus: status, notificationStatusVersion: version }).run(
		ExpireNotificationStatus.make({ version }),
	)
}

const toast = (title: string, description: string) =>
	ShowToast.make({ toast: { intent: "error", title, description } })

export const NotificationsPageNoDeps = NotificationsDef.make({
	init: () => ({
		settings: null,
		optimisticSettings: null,
		settingsWrite: "Idle",
		notificationStatus: "idle",
		notificationStatusVersion: 0,
		organizationSettings: DEFAULTS,
		optimisticOrganizationSettings: null,
		organizationWrite: "Idle",
		channelOverrides: [],
		sectionOverrides: [],
	}),
	update: {
		ToggledSounds: ($, { checked }) => withSound($, { enabled: checked }),
		SelectedSound: ($, { selected }) => {
			const soundFile = SOUND_OPTIONS.find((option) => option.value === selected[0])?.value
			return soundFile === undefined ? $.model : withSound($, { soundFile })
		},
		ChangedVolume: ($, { value }) =>
			value === $.props.soundSettings.volume ? $.model : withSound($, { volume: value }),
		PressedTestSound: ($) => $.run(TestSound.make({})),
		CompletedTestSound: ($) => $.model,
		PressedTestNotification: ($) => $.run(TestNotification.make({})),
		SucceededSendTestNotification: ($) => showStatus($, "sent"),
		// Either way the note says native notifications are unavailable here.
		FailedSendTestNotification: ($) => showStatus($, "unavailable"),
		ExpiredNotificationStatus: ($, { version }) =>
			version === $.model.notificationStatusVersion
				? $.evolve({ notificationStatus: "idle" })
				: $.model,
		// The synced row replaces the optimistic settings only once no write is in flight.
		UpdatedUserSettings: ($, { settings }) =>
			$.evolve({
				settings,
				optimisticSettings: (optimistic) => ($.model.settingsWrite === "Idle" ? null : optimistic),
			}),
		ToggledDoNotDisturb: ($, { checked }) => withUserSettings($, { doNotDisturb: checked }),
		ToggledShowQuietHours: ($, { checked }) => withUserSettings($, { showQuietHoursInStatus: checked }),
		ChangedQuietHours: ($, { field, value }) => {
			const time = value?.slice(0, 5)
			if (time === undefined || !isTimeString(time)) return $.model
			const current = settingsOf($.model)
			const before =
				field === "start"
					? (current?.quietHoursStart ?? DEFAULT_QUIET_START)
					: (current?.quietHoursEnd ?? DEFAULT_QUIET_END)
			if (time === before) return $.model
			return withUserSettings(
				$,
				field === "start" ? { quietHoursStart: time } : { quietHoursEnd: time },
			)
		},
		// The server now holds the written snapshot, so it stands until the synced row echoes it.
		SucceededUpdateUserSettings: ($) => settleWrite($, $.model.optimisticSettings ?? $.model.settings),
		FailedUpdateUserSettings: ($, { reason }) => {
			const copy = copyOf(reason, {
				UserNotFound: { title: "Account not found", description: "Please sign in again." },
			})
			return settleWrite($, $.model.settings).run(
				ShowToast.make({
					toast: errorToast({ title: "Failed to update setting", description: copy.description }),
				}),
			)
		},
		UpdatedOrganizationSettings: ($, { settings }) =>
			$.evolve({
				organizationSettings: settings,
				optimisticOrganizationSettings: (optimistic) =>
					$.model.organizationWrite === "Idle" ? null : optimistic,
			}),
		// Picking what is already shown (the running timed mute) writes nothing.
		ChangedOrganizationSettings: ($, { change }) => {
			const current = organizationSettingsOfModel($.model)
			const settings = applied(current, change, $.props.nowMs)
			return sameSettings(settings, current) ? $.model : withOrganizationSettings($, settings)
		},
		SucceededSaveOrganizationSettings: ($) =>
			settleOrganizationWrite(
				$,
				$.model.optimisticOrganizationSettings ?? $.model.organizationSettings,
			),
		// The last synced settings come back; a newer queued choice is still sent.
		FailedSaveOrganizationSettings: ($) =>
			settleOrganizationWrite($, $.model.organizationSettings).run(
				toast("Failed to update setting", "Your organization notification settings did not save."),
			),
		UpdatedChannelOverrides: ($, { overrides }) => $.evolve({ channelOverrides: overrides }),
		UpdatedSectionOverrides: ($, { overrides }) => $.evolve({ sectionOverrides: overrides }),
		PressedResetOverride: ($, { override }) => {
			const organization = $.props.session.organization
			return organization === null
				? $.model
				: $.run(ResetOverride.make({ organizationId: organization.id, override }))
		},
		CompletedResetOverride: ($, { isSuccess }) =>
			isSuccess ? $.model : $.run(toast("Couldn't reset the setting", "Try again in a moment.")),
	},
	subscriptions: ({ props }) => {
		const userId = props.session.user?.id ?? null
		const organizationId = props.session.organization?.id ?? null
		return [
			Subscription.make("userSettings", [userId], ([id]) =>
				id === null
					? Stream.empty
					: userSettingsOf(id, (settings) => M.UpdatedUserSettings({ settings })),
			),
			Subscription.make("organizationSettings", [organizationId], ([id]) =>
				id === null
					? Stream.empty
					: organizationSettingsOf(id, (settings) => M.UpdatedOrganizationSettings({ settings })),
			),
			Subscription.make("channelOverrides", [organizationId, userId], ([orgId, id]) =>
				orgId === null || id === null
					? Stream.empty
					: channelOverridesOf(orgId, id, (overrides) => M.UpdatedChannelOverrides({ overrides })),
			),
			Subscription.make("sectionOverrides", [organizationId], ([id]) =>
				id === null
					? Stream.empty
					: sectionOverridesOf(id, (overrides) => M.UpdatedSectionOverrides({ overrides })),
			),
		]
	},
	view: (h, model) => {
		const { soundSettings: sound, session, nowMs } = h.props
		const settings = settingsOf(model)
		const organization = organizationSettingsOfModel(model)
		const mutes = muteSegmentsOf(organization, nowMs)
		const muteStatus = muteStatusOf(organization, nowMs)
		const overrides = [...model.channelOverrides, ...model.sectionOverrides].filter((override) =>
			isInEffect(override, nowMs),
		)
		const timeField = (field: "start" | "end", label: string, fallback: string) =>
			h.datePicker
				.label(label)
				.granularity("time")
				.value((field === "start" ? settings?.quietHoursStart : settings?.quietHoursEnd) ?? fallback)
				.on("change", ({ value }) => M.ChangedQuietHours({ field, value }))
		return SettingsPage(
			h,
			{
				id: "my-settings-notifications",
				title: "Notifications",
				subtitle: "Manage how and when you receive notifications.",
			},
			SettingsRow(
				h,
				{ title: "Sound settings", description: "Notification sounds" },
				h.stack.density("relaxed").children(
					h.toggle
						.label("Enable notification sounds")
						.checked(sound.enabled)
						.on("change", ({ checked }) => M.ToggledSounds({ checked })),
					h.stack.density("cozy").children(
						h.text.role("label").strong().children("Notification sound"),
						// HAZEL-GAP(p4-choice-card-radio): today's sound cards lead with a radio dot on a
						// `bg-secondary` card; `cards` ends single choices with no indicator.
						h.choiceGroup
							.label("Notification sound")
							.labelHidden()
							.style("cards")
							.columns("2")
							.disabled(!sound.enabled)
							.options(SOUND_OPTIONS.map((option) => ({ ...option })))
							.selected([sound.soundFile])
							.on("change", ({ selected }) => M.SelectedSound({ selected })),
					),
					h.slider
						.label("Volume")
						.min(0)
						.max(1)
						.step(0.1)
						.value(sound.volume)
						.valueText(volumeText(sound.volume))
						.disabled(!sound.enabled)
						.on("change", ({ value }) => M.ChangedVolume({ value })),
					h.stack
						.axis("horizontal")
						.align("center")
						.density("cozy")
						.children(
							h.button
								.label("Test sound")
								.disabled(!sound.enabled)
								.on("press", M.PressedTestSound()),
							h.button
								.label("Test notification")
								.variant("outline")
								.on("press", M.PressedTestNotification()),
							model.notificationStatus === "sent"
								? h.text.role("label").tone("success").children("Notification sent!")
								: model.notificationStatus === "unavailable"
									? h.text
											.role("label")
											.tone("muted")
											.children("Native notifications unavailable (desktop app only)")
									: null,
						),
				),
			),
			h.divider,
			SettingsRow(
				h,
				{ title: "Do not disturb", description: "Quiet hours and DND mode" },
				h.stack.density("relaxed").children(
					h.toggle
						.label("Enable do not disturb")
						.checked(settings?.doNotDisturb ?? false)
						.on("change", ({ checked }) => M.ToggledDoNotDisturb({ checked })),
					h.stack.density("cozy").children(
						FieldLabel(h, "Quiet hours", "No notifications will be sent during these hours"),
						h.stack
							.axis("horizontal")
							.align("center")
							.children(
								timeField("start", "Start time", DEFAULT_QUIET_START),
								timeField("end", "End time", DEFAULT_QUIET_END),
							),
					),
					h.toggle
						.label("Show quiet hours in status")
						.description("Display a moon indicator to others when you're in quiet hours")
						.checked(settings?.showQuietHoursInStatus ?? true)
						.on("change", ({ checked }) => M.ToggledShowQuietHours({ checked })),
				),
			),
			session.organization === null ? null : h.divider,
			session.organization === null
				? null
				: SettingsRow(
						h,
						{ title: session.organization.name, description: "This organization's channels" },
						h.stack.density("relaxed").children(
							h.stack.density("compact").children(
								FieldLabel(
									h,
									"Notify me about",
									"For channels without a setting of their own. Direct messages always notify.",
								),
								h.choiceGroup
									.label("Notify me about")
									.labelHidden()
									.style("segmented")
									.options(
										LEVELS.map((level) => ({ value: level.key, label: level.label })),
									)
									.selected([organization.level ?? "default"])
									.on("change", ({ selected }) =>
										M.ChangedOrganizationSettings({
											change: {
												level:
													selected[0] === undefined || selected[0] === "default"
														? null
														: (LEVELS.find((level) => level.key === selected[0])
																?.key as "all" | "mentions" | "nothing"),
											},
										}),
									),
							),
							h.stack.density("compact").children(
								FieldLabel(
									h,
									"Mute this organization",
									muteStatus ??
										"Muted channels still notify you when someone mentions you or replies.",
								),
								h.choiceGroup
									.label("Mute this organization")
									.labelHidden()
									.style("segmented")
									.options(
										mutes.segments.map((mute) => ({
											value: mute.key,
											label: mute.label,
										})),
									)
									.selected([mutes.selected])
									.on("change", ({ selected }) =>
										M.ChangedOrganizationSettings({
											change: { mute: muteOfKey(selected[0] ?? "off") },
										}),
									),
							),
							h.toggle
								.label("Suppress @channel and @here")
								.description("They notify you like any other message in the channel.")
								.checked(organization.suppressEveryone)
								.on("change", ({ checked }) =>
									M.ChangedOrganizationSettings({ change: { suppressEveryone: checked } }),
								),
						),
					),
			session.organization === null ? null : h.divider,
			session.organization === null
				? null
				: SettingsRow(
						h,
						{
							title: "Notification overrides",
							description: "Channels and sections with a setting of their own",
						},
						overrides.length === 0
							? h.text
									.role("label")
									.tone("muted")
									.children(
										"No channel or section has a setting of its own. Use a channel's or section's menu to set one.",
									)
							: h.frame.surface("flush").children(
									...overrides.map((override) =>
										h.item
											.key(
												override._tag === "Channel"
													? override.memberId
													: override.sectionId,
											)
											.title(
												override._tag === "Channel"
													? `#${override.name}`
													: override.name,
											)
											.subtitle(
												`${override._tag === "Section" ? "Section · " : ""}${summaryOf(override, nowMs)}`,
											)
											.trailing(
												h.button
													.label("Reset")
													.variant("outline")
													.size("xsmall")
													.on("press", M.PressedResetOverride({ override })),
											),
									),
								),
					),
		)
	},
})

export const notificationsLayer = Layer.mergeAll(
	TestSound.layer,
	TestNotification.layer,
	ExpireNotificationStatus.layer,
	UpdateUserSettings.layer,
	SaveOrganizationSettings.layer,
	ResetOverride.layer,
)

export const NotificationsPage = NotificationsPageNoDeps.pipe(Component.provide(notificationsLayer))
