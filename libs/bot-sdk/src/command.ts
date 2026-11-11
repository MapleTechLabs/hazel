/**
 * Typesafe Command Definitions for Hazel Bot SDK
 *
 * This module provides a Schema-based command definition system that enables
 * full type safety for command names and arguments.
 */

import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"

/**
 * A single command definition with typed arguments
 */
export interface CommandDef<
	Name extends string = string,
	Args extends Schema.Struct.Fields = Schema.Struct.Fields,
> {
	readonly name: Name
	readonly description: string
	readonly args: Args
	readonly argsSchema: Schema.Struct<Args>
	readonly usageExample?: string
}

/**
 * Create a typed command definition
 *
 * @example
 * ```typescript
 * const IssueCommand = Command.make("issue", {
 *   description: "Create a Linear issue",
 *   args: {
 *     title: Schema.String,
 *     description: Schema.optional(Schema.String),
 *   },
 * })
 * ```
 */
export const Command = {
	make: <Name extends string, Args extends Schema.Struct.Fields = {}>(
		name: Name,
		config: {
			readonly description: string
			readonly args?: Args
			readonly usageExample?: string
		},
	): CommandDef<Name, Args> => ({
		name,
		description: config.description,
		args: (config.args ?? {}) as Args,
		argsSchema: Schema.Struct((config.args ?? {}) as Args),
		usageExample: config.usageExample,
	}),
}

/**
 * A group of command definitions
 */
export class CommandGroup<Commands extends readonly CommandDef<string, any>[]> {
	constructor(readonly commands: Commands) {}

	static make<C extends readonly CommandDef<string, any>[]>(...commands: C): CommandGroup<C> {
		return new CommandGroup(commands)
	}

	/**
	 * Get a command by name (for runtime lookups)
	 */
	get<N extends CommandNames<this>>(name: N): Extract<Commands[number], { name: N }> | undefined {
		return this.commands.find((cmd) => cmd.name === name) as
			| Extract<Commands[number], { name: N }>
			| undefined
	}
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract union of command names from a CommandGroup
 */
export type CommandNames<G> = G extends CommandGroup<infer C> ? C[number]["name"] : never

/**
 * Extract the args Schema fields for a specific command name
 */
export type CommandArgsFields<G, N extends string> =
	G extends CommandGroup<infer C> ? Extract<C[number], { name: N }>["args"] : never

/**
 * Extract the decoded args type for a specific command name
 */
export type CommandArgs<G, N extends string> =
	G extends CommandGroup<infer C>
		? Extract<C[number], { name: N }> extends { argsSchema: Schema.Schema<infer A> }
			? A
			: {}
		: never

/**
 * Typed command context with inferred args
 */
export interface TypedCommandContext<Args> {
	readonly commandName: string
	readonly channelId: ChannelId
	readonly userId: UserId
	readonly orgId: OrganizationId
	readonly args: Args
	readonly timestamp: number
}

/**
 * Empty command group for bots without commands
 */
export const EmptyCommandGroup = CommandGroup.make()
export type EmptyCommands = typeof EmptyCommandGroup
