import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { clientData } from "~/db/client"
import { Message } from "./model"

/**
 * The profile card's "Message": the viewer's DM with `userId` in `organizationId`, read from the
 * synced rows (`existingDm`, as the DM modal and the home page do). The modal's module loads with
 * the lookup, so the channel page's chunk does not carry it.
 */
export const FindUserDm = Command.define("FindUserDm", {
	args: { organizationId: OrganizationId, viewerId: UserId, userId: UserId, name: Schema.String },
	messages: [Message.FoundUserDm],
	execute: ({ organizationId, viewerId, userId, name }) =>
		Effect.promise(() => import("@hazel/shared-screens/modals/CreateDmModal")).pipe(
			Effect.map(({ existingDm }) =>
				Message.FoundUserDm({
					userId,
					name,
					channelId: existingDm(clientData, organizationId, viewerId, [userId]),
				}),
			),
		),
})
