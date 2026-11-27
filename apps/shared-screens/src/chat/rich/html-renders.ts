// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * HTML renders' signed URLs as a query (today's `MintHtmlRenderUrl`): one `queryMany` entry per
 * message and render. The URL lives for an hour; it goes stale well before, so a frame mounted
 * later (or the fullscreen dialog) gets a fresh one.
 */
import { Query } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ChannelId, HtmlRenderId, MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"

/** Why there is no URL: the message is gone or no longer shows the render, or anything else. */
export const RenderUrlFailure = Schema.Literals(["NotFound", "Unavailable"])
export type RenderUrlFailure = typeof RenderUrlFailure.Type

export class GetHtmlRenderUrl extends Query.Service<GetHtmlRenderUrl>()("hazel/chat/GetHtmlRenderUrl", {
	args: { channelId: ChannelId, messageId: MessageId, renderId: HtmlRenderId },
	success: Schema.String,
	error: RenderUrlFailure,
	staleTime: "30 minutes",
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return (ref) =>
				rpc("message.htmlRenderUrl", ref).pipe(
					Effect.map(({ url }) => url),
					Effect.catchTag("MessageNotFoundError", () => Effect.fail<RenderUrlFailure>("NotFound")),
					// BOUNDARY: offline, signed out or the server: the frame shows its failure the same way.
					Effect.catchCause((cause) =>
						Effect.logWarning("html render url failed", cause).pipe(
							Effect.andThen(Effect.fail<RenderUrlFailure>("Unavailable")),
						),
					),
				)
		}),
	)
}

/** One render's frame in the list: its message, the render and how it starts. */
export interface RenderRow {
	readonly channelId: ChannelId
	readonly messageId: MessageId
	readonly renderId: HtmlRenderId
	readonly title: string
	readonly height: number
}

export const renderArgsOf = (row: Pick<RenderRow, "channelId" | "messageId" | "renderId">) => ({
	channelId: row.channelId,
	messageId: row.messageId,
	renderId: row.renderId,
})

export const decodeRenderId = Schema.decodeUnknownOption(HtmlRenderId)
