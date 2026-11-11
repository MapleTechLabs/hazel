import type { Layer } from "effect"
import type { CommandGroup, EmptyCommands } from "./command.ts"
import { runHazelBot, type RunBotConfig } from "./run-bot.ts"

export interface BotDefinition<Commands extends CommandGroup<any> = EmptyCommands> {
	readonly commands?: Commands
	readonly mentionable?: boolean
	readonly layers?: readonly Layer.Layer<any, any, any>[]
	readonly serviceName?: string
	readonly healthPort?: number | false
	readonly setup: RunBotConfig<Commands>["setup"]
}

export const defineBot = <Commands extends CommandGroup<any> = EmptyCommands>(
	definition: BotDefinition<Commands>,
): BotDefinition<Commands> => definition

export interface RunNodeBotOptions<Commands extends CommandGroup<any> = EmptyCommands> extends Omit<
	RunBotConfig<Commands>,
	"commands" | "mentionable" | "layers" | "setup"
> {}

export const runNodeBot = <Commands extends CommandGroup<any> = EmptyCommands>(
	definition: BotDefinition<Commands>,
	options?: RunNodeBotOptions<Commands>,
): void => {
	runHazelBot({
		...options,
		commands: definition.commands,
		mentionable: definition.mentionable,
		layers: definition.layers,
		serviceName: definition.serviceName ?? options?.serviceName,
		healthPort: definition.healthPort ?? options?.healthPort,
		setup: definition.setup,
	})
}
