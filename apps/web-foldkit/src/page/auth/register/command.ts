import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { register } from "../../../auth/flows"
import { Message } from "./message"

export const Register = Command.define("Register", {
	args: {
		flowId: Schema.String,
		reference: Schema.String,
		firstName: Schema.String,
		lastName: Schema.String,
	},
	messages: [Message.LeftForApp, Message.FailedRegistration],
	execute: (input) =>
		register(input).pipe(
			Effect.as(Message.LeftForApp()),
			Effect.catchTags({
				AuthFlowError: ({ reason }) => Effect.succeed(Message.FailedRegistration({ reason })),
			}),
		),
})
