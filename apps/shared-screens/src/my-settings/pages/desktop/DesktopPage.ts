// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/my-settings/desktop` (today's `page/my-settings/desktop`): launch at login (the
 * desktop app's autostart plugin) and app updates (the app's update state, checked and installed
 * through the app). A browser that opens the page shows only its header.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Schema } from "effect"
import { CheckForUpdate, InstallUpdate, ShowToast } from "../../../app/requests"
import { SettingsPage, SettingsRow } from "../../components"
import { DesktopApp, DesktopUpdate, type InstallFailure } from "../../platform"

export const DesktopMessage = UiSchema.TaggedEnum({
	CheckedAutostart: { isEnabled: Schema.Boolean },
	ToggledAutostart: { checked: Schema.Boolean },
	SucceededSetAutostart: { isEnabled: Schema.Boolean },
	/** `isEnabled` is the state read again after the failed write, so the switch shows the truth. */
	FailedSetAutostart: { isEnabled: Schema.Boolean },
	ReadAppVersion: { version: Schema.NullOr(Schema.String) },
	PressedCheckForUpdates: {},
	PressedInstallUpdate: {},
})
export type DesktopMessage = typeof DesktopMessage.Type

/** The autostart state; a failure reads as off, as today. */
const readAutostart = Effect.flatMap(Effect.service(DesktopApp), (app) =>
	app.isAutostartEnabled.pipe(Effect.catchTag("DesktopPluginError", () => Effect.succeed(false))),
)

export class CheckAutostart extends Command.Service<CheckAutostart>()("hazel/my-settings/CheckAutostart", {
	args: {},
	success: DesktopMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.context<DesktopApp>(),
			(context) => () =>
				readAutostart.pipe(
					Effect.map((isEnabled) => DesktopMessage.CheckedAutostart({ isEnabled })),
					Effect.provide(context),
				),
		),
	)
}

/** On failure the state is read again instead of keeping the toggle. */
export class SetAutostart extends Command.Service<SetAutostart>()("hazel/my-settings/SetAutostart", {
	args: { isEnabled: Schema.Boolean },
	success: DesktopMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.context<DesktopApp>(),
			(context) =>
				({ isEnabled }) =>
					Effect.flatMap(Effect.service(DesktopApp), (app) => app.setAutostart(isEnabled)).pipe(
						Effect.as(DesktopMessage.SucceededSetAutostart({ isEnabled })),
						Effect.catchTag("DesktopPluginError", () =>
							Effect.map(readAutostart, (actual) =>
								DesktopMessage.FailedSetAutostart({ isEnabled: actual }),
							),
						),
						Effect.provide(context),
					),
		),
	)
}

/** `useAppVersion()`: unknown if the plugin fails. */
export class ReadVersion extends Command.Service<ReadVersion>()("hazel/my-settings/ReadVersion", {
	args: {},
	success: DesktopMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(DesktopApp),
			(app) => () =>
				app.version.pipe(
					Effect.catchTag("DesktopPluginError", () => Effect.succeed(null)),
					Effect.map((version) => DesktopMessage.ReadAppVersion({ version })),
				),
		),
	)
}

const INSTALL_FAILURE_TEXT = {
	NoUpdate: "No update to install",
	DownloadFailed: "Download failed",
	InstallFailed: "Installation failed",
	RestartUnavailable:
		"Update installed, but restart is unavailable. Please quit and reopen Hazel manually.",
	RestartFailed:
		"Update installed, but restart failed and Hazel could not quit automatically. Please quit and reopen Hazel manually.",
} satisfies { readonly [Reason in InstallFailure]: string }

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

export const DesktopProps = Schema.Struct({
	/** The app can open at login (the Tauri app; not the native app, not a browser). */
	hasAutostart: Schema.Boolean,
	/** The app updates itself (the Tauri app, and the native app). */
	hasUpdates: Schema.Boolean,
	update: DesktopUpdate,
})
export type DesktopProps = typeof DesktopProps.Type

const DesktopDef = Hazel.component({
	name: "DesktopSettingsPage",
	props: DesktopProps,
	model: Schema.Struct({
		/** `null` until the autostart state is read (the switch is off meanwhile). */
		autostartEnabled: Schema.NullOr(Schema.Boolean),
		/** A write runs; further toggles wait for it. */
		isUpdating: Schema.Boolean,
		version: Schema.NullOr(Schema.String),
	}),
	message: DesktopMessage,
	restore: (model) => ({ ...model, isUpdating: false }),
})

type H = Parameters<Parameters<typeof DesktopDef.make>[0]["view"]>[0]

const checkRow = (h: H, text: string, label: string) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.children(
			h.text.role("label").tone("muted").children(text),
			h.spacer,
			h.button
				.label(label)
				.variant("outline")
				.size("small")
				.on("press", DesktopMessage.PressedCheckForUpdates()),
		)

const retry = (h: H, text: string) =>
	h.stack
		.density("cozy")
		.align("start")
		.children(
			h.text.role("label").tone("danger").children(text),
			h.button
				.label("Retry")
				.variant("outline")
				.size("small")
				.on("press", DesktopMessage.PressedCheckForUpdates()),
		)

const waiting = (h: H, label: string) =>
	h.stack
		.axis("horizontal")
		.align("center")
		.density("compact")
		.children(
			h.progress.style("spinner").label(label),
			h.text.role("label").tone("muted").children(label),
		)

