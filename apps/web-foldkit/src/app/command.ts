import { OrganizationId, UserId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { Command, Port } from "foldkit"
import { catchCommon } from "../data/actions"
import { HazelRpc } from "../rpc"
import { type HostOut, HostOutSchema } from "./context"
import { Message } from "./message"

/** The host's one outbound port: what its pages and overlays ask the shell for. */
export const hostOut = Port.outbound(HostOutSchema)

export const Emit = Command.define("Emit", {
	args: { out: HostOutSchema },
	messages: [Message.CompletedEmit],
	execute: ({ out }) => Port.emit(hostOut, out).pipe(Effect.as(Message.CompletedEmit())),
})

export const emit = (out: HostOut) => Emit({ out })

const CREATE_DM_TIMEOUT = Duration.seconds(20)

/** `channel.createDm` for a single DM with `userId`. */
export const CreateDm = Command.define("CreateDm", {
	args: { organizationId: OrganizationId, orgSlug: Schema.String, userId: UserId, name: Schema.String },
	messages: [Message.SucceededCreateDm, Message.FailedCreateDm],
	execute: ({ organizationId, orgSlug, userId, name }) =>
		HazelRpc.use((rpc) =>
			rpc("channel.createDm", { organizationId, participantIds: [userId], type: "single" }),
		).pipe(
			// The loading toast and one-at-a-time guard wait on this: a hung request must end.
			Effect.timeout(CREATE_DM_TIMEOUT),
			Effect.map((result) =>
				Message.SucceededCreateDm({
					organizationId,
					orgSlug,
					userId,
					channelId: result.data.id,
					name,
				}),
			),
			Effect.catchTags({
				DmChannelAlreadyExistsError: () =>
					Effect.succeed(
						Message.FailedCreateDm({ organizationId, userId, reason: "AlreadyExists" }),
					),
				// Only single DMs with one member are asked for; a rejected shape is a bug here.
				InvalidChannelRequestError: () =>
					Effect.succeed(Message.FailedCreateDm({ organizationId, userId, reason: "Unexpected" })),
			}),
			catchCommon((reason) => Message.FailedCreateDm({ organizationId, userId, reason })),
		),
})
