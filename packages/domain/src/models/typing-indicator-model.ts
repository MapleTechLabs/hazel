import { ChannelId, ChannelMemberId, TypingIndicatorId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"

class Model extends M.Class<Model>("TypingIndicator")({
	id: M.Generated(TypingIndicatorId),
	channelId: ChannelId,
	memberId: ChannelMemberId,
	lastTyped: S.Number.annotate({
		title: "LastTyped",
		description: "Unix timestamp of last typing activity",
	}),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
