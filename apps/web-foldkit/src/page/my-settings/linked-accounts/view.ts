import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { button } from "../../../ui/button"
import type { PageViewInputs } from "../../contract"
import { pageHeader } from "../shared"
import { Message } from "./message"
import { LinkedProvider, type Model, PROVIDER_LABELS } from "./model"
import { interaction } from "./update"

/** Port of `routes/_app/$orgSlug/my-settings/linked-accounts.tsx`, one card per provider. */

const accountCard = (h: HtmlBuilder<Message>, model: Model, provider: LinkedProvider): Html => {
	const { name, domain } = PROVIDER_LABELS[provider]
	const connection = model.connections[provider]
	const isConnected = connection?.status === "active"
	const wiring = interaction.wiring(model)
	const isActing = model.link._tag !== "Idle"
	const isLinking = model.link._tag === "Linking" && model.link.provider === provider
	const isUnlinking = model.link._tag === "Unlinking" && model.link.provider === provider
	// One action at a time: every card waits while one runs.
	const action = isConnected
		? button(
				h,
				{
					intent: "danger",
					size: "sm",
					isDisabled: isActing,
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
					onPress: Message.ClickedLink({ provider }),
					interaction: { wiring, target: `link-${provider}` },
				},
				[isLinking ? "Redirecting..." : `Link ${name}`],
			)
	return h.keyed("div")(
		provider,
		[h.Class("rounded-xl border border-border bg-bg p-4")],
		[
			h.div(
				[h.Class("flex items-start gap-4")],
				[
					h.img([
						h.Src(`https://cdn.brandfetch.io/${domain}/w/64/h/64/theme/dark/icon`),
						h.Alt(name),
						h.Class("size-10 rounded-lg"),
					]),
					h.div(
						[h.Class("flex-1")],
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
	h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			pageHeader(h, "Linked Accounts", "Connect external accounts to enhance your experience."),
			h.div(
				[h.Class("flex max-w-xl flex-col gap-3")],
				LinkedProvider.literals.map((provider) => accountCard(h, model, provider)),
			),
		],
	),
)
