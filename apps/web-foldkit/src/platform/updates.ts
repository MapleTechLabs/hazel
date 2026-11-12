import { getTauriProcess, getTauriUpdater } from "./tauri"
import { Clock, Duration, Effect, Queue, Schema, Stream } from "effect"
import { Command, Subscription, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { ToastRequest } from "../overlay/toasts"
import { hasUpdater } from "./desktop"

/**
 * Desktop app updates (legacy `tauri-update-atoms.ts` and `TauriUpdateCheck`): a check at start
 * and every 6 hours, then download, install and relaunch on request. Web builds never check.
 */

export const CHECK_INTERVAL = Duration.hours(6)

/** Why an install did not finish. */
export const InstallFailure = Schema.Literals([
	"NoUpdate",
	"DownloadFailed",
	"InstallFailed",
	"RestartUnavailable",
	"RestartFailed",
])
export type InstallFailure = typeof InstallFailure.Type

export const Model = defineTaggedUnion({
	Idle: {},
	Checking: {},
	Available: { version: Schema.String, body: Schema.NullOr(Schema.String) },
	UpToDate: { checkedAtMs: Schema.Number },
	CheckFailed: {},
	Downloading: { downloadedBytes: Schema.Number, totalBytes: Schema.NullOr(Schema.Number) },
	Installing: {},
	Restarting: {},
	InstallFailed: { reason: InstallFailure },
})
export type Model = typeof Model.Type

export const init = (): Model => Model.Idle()

export const Message = defineMessageUnion({
	TickedUpdateCheck: {},
	FoundUpdate: { version: Schema.String, body: Schema.NullOr(Schema.String) },
	FoundNoUpdate: { checkedAtMs: Schema.Number },
	FailedUpdateCheck: {},
	ProgressedDownload: { downloadedBytes: Schema.Number, totalBytes: Schema.NullOr(Schema.Number) },
	StartedInstall: {},
	StartedRelaunch: {},
	FailedInstall: { reason: InstallFailure },
})
export type Message = typeof Message.Type

/** What the update state asks the root for: the toast that follows each step (legacy `TauriUpdateCheck`). */
export const OutMessage = defineMessageUnion({
	RequestedToast: { toast: ToastRequest },
})
export type OutMessage = typeof OutMessage.Type

// COPY

const INSTALL_FAILURE_TEXT: { readonly [Reason in InstallFailure]: string } = {
	NoUpdate: "No update to install",
	DownloadFailed: "Download failed",
	InstallFailed: "Installation failed",
	RestartUnavailable:
		"Update installed, but restart is unavailable. Please quit and reopen Hazel manually.",
	RestartFailed:
		"Update installed, but restart failed and Hazel could not quit automatically. Please quit and reopen Hazel manually.",
}

export const CHECK_FAILURE_TEXT = "Update check failed"

export const installFailureText = (reason: InstallFailure): string => INSTALL_FAILURE_TEXT[reason]

// COMMANDS

/** The Tauri updater rejected a call. */
class UpdaterError extends Schema.TaggedError<UpdaterError>()("UpdaterError", { cause: Schema.Defect() }) {}

const updaterCall = <A>(call: () => Promise<A>) =>
	Effect.tryPromise({ try: call, catch: (cause) => new UpdaterError({ cause }) })

export const CheckForUpdate = Command.define("CheckForUpdate", {
	messages: [Message.FoundUpdate, Message.FoundNoUpdate, Message.FailedUpdateCheck],
	execute: Effect.gen(function* () {
		const updater = getTauriUpdater()
		const found = updater === undefined ? null : yield* updaterCall(() => updater.check())
		if (found) return Message.FoundUpdate({ version: found.version, body: found.body ?? null })
		return Message.FoundNoUpdate({ checkedAtMs: yield* Clock.currentTimeMillis })
	}).pipe(Effect.catchTag("UpdaterError", () => Effect.succeed(Message.FailedUpdateCheck()))),
})

// UPDATE

const isBusy = (model: Model) =>
	model._tag === "Checking" ||
	model._tag === "Downloading" ||
	model._tag === "Installing" ||
	model._tag === "Restarting"

/** Whether an update is being downloaded or installed: the install stream runs while this holds. */
export const isInstalling = (model: Model) =>
	model._tag === "Downloading" || model._tag === "Installing" || model._tag === "Restarting"

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const TOAST_ID = "tauri-update"

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** The toast for a change of update state, if it needs one. */
const toastOf = (previous: Model, next: Model): ToastRequest | undefined =>
	Model.match(next, {
		Idle: () => undefined,
		Checking: () => undefined,
		UpToDate: () => undefined,
		CheckFailed: () => undefined,
		Available: ({ version, body }): ToastRequest | undefined =>
			previous._tag === "Available"
				? undefined
				: {
						intent: "info",
						title: `Update available: v${version}`,
						description: body ?? "A new version is ready to install",
						id: TOAST_ID,
						isSticky: true,
						action: { label: "Install & Restart", key: "InstallUpdate" },
					},
		Downloading: ({ downloadedBytes, totalBytes }): ToastRequest => ({
			intent: "loading",
			title:
				totalBytes === null
					? `Downloading update... ${megabytes(downloadedBytes)} MB`
					: `Downloading update... ${Math.round((downloadedBytes / totalBytes) * 100)}%`,
			description: null,
			id: TOAST_ID,
		}),
		Installing: (): ToastRequest => ({
			intent: "loading",
			title: "Installing update...",
			description: null,
			id: TOAST_ID,
		}),
		Restarting: (): ToastRequest => ({
			intent: "loading",
			title: "Restarting...",
			description: null,
			id: TOAST_ID,
		}),
		InstallFailed: ({ reason }): ToastRequest | undefined =>
			previous._tag === "InstallFailed"
				? undefined
				: {
						intent: "error",
						title: "Update failed",
						description: installFailureText(reason),
						id: TOAST_ID,
					},
	})

/** The next state, with the toast it calls for. */
const transition = (previous: Model, next: Model, commands: Return["commands"] = []): Return => {
	const toast = toastOf(previous, next)
	return toast === undefined
		? { model: next, commands }
		: { model: next, commands, outMessage: OutMessage.RequestedToast({ toast }) }
}

/** Check now (the menu item, the settings button, the timer); ignored while busy. */
export const check = (model: Model): Return =>
	isBusy(model) ? { model } : transition(model, Model.Checking(), [CheckForUpdate()])

/** Install the update `check` found; the install stream starts once the state says Downloading. */
export const install = (model: Model): Return =>
	model._tag === "Available"
		? transition(model, Model.Downloading({ downloadedBytes: 0, totalBytes: null }))
		: { model }

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		TickedUpdateCheck: () => check(model),
		FoundUpdate: ({ version, body }) => transition(model, Model.Available({ version, body })),
		FoundNoUpdate: ({ checkedAtMs }) => transition(model, Model.UpToDate({ checkedAtMs })),
		FailedUpdateCheck: () => transition(model, Model.CheckFailed()),
		ProgressedDownload: ({ downloadedBytes, totalBytes }) =>
			transition(model, Model.Downloading({ downloadedBytes, totalBytes })),
		StartedInstall: () => transition(model, Model.Installing()),
		StartedRelaunch: () => transition(model, Model.Restarting()),
		FailedInstall: ({ reason }) => transition(model, Model.InstallFailed({ reason })),
	})

