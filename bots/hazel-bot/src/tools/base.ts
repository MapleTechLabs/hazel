import { Tool } from "effect/ai"
import { Schema } from "effect"

export const GetCurrentTime = Tool.make("get_current_time", {
	description: "Get the current date and time in ISO format",
	success: Schema.String,
})

export const Calculate = Tool.make("calculate", {
	description: "Perform basic arithmetic calculations",
	parameters: Schema.Struct({
		operation: Schema.Literals(["add", "subtract", "multiply", "divide"]).annotate({
			description: "The arithmetic operation to perform",
		}),
		a: Schema.Finite.annotate({ description: "First operand" }),
		b: Schema.Finite.annotate({ description: "Second operand" }),
	}),
	success: Schema.Finite,
})
