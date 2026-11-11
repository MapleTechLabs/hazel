import { Command, CommandGroup } from "@hazel-chat/bot-sdk"
import { Schema } from "effect"

export const T3Command = Command.make("t3", {
	description: "Start a T3 Code thread on your machine (or a teammate's who shares theirs)",
	args: {
		prompt: Schema.String,
		project: Schema.optional(Schema.String),
		owner: Schema.optional(Schema.String),
	},
	usageExample: "/t3 Fix the flaky login test",
})

export const T3ProjectCommand = Command.make("t3-project", {
	description: "Set this channel's default T3 Code project, or list your projects",
	args: { project: Schema.optional(Schema.String) },
	usageExample: "/t3-project hazel",
})

export const T3StopCommand = Command.make("t3-stop", {
	description: "Stop the T3 Code run in this thread",
	args: {},
	usageExample: "/t3-stop",
})

export const commands = CommandGroup.make(T3Command, T3ProjectCommand, T3StopCommand)
