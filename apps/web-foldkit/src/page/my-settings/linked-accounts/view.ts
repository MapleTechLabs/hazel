import { Submodel } from "foldkit"
import { button } from "../../../ui/button"
import type { PageViewInputs } from "../../contract"
import { pageHeader } from "../shared"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/linked-accounts.tsx`. */
export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const isConnected = model.connection?.status === "active"
	const wiring = interaction.wiring(model)
	const action = isConnected
		? button(
				h,
				{
					intent: "danger",
					size: "sm",
					isDisabled: model.isDisconnecting,
					onPress: Message.ClickedUnlinkDiscord(),
					interaction: { wiring, target: "unlink-discord" },
				},
				[model.isDisconnecting ? "Unlinking..." : "Unlink"],
			)
		: button(
				h,
				{
					intent: "primary",
					size: "sm",
					isDisabled: model.isConnecting,
					onPress: Message.ClickedLinkDiscord(),
					interaction: { wiring, target: "link-discord" },
				},
				[model.isConnecting ? "Redirecting..." : "Link Discord"],
			)
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Linked Accounts", "Connect external accounts to enhance your experience."),
			h.div(
				[h.Class("max-w-xl")],
				[
					h.div(
						[h.Class("rounded-xl border border-border bg-bg p-4")],
						[
							h.div(
								[h.Class("flex items-start gap-4")],
								[
									h.img([
										h.Src("https://cdn.brandfetch.io/discord.com/w/64/h/64/theme/dark/icon"),
										h.Alt("Discord"),
										h.Class("size-10 rounded-lg"),
									]),
									h.div(
										[h.Class("flex-1")],
										[
											h.p([h.Class("font-medium text-sm text-fg")], ["Discord"]),
											h.p(
												[h.Class("text-muted-fg text-xs")],
												[
													isConnected
														? `Linked as ${model.connection?.externalAccountName ?? "Discord account"}. Synced Discord messages will be attributed to your Hazel account.`
														: "Link your Discord account so synced messages from Discord are attributed to you.",
												],
											),
											h.div([h.Class("mt-3")], [action]),
										],
									),
								],
							),
						],
					),
				],
			),
		],
	)
})
