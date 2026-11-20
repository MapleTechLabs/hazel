import type { Html, HtmlBuilder } from "foldkit/html"
import * as ChatMigration from "../../shared/chat-migration"
import { Message } from "../message"
import type { StepOf } from "../model"
import { onboardingNavigation, stepHeader } from "../navigation"

/** Bring channels over from Slack or Discord: optional, so the first screen continues as a skip. */

const toMigrationMessage = (message: ChatMigration.Message) => Message.GotMigrationMessage({ message })

export const importStep = (h: HtmlBuilder<Message>, form: StepOf<"Import">): Html => {
	const { migration } = form
	const parts = ChatMigration.parts(h, migration, { toParentMessage: toMigrationMessage, canSkip: false })
	const isStart = migration.phase._tag === "ChoosingProvider"
	return h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", "onboarding-step-import")],
		[
			stepHeader(h, { title: parts.title, description: parts.description }),
			parts.body,
			isStart
				? onboardingNavigation(h, {
						onContinue: toMigrationMessage(ChatMigration.Message.ClickedSkip()),
						continueLabel: "Skip for now",
					})
				: h.div(
						[
							h.Class(
								// The channel step scrolls under it on every screen size, so it always has the page behind it.
								"sticky bottom-0 flex flex-wrap justify-between gap-2 bg-bg pt-4 pb-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]",
							),
						],
						[
							h.div([h.Class("flex gap-2")], [...parts.leading]),
							h.div([h.Class("flex gap-2")], [...parts.actions]),
						],
					),
		],
	)
}