// SUBSCRIPTION

/**
 * Download with progress, install, then relaunch (or quit, if relaunch fails). The update handle is
 * a live Tauri resource, so it is looked up again here instead of being kept between check and install.
 */
const installStream: Stream.Stream<Message> = Stream.callback<Message>((queue) =>
	Effect.gen(function* () {
		const offer = (message: Message) => Effect.sync(() => Queue.offerUnsafe(queue, message))
		const fail = (reason: InstallFailure) => offer(Message.FailedInstall({ reason }))
		const updater = getTauriUpdater()
		const found =
			updater === undefined
				? null
				: yield* updaterCall(() => updater.check()).pipe(Effect.orElseSucceed(() => null))
		if (found === null) return yield* fail("NoUpdate")

		let downloadedBytes = 0
		let totalBytes: number | null = null
		const downloaded = yield* updaterCall(() =>
			found.download((event) => {
				if (event.event === "Started") totalBytes = event.data.contentLength ?? null
				if (event.event === "Progress") downloadedBytes += event.data.chunkLength
				Queue.offerUnsafe(queue, Message.ProgressedDownload({ downloadedBytes, totalBytes }))
			}),
		).pipe(Effect.result)
		if (downloaded._tag === "Failure") return yield* fail("DownloadFailed")

		yield* offer(Message.StartedInstall())
		const installed = yield* updaterCall(() => found.install()).pipe(Effect.result)
		if (installed._tag === "Failure") return yield* fail("InstallFailed")

		yield* offer(Message.StartedRelaunch())
		// Give the installer a moment to finish before restarting.
		yield* Effect.sleep(Duration.millis(500))
		const process = getTauriProcess()
		if (process === undefined) return yield* fail("RestartUnavailable")
		const relaunched = yield* updaterCall(() => process.relaunch()).pipe(Effect.result)
		if (relaunched._tag === "Success") return
		const exited = yield* updaterCall(() => process.exit(0)).pipe(Effect.result)
		if (exited._tag === "Failure") yield* fail("RestartFailed")
	}).pipe(Effect.andThen(Effect.never)),
)

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	// At start, then every 6 hours, wherever an updater answers; never in the browser.
	periodicCheck: Subscription.persistentEntry(
		hasUpdater
			? Stream.concat(Stream.succeed(undefined), Stream.tick(CHECK_INTERVAL)).pipe(
					Stream.map(() => Message.TickedUpdateCheck()),
				)
			: Stream.empty,
	),
	install: entry(
		{ isInstalling: Schema.Boolean },
		{
			modelToDependencies: (model) => ({ isInstalling: isInstalling(model) }),
			dependenciesToStream: ({ isInstalling }) => (isInstalling ? installStream : Stream.empty),
		},
	),
}))
