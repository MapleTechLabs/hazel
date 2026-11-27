// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the Files and All media pages ask of the platform: save, copy or open a file, and the
 * viewport's breakpoint for the media strip. The host provides `FilesHost` (the web's is
 * `web-foldkit/src/root/files-host.ts`); both pages run `RunFileAction` and map its outcome.
 */
import { Command } from "@effect/ui"
import type { MenuGroups } from "@hazel/ui/vocabulary/content"
import { Context, Effect, Match, Schema, type Stream } from "effect"
import type { AppToast } from "../../app/requests"
import type { Breakpoint } from "./attachments"

export class FilesHostError extends Schema.TaggedError<FilesHostError>()("FilesHostError", {
	reason: Schema.Literals(["denied", "unavailable"]),
}) {}

export class FilesHost extends Context.Service<
	FilesHost,
	{
		/** A temporary `<a download>` on the web. */
		readonly download: (url: string, fileName: string) => Effect.Effect<void>
		readonly open: (url: string) => Effect.Effect<void>
		readonly copyImage: (url: string) => Effect.Effect<void, FilesHostError>
		readonly copyText: (text: string) => Effect.Effect<void, FilesHostError>
		/** The current breakpoint, then each change. */
		readonly breakpoint: Stream.Stream<Breakpoint>
	}
>()("hazel/files/FilesHost") {}

/** The viewer's toolbar and menu actions (`ImageViewerAction`). */
export const FileAction = Schema.Literals(["download", "copyImage", "copyUrl", "openInBrowser"])
export type FileAction = typeof FileAction.Type

export const FileActionOutcome = Schema.Literals([
	"downloaded",
	"opened",
	"copiedImage",
	"failedCopyImage",
	"copiedUrl",
	"failedCopyUrl",
])
export type FileActionOutcome = typeof FileActionOutcome.Type

/** Runs one action; two pages issue it, so each maps the outcome to its own message. */
export class RunFileAction extends Command.Service<RunFileAction>()("hazel/files/RunFileAction", {
	args: { action: FileAction, url: Schema.String, fileName: Schema.String },
	success: FileActionOutcome,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const host = yield* FilesHost
			return ({ action, url, fileName }) =>
				Match.value(action).pipe(
					Match.when("download", () =>
						host.download(url, fileName).pipe(Effect.as("downloaded" as const)),
					),
					Match.when("openInBrowser", () => host.open(url).pipe(Effect.as("opened" as const))),
					Match.when("copyImage", () =>
						host.copyImage(url).pipe(
							Effect.as("copiedImage" as const),
							Effect.catchTag("FilesHostError", () =>
								Effect.succeed("failedCopyImage" as const),
							),
						),
					),
					Match.when("copyUrl", () =>
						host.copyText(url).pipe(
							Effect.as("copiedUrl" as const),
							Effect.catchTag("FilesHostError", () => Effect.succeed("failedCopyUrl" as const)),
						),
					),
					Match.exhaustive,
				)
		}),
	)
}

/** The viewer's entries: the ones with an icon are its toolbar, every one is in its menu. */
export const viewerEntries: MenuGroups = [
	{
		entries: [
			{ id: "download", label: "Download", icon: "download" },
			{ id: "copyImage", label: "Copy image", icon: "image" },
			{ id: "copyUrl", label: "Copy image URL", icon: "link" },
			{ id: "openInBrowser", label: "Open in browser", icon: "external-link" },
		],
	},
]

export const isFileAction = Schema.is(FileAction)

/** The toast an outcome shows (today's `viewerAction` and its results); a plain download shows none. */
export const outcomeToast = (outcome: FileActionOutcome, fromViewer: boolean): AppToast | null =>
	Match.value(outcome).pipe(
		Match.when("downloaded", () =>
			fromViewer
				? {
						intent: "success" as const,
						title: "Image downloaded",
						description: "Your image has been downloaded.",
					}
				: null,
		),
		Match.when("opened", () => null),
		Match.when("copiedImage", () => ({
			intent: "success" as const,
			title: "Image copied",
			description: "The image has been copied to your clipboard.",
		})),
		Match.when("failedCopyImage", () => ({
			intent: "error" as const,
			title: "Couldn't copy image",
			description: "Try downloading it instead.",
		})),
		Match.when("copiedUrl", () => ({
			intent: "success" as const,
			title: "URL copied",
			description: "Image URL has been copied to clipboard.",
		})),
		Match.when("failedCopyUrl", () => ({
			intent: "error" as const,
			title: "Couldn't copy",
			description: "Your browser blocked access to the clipboard.",
		})),
		Match.exhaustive,
	)
