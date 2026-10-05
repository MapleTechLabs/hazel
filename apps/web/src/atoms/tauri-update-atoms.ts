/**
 * @module Tauri update atoms
 * @platform desktop
 * @description Effect Atom-based state management for Tauri app updates
 */

import { Atom } from "effect/reactivity"
import {
	getTauriProcess,
	getTauriUpdater,
	type TauriProcessApi,
	type TauriUpdaterApi,
} from "@hazel/desktop/bridge"
import { Data, Duration, Effect } from "effect"

type TauriUpdate = Awaited<ReturnType<TauriUpdaterApi["check"]>>
type DownloadCallback = NonNullable<Parameters<NonNullable<TauriUpdate>["download"]>[0]>
type DownloadEvent = Parameters<DownloadCallback>[0]

/**
 * Tagged error classes for update operations
 */
export class UpdateCheckError extends Data.TaggedError("UpdateCheckError")<{
	message: string
}> {}

export class UpdateDownloadError extends Data.TaggedError("UpdateDownloadError")<{
	message: string
}> {}

export class UpdateInstallError extends Data.TaggedError("UpdateInstallError")<{
	message: string
}> {}

export class UpdateRelaunchError extends Data.TaggedError("UpdateRelaunchError")<{
	message: string
}> {}

export class UpdateExitError extends Data.TaggedError("UpdateExitError")<{
	message: string
}> {}

const updater: TauriUpdaterApi | undefined = getTauriUpdater()
const process: TauriProcessApi | undefined = getTauriProcess()

/**
 * Update check state
 */
export type TauriUpdateState =
	| { _tag: "idle" }
	| { _tag: "checking" }
	| { _tag: "available"; version: string; body: string | null; update: NonNullable<TauriUpdate> }
	| { _tag: "not-available"; lastCheckedAt: Date }
	| { _tag: "error"; message: string }

/**
 * Download/install progress state
 */
export type TauriDownloadState =
	| { _tag: "idle" }
	| { _tag: "downloading"; downloadedBytes: number; totalBytes: number | undefined }
	| { _tag: "installing" }
	| { _tag: "restarting" }
	| { _tag: "error"; message: string }

/**
 * Writable atom holding the update check result
 */
export const tauriUpdateStateAtom = Atom.make<TauriUpdateState>({ _tag: "idle" }).pipe(Atom.keepAlive)

/**
 * Writable atom holding the download/install progress
 */
export const tauriDownloadStateAtom = Atom.make<TauriDownloadState>({ _tag: "idle" }).pipe(Atom.keepAlive)

/**
 * Check for updates interval (6 hours) in milliseconds
 */
export const UPDATE_CHECK_INTERVAL_MS = Duration.toMillis(Duration.hours(6))

/**
 * Checks for updates and calls the setter with the result.
 * This is a plain async function that works with React's useAtomSet.
 */
export async function checkForUpdates(setUpdateState: (state: TauriUpdateState) => void): Promise<void> {
	if (!updater) return

	setUpdateState({ _tag: "checking" })

	try {
		const update = await updater.check()

		if (update) {
			setUpdateState({
				_tag: "available",
				version: update.version,
				body: update.body ?? null,
				update,
			})
		} else {
			setUpdateState({ _tag: "not-available", lastCheckedAt: new Date() })
		}
	} catch (error) {
		console.error("[update] Check failed:", error)
		setUpdateState({
			_tag: "error",
			message: error instanceof Error ? error.message : "Update check failed",
		})
	}
}

/**
 * Creates an Effect that downloads and installs an update.
 * The component should pass the setDownloadState function to update progress.
 *
 * Uses separate download() and install() phases for better progress tracking
 * and error handling.
 */
export const createDownloadEffect = (
	update: NonNullable<TauriUpdate>,
	setDownloadState: (state: TauriDownloadState) => void,
) =>
	Effect.gen(function* () {
		let downloadedBytes = 0
		let totalBytes: number | undefined

		// Phase 1: Download with progress tracking
		yield* Effect.tryPromise({
			try: () =>
				update.download((event: DownloadEvent) => {
					console.log("[update] Download event:", event.event)
					switch (event.event) {
						case "Started":
							console.log("[update] Content length:", event.data.contentLength)
							totalBytes = event.data.contentLength ?? undefined
							setDownloadState({
								_tag: "downloading",
								downloadedBytes: 0,
								totalBytes,
							})
							break
						case "Progress":
							downloadedBytes += event.data.chunkLength
							setDownloadState({
								_tag: "downloading",
								downloadedBytes,
								totalBytes,
							})
							break
						case "Finished":
							console.log("[update] Download finished")
							break
					}
				}),
			catch: (error) =>
				new UpdateDownloadError({
					message: error instanceof Error ? error.message : "Download failed",
				}),
		})

		// Phase 2: Install
		setDownloadState({ _tag: "installing" })
		yield* Effect.tryPromise({
			try: () => update.install(),
			catch: (error) =>
				new UpdateInstallError({
					message: error instanceof Error ? error.message : "Installation failed",
				}),
		})

		// Phase 3: Restart with delay to ensure installation completes
		setDownloadState({ _tag: "restarting" })
		yield* Effect.sleep(Duration.millis(500))

		if (!process) {
			return yield* Effect.fail(
				new UpdateRelaunchError({
					message:
						"Update installed, but restart is unavailable. Please quit and reopen Hazel manually.",
				}),
			)
		}

		yield* Effect.tryPromise({
			try: () => process.relaunch(),
			catch: (error) =>
				new UpdateRelaunchError({
					message:
						error instanceof Error
							? error.message
							: "Automatic restart failed after installing the update.",
				}),
		})
	}).pipe(
		Effect.catchTags({
			UpdateDownloadError: (error) =>
				Effect.sync(() => {
					console.error("[update] Download failed:", error.message)
					setDownloadState({ _tag: "error", message: error.message })
				}),
			UpdateInstallError: (error) =>
				Effect.sync(() => {
					console.error("[update] Install failed:", error.message)
					setDownloadState({ _tag: "error", message: error.message })
				}),
			UpdateRelaunchError: (error) =>
				Effect.gen(function* () {
					console.error("[update] Relaunch failed:", error.message)

					if (!process) {
						setDownloadState({
							_tag: "error",
							message:
								"Update installed, but restart is unavailable. Please quit and reopen Hazel manually.",
						})
						return
					}

					yield* Effect.tryPromise({
						try: () => process.exit(0),
						catch: () =>
							new UpdateExitError({
								message:
									"Update installed, but restart failed and Hazel could not quit automatically. Please quit and reopen Hazel manually.",
							}),
					}).pipe(
						Effect.catchTag("UpdateExitError", (exitError) =>
							Effect.sync(() => {
								console.error("[update] Exit fallback failed:", exitError.message)
								setDownloadState({ _tag: "error", message: exitError.message })
							}),
						),
					)
				}),
		}),
	)

/**
 * Check if we're in a Tauri environment
 */
export const isTauriEnvironment = !!updater
