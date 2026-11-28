// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A conversation on a phone (`docs/ios-native.md`, N2): the shared message list over the shared
 * composer, under the channel's name in the system bar. A DM is titled by its name as the sidebar
 * shows it. The list and the composer are the hosted ones (`../app/hosted`).
 */
import { Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { HostedChannelComposer, HostedMessageList } from "../app/hosted"

export const ChannelScreenProps = Schema.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	userId: UserId,
	cdnUrl: Schema.String,
	linkPreviewUrl: Schema.String,
	nowMs: Schema.Finite,
})
export type ChannelScreenProps = typeof ChannelScreenProps.Type

export const ChannelScreenMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { name: Schema.String, kind: Schema.String },
})
export type ChannelScreenMessage = typeof ChannelScreenMessage.Type

export const ChannelScreenModel = Schema.Struct({
	/** Null until the channel's row syncs. */
	name: Schema.NullOr(Schema.String),
	kind: Schema.String,
})

interface ChannelRow {
	readonly name: string
	readonly type: string
}

const channelStream = (channelId: ChannelId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) =>
				data.liveQueryStream<ChannelRow, ChannelRow | undefined>(
					(q) =>
						q
							.from({ channel: data.collections.channelCollection })
							.where(({ channel }) => eq(channel.id, channelId)),
					(rows) => rows[0],
				),
		),
	).pipe(
		Stream.filter((row): row is ChannelRow => row !== undefined),
		Stream.map((row) => ChannelScreenMessage.UpdatedChannel({ name: row.name, kind: row.type })),
	)

/** The bar's title: `# name` for a channel, the name alone for a DM or a thread. */
export const titleOf = (name: string | null, kind: string): string =>
	name === null ? "" : kind === "public" || kind === "private" ? `# ${name}` : name

export const ChannelScreen = Hazel.component({
	name: "ChannelScreen",
	props: ChannelScreenProps,
	model: ChannelScreenModel,
	message: ChannelScreenMessage,
}).make({
	init: () => ({ name: null, kind: "public" }),
	update: {
		UpdatedChannel: ($, { name, kind }) => ({ name, kind }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) => channelStream(channelId)),
	],
	view: (h, model) => {
		const { props } = h
		const isChannel = model.kind === "public" || model.kind === "private"
		return (
			h.screen
				.key(props.channelId)
				.title(titleOf(model.name, model.kind))
				.surface("page")
				// The list over the composer, or the page, has the whole height and scrolls itself.
				.fill(true)
				.children(
					HostedMessageList(h, {
						key: props.channelId,
						props: {
							channelId: props.channelId,
							userId: props.userId,
							cdnUrl: props.cdnUrl,
							linkPreviewUrl: props.linkPreviewUrl,
							nowMs: props.nowMs,
						},
					}),
					HostedChannelComposer(h, {
						key: props.channelId,
						props: {
							channelId: props.channelId,
							organizationId: props.organizationId,
							userId: props.userId,
							placeholder:
								model.name === null
									? "Message"
									: `Message ${isChannel ? "#" : ""}${model.name}`,
							ready: true,
							autoFocus: false,
						},
					}),
				)
		)
	},
})
