import { Command, CommandGroup } from "@hazel-chat/bot-sdk"
import { Schema } from "effect"

// ============================================================================
// Schema for AI-generated issue
// ============================================================================

export const GeneratedIssueSchema = Schema.Struct({
	title: Schema.String,
	description: Schema.String,
})

// ============================================================================
// Commands
// ============================================================================

export const IssueCommand = Command.make("issue", {
	description: "Create a Linear issue",
	args: {
		title: Schema.String,
		description: Schema.optional(Schema.String),
	},
	usageExample: "/issue Fix the login bug",
})

export const IssueifyCommand = Command.make("issueify", {
	description: "Create a Linear issue from the conversation in this channel",
	args: {},
	usageExample: "/issueify 20",
})

export const commands = CommandGroup.make(IssueCommand, IssueifyCommand)