/** Today's `UpdateStatusDisplay`: the update's state and what can be done next. */
const updateStatus = (h: H, update: DesktopUpdate) =>
	Match.valueTags(update, {
		Idle: () => checkRow(h, "Check for available updates", "Check for updates"),
		Checking: () => waiting(h, "Checking for updates..."),
		Available: ({ version, body }) =>
			h.stack
				.density("cozy")
				.align("start")
				.children(
					h.banner
						.tone("info")
						.icon("download")
						.title("Update available")
						.description(body ?? undefined)
						.children(h.badge.label(`v${version}`).tone("accent")),
					h.button
						.label("Install & Restart")
						.size("small")
						.on("press", DesktopMessage.PressedInstallUpdate()),
				),
		UpToDate: ({ checkedAtMs }) =>
			h.stack
				.axis("horizontal")
				.align("center")
				.children(
					h.iconTile.name("check").tone("success").size("small"),
					h.stack.density("tight").children(
						h.text.role("label").strong().children("Up to date"),
						h.text
							.role("caption")
							.tone("muted")
							.children(`Last checked: ${new Date(checkedAtMs).toLocaleTimeString()}`),
					),
					h.spacer,
					h.button
						.label("Check again")
						.variant("outline")
						.size("small")
						.on("press", DesktopMessage.PressedCheckForUpdates()),
				),
		CheckFailed: () => retry(h, "Update check failed"),
		Downloading: ({ downloadedBytes, totalBytes }) => {
			const percent = totalBytes === null ? 0 : Math.round((downloadedBytes / totalBytes) * 100)
			return h.stack.density("cozy").children(
				h.stack.axis("horizontal").children(
					h.text.role("label").tone("muted").children("Downloading update..."),
					h.spacer,
					h.text
						.role("label")
						.strong()
						.children(
							totalBytes === null
								? `${megabytes(downloadedBytes)} MB`
								: `${megabytes(downloadedBytes)} / ${megabytes(totalBytes)} MB (${percent}%)`,
						),
				),
				h.progress.label("Download progress").value(percent / 100),
			)
		},
		Installing: () => waiting(h, "Installing update..."),
		Restarting: () => waiting(h, "Restarting..."),
		InstallFailed: ({ reason }) => retry(h, INSTALL_FAILURE_TEXT[reason]),
	})

export const DesktopPageNoDeps = DesktopDef.make({
	init: ($) => {
		const model = { autostartEnabled: null, isUpdating: false, version: null }
		const { hasAutostart, hasUpdates } = $.props
		// The version shows wherever the desktop app's settings do.
		if (hasAutostart) return $.set(model).run(CheckAutostart.make({})).run(ReadVersion.make({}))
		return hasUpdates ? $.set(model).run(ReadVersion.make({})) : model
	},
	update: {
		// The first read only fills an unknown state, so it never undoes a later write.
		CheckedAutostart: ($, { isEnabled }) =>
			$.model.autostartEnabled === null ? $.evolve({ autostartEnabled: isEnabled }) : $.model,
		ToggledAutostart: ($, { checked }) =>
			$.model.isUpdating || $.model.autostartEnabled === null
				? $.model
				: $.evolve({ isUpdating: true }).run(SetAutostart.make({ isEnabled: checked })),
		SucceededSetAutostart: ($, { isEnabled }) =>
			$.evolve({ autostartEnabled: isEnabled, isUpdating: false }),
		FailedSetAutostart: ($, { isEnabled }) =>
			$.evolve({ autostartEnabled: isEnabled, isUpdating: false }).run(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Failed to update launch at login",
						description: "Please try again.",
					},
				}),
			),
		ReadAppVersion: ($, { version }) => $.evolve({ version }),
		PressedCheckForUpdates: ($) => $.run(CheckForUpdate.make({})),
		PressedInstallUpdate: ($) => $.run(InstallUpdate.make({})),
	},
	view: (h, model) =>
		SettingsPage(
			h,
			{
				id: "my-settings-desktop",
				title: "Desktop",
				subtitle: "Settings for the desktop application.",
			},
			h.props.hasAutostart
				? SettingsRow(
						h,
						{
							title: "Launch at Startup",
							description: "Automatically start the app when you log in.",
						},
						h.frame.children(
							h.toggle
								.label("Open at login")
								.description(
									"When enabled, the app will automatically launch when you log in to your computer.",
								)
								.checked(model.autostartEnabled ?? false)
								.disabled(model.autostartEnabled === null)
								.on("change", ({ checked }) => DesktopMessage.ToggledAutostart({ checked })),
						),
					)
				: null,
			h.props.hasUpdates ? h.divider : null,
			h.props.hasUpdates
				? SettingsRow(
						h,
						{ title: "App updates", description: "Check for and install app updates." },
						h.frame.children(
							h.stack
								.axis("horizontal")
								.align("center")
								.children(
									h.iconTile.name("cube"),
									h.stack
										.density("tight")
										.align("start")
										.children(
											h.text.role("label").tone("muted").children("Current version"),
											h.badge
												.label(model.version === null ? "..." : `v${model.version}`)
												.style("quiet"),
										),
								),
							h.divider,
							updateStatus(h, h.props.update),
						),
					)
				: null,
		),
})

export const desktopLayer = Layer.mergeAll(CheckAutostart.layer, SetAutostart.layer, ReadVersion.layer)

export const DesktopSettingsPage = DesktopPageNoDeps.pipe(Component.provide(desktopLayer))
