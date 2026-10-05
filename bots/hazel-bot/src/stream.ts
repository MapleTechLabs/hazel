import type { AIContentChunk } from "@hazel-chat/bot-sdk"
import type { Response } from "effect/ai"
import { Match } from "effect"

export const mapEffectPartToChunk: (part: Response.AnyPart) => AIContentChunk | null =
	Match.type<Response.AnyPart>().pipe(
		Match.discriminators("type")({
			"text-delta": (part) => ({ type: "text" as const, text: part.delta }),
			"reasoning-delta": (part) => ({ type: "thinking" as const, text: part.delta, isComplete: false }),
			"reasoning-end": () => ({ type: "thinking" as const, text: "", isComplete: true }),
			"tool-call": (part) => ({
				type: "tool_call" as const,
				id: part.id,
				name: part.name,
				input: (part.params ?? {}) as Record<string, unknown>,
			}),
			"tool-result": (part) => ({
				type: "tool_result" as const,
				toolCallId: part.id,
				output: part.encodedResult,
				error: part.isFailure ? String(part.result) : undefined,
			}),
		}),
		Match.orElse(() => null),
	)
