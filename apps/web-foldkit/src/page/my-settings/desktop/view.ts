import { Submodel } from "foldkit"
import { switchControl } from "../../../ui/switch"
import type { PageViewInputs } from "../../contract"
import { pageHeader, settingsRow } from "../shared"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/desktop.tsx`, web build (the App Updates block is Tauri-only). */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	h.form(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Desktop", "Settings for the desktop application."),
			h.div(
				[h.Class("flex flex-col gap-5")],
				[
					settingsRow(
						h,
						{ title: "Launch at Startup", description: "Automatically start the app when you log in." },
						h.div(
							[h.Class("flex flex-col gap-4")],
							[
								h.div(
									[h.Class("rounded-lg border border-border bg-secondary/50 p-4")],
									[
										switchControl(
											h,
											{
												id: "my-settings-autostart",
												isSelected: model.autostartEnabled ?? false,
												isDisabled: model.autostartEnabled === null,
												onChange: (isSelected) => Message.ToggledAutostart({ isSelected }),
												interaction: interaction.wiring(model),
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
		],
	),
)
