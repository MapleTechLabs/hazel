import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconCube, IconDownload } from "../../../icons"
import { hasUpdater, isDesktop } from "../../../platform/desktop"
import * as Updates from "../../../platform/updates"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { progressBar, progressBarTrack } from "../../../ui/progress-bar"
import { switchControl } from "../../../ui/switch"
import type { PageViewInputs } from "../../contract"
import { divider, pageHeader, settingsRow } from "../shared"
import { Message } from "./message"
import type { Model } from "./model"

const spinner = (h: HtmlBuilder<Message>, label: string): Html =>
	h.div(
		[h.Class("flex items-center gap-2 text-sm text-muted-fg")],
		[
			h.span([
				h.Class("size-4 animate-spin rounded-full border-2 border-current border-t-transparent"),
			]),
			h.span([], [label]),
		],
	)

const retry = (h: HtmlBuilder<Message>, message: string, label: string): Html =>
	h.div(
		[h.Class("flex flex-col gap-3")],
		[
			h.p([h.Class("text-sm text-danger")], [message]),
			button(h, { intent: "outline", size: "sm", onPress: Message.ClickedCheckForUpdates() }, [label]),
		],
	)

const checkRow = (h: HtmlBuilder<Message>, text: string, label: string): Html =>
	h.div(
		[h.Class("flex items-center justify-between")],
		[
			h.span([h.Class("text-sm text-muted-fg")], [text]),
			button(h, { intent: "outline", size: "sm", onPress: Message.ClickedCheckForUpdates() }, [label]),
		],
	)

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** Legacy `UpdateStatusDisplay`: the update's state and what can be done next. */
const updateStatus = (h: HtmlBuilder<Message>, state: Updates.Model): Html =>
	Updates.Model.match(state, {
		Idle: () => checkRow(h, "Check for available updates", "Check for updates"),
		Checking: () => spinner(h, "Checking for updates..."),
		Available: (state) =>
			h.div(
				[h.Class("flex flex-col gap-3")],
				[
					h.div(
						[h.Class("rounded-lg border border-primary/20 bg-primary/5 p-4")],
						[
							h.div(
								[h.Class("flex items-center gap-3")],
								[
									h.div(
										[
											h.Class(
												"flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10",
											),
										],
										[IconDownload(h, { className: "size-4 text-primary" })],
									),
									h.div(
										[h.Class("flex flex-col gap-0.5")],
										[
											h.div(
												[h.Class("flex items-center gap-2")],
												[
													h.span(
														[h.Class("text-sm font-medium text-fg")],
														["Update available"],
													),
													badge(h, { intent: "primary", size: "sm" }, [
														`v${state.version}`,
													]),
												],
											),
											...(state.body
												? [
														h.p(
															[
																h.Class(
																	"mt-1 whitespace-pre-wrap text-sm text-muted-fg",
																),
															],
															[state.body],
														),
													]
												: []),
										],
									),
								],
							),
						],
					),
					button(h, { intent: "primary", size: "sm", onPress: Message.ClickedInstallUpdate() }, [
						"Install & Restart",
					]),
				],
			),
		UpToDate: (state) =>
			h.div(
				[h.Class("flex items-center justify-between")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							h.div(
								[
									h.Class(
										"flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10",
									),
								],
								[IconCheck(h, { className: "size-4 text-success" })],
							),
							h.div(
								[h.Class("flex flex-col gap-0.5")],
								[
									h.span([h.Class("text-sm font-medium text-fg")], ["Up to date"]),
									h.span(
										[h.Class("text-xs text-muted-fg")],
										[`Last checked: ${new Date(state.checkedAtMs).toLocaleTimeString()}`],
									),
								],
							),
						],
					),
					button(h, { intent: "outline", size: "sm", onPress: Message.ClickedCheckForUpdates() }, [
						"Check again",
					]),
				],
			),
		CheckFailed: () => retry(h, Updates.CHECK_FAILURE_TEXT, "Retry"),
		Downloading: (state) => {
			const percent =
				state.totalBytes === null ? 0 : Math.round((state.downloadedBytes / state.totalBytes) * 100)
			return h.div(
				[h.Class("flex flex-col gap-3")],
				[
					h.div(
						[h.Class("flex items-center justify-between text-sm")],
						[
							h.span([h.Class("text-muted-fg")], ["Downloading update..."]),
							h.span(
								[h.Class("font-medium")],
								[
									state.totalBytes === null
										? `${megabytes(state.downloadedBytes)} MB`
										: `${megabytes(state.downloadedBytes)} / ${megabytes(state.totalBytes)} MB (${percent}%)`,
								],
							),
						],
					),
					progressBar(h, { ariaLabel: "Download progress", value: percent }, [
						progressBarTrack(h, { value: percent }),
					]),
				],
			)
		},
		Installing: () => spinner(h, "Installing update..."),
		Restarting: () => spinner(h, "Restarting..."),
		InstallFailed: (state) => retry(h, Updates.installFailureText(state.reason), "Retry"),
	})

