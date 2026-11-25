import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import { cardClassName } from "../../../ui/card"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import { LinkedProvider, type Model, PROVIDER_LABELS } from "./model"
import { interaction } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/linked-accounts.tsx`, one card per provider. */

const accountCard = (h: HtmlBuilder<Message>, model: Model, provider: LinkedProvider): Html => {
	const { name } = PROVIDER_LABELS[provider]
	const connection = model.connections[provider]
	const isConnected = connection?.status === "active"
	const wiring = interaction.wiring(model)
	const isActing = model.link._tag !== "Idle"
	const isLinking = model.link._tag === "Linking" && model.link.provider === provider
	const isUnlinking = model.link._tag === "Unlinking" && model.link.provider === provider
	const isConfirming = model.link._tag === "ConfirmingUnlink" && model.link.provider === provider
	// One action at a time: every card waits while one runs.
	const action = isConfirming
		? h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					h.p(
						[h.Class("w-full text-fg text-xs")],
						[
							`Unlink ${name}? Messages you send from ${name} will no longer be attributed to you.`,
						],
					),
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							onPress: Message.ClickedCancelUnlink(),
							interaction: { wiring, target: `cancel-unlink-${provider}` },
						},
						["Cancel"],
					),
					button(
						h,
						{
							intent: "danger",
							size: "sm",
							onPress: Message.ClickedConfirmUnlink(),
							interaction: { wiring, target: `confirm-unlink-${provider}` },
						},
						[`Unlink ${name}`],
					),
				],
			)
		: isConnected
			? button(
					h,
					{
						intent: "outline",
						size: "sm",
						isDisabled: isActing,
						isPending: isUnlinking,
						onPress: Message.ClickedUnlink({ provider }),
						interaction: { wiring, target: `unlink-${provider}` },
					},
					[isUnlinking ? "Unlinking..." : "Unlink"],
				)
			: button(
					h,
					{
						intent: "primary",
						size: "sm",
						isDisabled: isActing,
						isPending: isLinking,
						onPress: Message.ClickedLink({ provider }),
						interaction: { wiring, target: `link-${provider}` },
					},
					[isLinking ? "Redirecting..." : `Link ${name}`],
				)
	return h.keyed("div")(
		provider,
		[h.Class(cardClassName("p-4"))],
		[
			h.div(
				[h.Class("flex items-start gap-4")],
				[
					h.img([
						// Brandfetch refuses hotlinked icons; the app ships each provider's logo.
						h.Src(`/images/integrations/${provider}.svg`),
						h.Alt(name),
						h.Class("size-10 rounded-lg"),
					]),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							h.p([h.Class("font-medium text-sm text-fg")], [name]),
							h.p(
								[h.Class("text-muted-fg text-xs")],
								[
									isConnected
										? `Linked as ${connection?.externalAccountName ?? `${name} account`}. Synced ${name} messages will be attributed to your Hazel account.`
										: `Link your ${name} account so synced messages from ${name} are attributed to you.`,
								],
							),
							h.div([h.Class("mt-3")], [action]),
						],
					),
				],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
	pageLayout(h, {}, [
		pageHeader(h, {
			title: "Linked accounts",
			subtitle: "Link your chat accounts so messages synced from them are attributed to you.",
			size: "title",
		}),
		h.div(
			[h.Class("flex max-w-xl flex-col gap-3")],
			LinkedProvider.literals.map((provider) => accountCard(h, model, provider)),
		),
	]),
)
