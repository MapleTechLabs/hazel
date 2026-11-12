import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { getTauriApp } from "../../../platform/tauri"
import { disableAutostart, enableAutostart, isAutostartEnabled } from "../../../platform/autostart"
import { errorToast } from "../../../data/actions"
import { hasUpdater, isDesktop } from "../../../platform/desktop"
import { PageOutMessage } from "../../out-message"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageReturn, PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

/** A Tauri plugin call (autostart, app version) rejected. */
class TauriPluginError extends Schema.TaggedError<TauriPluginError>()("TauriPluginError", {
	cause: Schema.Defect(),
}) {}

const tauri = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new TauriPluginError({ cause }) })

/** Reads the autostart state; a failure reads as off, as the legacy mount effect does. */
const readAutostart = tauri(isAutostartEnabled).pipe(
	Effect.catchTags({ TauriPluginError: () => Effect.succeed(false) }),
)

export const CheckAutostart = Command.define("CheckAutostart", {
	messages: [Message.CheckedAutostart],
	execute: readAutostart.pipe(Effect.map((isEnabled) => Message.CheckedAutostart({ isEnabled }))),
})

/** On failure the legacy handler re-reads the real state instead of keeping the toggle. */
export const SetAutostart = Command.define("SetAutostart", {
	args: { isEnabled: Schema.Boolean },
	messages: [Message.SucceededSetAutostart, Message.FailedSetAutostart],
	execute: ({ isEnabled }) =>
		tauri(isEnabled ? enableAutostart : disableAutostart).pipe(
			Effect.as(Message.SucceededSetAutostart({ isEnabled })),
			Effect.catchTags({
				TauriPluginError: () =>
					readAutostart.pipe(
						Effect.map((actual) =>
							Message.FailedSetAutostart({ reason: "PluginFailed", isEnabled: actual }),
						),
					),
			}),
		),
})

/** `useAppVersion()`: the installed version on desktop; unknown if the plugin fails. */
export const ReadVersion = Command.define("ReadVersion", {
	messages: [Message.ReadAppVersion],
	execute: tauri(async () => (await getTauriApp()?.getVersion()) ?? null).pipe(
		Effect.catchTags({ TauriPluginError: () => Effect.succeed(null) }),
		Effect.map((version) => Message.ReadAppVersion({ version })),
	),
})

/** What the app this page runs in offers. */
export type DesktopPlatform = Pick<Model, "hasAutostart" | "hasUpdates">

/** The page on a given platform: it reads the autostart state and the version only where they exist. */
export const initOn = (platform: DesktopPlatform): PageReturn<Model, Message> => ({
	model: {
		autostartEnabled: null,
		isUpdating: false,
		version: null,
		interaction: Interaction.init(),
		...platform,
	},
	commands: [
		...(platform.hasAutostart ? [CheckAutostart()] : []),
		// The version shows wherever the desktop app's settings do.
		...(platform.hasAutostart || platform.hasUpdates ? [ReadVersion()] : []),
	],
})

export const init = (): PageReturn<Model, Message> =>
	initOn({ hasAutostart: isDesktop, hasUpdates: hasUpdater })

const settleAutostart = (model: Model, isEnabled: boolean): Model =>
	modifyFields(model, { autostartEnabled: () => isEnabled, isUpdating: () => false })

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		// The initial read only fills an unknown state, so it can never undo a later write.
		CheckedAutostart: ({ isEnabled }) => ({
			model:
				model.autostartEnabled === null
					? modifyFields(model, { autostartEnabled: () => isEnabled })
					: model,
		}),
		ToggledAutostart: ({ isSelected }) =>
			model.isUpdating || model.autostartEnabled === null
				? { model }
				: {
						model: modifyFields(model, { isUpdating: () => true }),
						commands: [SetAutostart({ isEnabled: isSelected })],
					},
		SucceededSetAutostart: ({ isEnabled }) => ({ model: settleAutostart(model, isEnabled) }),
		FailedSetAutostart: ({ isEnabled }) => ({
			model: settleAutostart(model, isEnabled),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToast("Failed to update launch at login", "Please try again."),
			}),
		}),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
		ReadAppVersion: ({ version }) => ({ model: modifyFields(model, { version: () => version }) }),
		ClickedCheckForUpdates: () => ({ model, outMessage: PageOutMessage.RequestedUpdateCheck() }),
		ClickedInstallUpdate: () => ({ model, outMessage: PageOutMessage.RequestedUpdateInstall() }),
	})