const appUpdates = (h: HtmlBuilder<Message>, model: Model, state: Updates.Model): ReadonlyArray<Html> => [
	divider(h),
	h.div(
		[h.Class("flex flex-col gap-5")],
		[
			settingsRow(
				h,
				{ title: "App Updates", description: "Check for and install app updates." },
				h.div(
					[h.Class("flex flex-col gap-4")],
					[
						h.div(
							[h.Class("rounded-lg border border-border bg-secondary/50 p-4")],
							[
								h.div(
									[h.Class("flex flex-col gap-4")],
									[
										h.div(
											[h.Class("flex items-center gap-3")],
											[
												h.div(
													[
														h.Class(
															"flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary",
														),
													],
													[IconCube(h, { className: "size-5 text-muted-fg" })],
												),
												h.div(
													[h.Class("flex flex-1 flex-col gap-0.5")],
													[
														h.span(
															[h.Class("text-sm text-muted-fg")],
															["Current version"],
														),
														badge(
															h,
															{
																intent: "secondary",
																size: "md",
																className: "self-start",
															},
															[
																h.span(
																	[h.Class("font-mono")],
																	[
																		model.version
																			? `v${model.version}`
																			: "...",
																	],
																),
															],
														),
													],
												),
											],
										),
										divider(h),
										updateStatus(h, state),
									],
								),
							],
						),
					],
				),
			),
		],
	),
]

/** Port of `routes/_app/$orgSlug/my-settings/desktop.tsx`; the App Updates block is desktop-only. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	h.form(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Desktop", "Settings for the desktop application."),
			// Autostart is a Tauri plugin: the native app (an updater without Tauri) has none yet.
			...(!hasUpdater || isDesktop
				? [
						h.div(
							[h.Class("flex flex-col gap-5")],
							[
								settingsRow(
									h,
									{
										title: "Launch at Startup",
										description: "Automatically start the app when you log in.",
									},
									h.div(
										[h.Class("flex flex-col gap-4")],
										[
											h.div(
												[
													h.Class(
														"rounded-lg border border-border bg-secondary/50 p-4",
													),
												],
												[
													switchControl(
														h,
														{
															id: "my-settings-autostart",
															isSelected: model.autostartEnabled ?? false,
															isDisabled: model.autostartEnabled === null,
															onChange: (isSelected) =>
																Message.ToggledAutostart({ isSelected }),
														},
														"Open at login",
													),
													h.p(
														[h.Class("mt-3 text-muted-fg text-sm")],
														[
															"When enabled, the app will automatically launch when you log in to your computer.",
														],
													),
												],
											),
										],
									),
								),
							],
						),
					]
				: []),
			...(hasUpdater ? appUpdates(h, model, shared.desktopUpdate) : []),
		],
	),
)
