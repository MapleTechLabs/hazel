import { Command, CommandGroup } from "@hazel-chat/bot-sdk"
import { Schema } from "effect"

export const AskCommand = Command.make("ask", {
	description: "Ask the AI agent (supports tool use and reasoning)",
	args: {
		message: Schema.String,
	},
	usageExample: '/ask message="Search for patterns in the codebase"',
})

export const TestCommand = Command.make("test", {
	description: "Verify that Hazel Bot command delivery is working",
	usageExample: "/test",
})

export const commands = CommandGroup.make(AskCommand, TestCommand)
