import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { disableAutostart, enableAutostart, isAutostartEnabled } from "~/lib/tauri-autostart"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn } from "../../contract"
import { embedInteraction } from "../shared"
import { Message } from "./message"
import type { Model } from "./model"

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

/** Reads the autostart state; a failure reads as off, as the legacy mount effect does. */
const readAutostart = Effect.tryPromise(() => isAutostartEnabled()).pipe(
	Effect.catch(() => Effect.succeed(false)),
	Effect.map((isEnabled) => Message.CheckedAutostart({ isEnabled })),
)

export const CheckAutostart = Command.define("CheckAutostart", {
	args: {},
	messages: [Message.CheckedAutostart],
	execute: () => readAutostart,
})

/** On failure the legacy handler re-reads the real state instead of keeping the toggle. */
export const SetAutostart = Command.define("SetAutostart", {
	args: { isEnabled: Schema.Boolean },
	messages: [Message.CheckedAutostart],
	execute: ({ isEnabled }) =>
		Effect.tryPromise(() => (isEnabled ? enableAutostart() : disableAutostart())).pipe(
			Effect.as(Message.CheckedAutostart({ isEnabled })),
			Effect.catch(() => readAutostart),
		),
})

export const init = (): PageReturn<Model, Message> => ({
	model: { autostartEnabled: null, interaction: Interaction.init() },
	commands: [CheckAutostart({})],
})

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		CheckedAutostart: ({ isEnabled }) => ({
			model: modifyFields(model, { autostartEnabled: () => isEnabled }),
		}),
		ToggledAutostart: ({ isSelected }) => ({
			model,
			commands: [SetAutostart({ isEnabled: isSelected })],
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
