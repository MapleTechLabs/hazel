import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { FetchHttpClient } from "effect/http"
import { Config, Effect, Layer } from "effect"

const OpenRouterClientLayer = OpenRouterClient.layerConfig({
	apiKey: Config.Redacted("OPENROUTER_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer))

/** For static layer composition (e.g., in index.ts) */
export const makeOpenRouterLayer = (model: string) =>
	OpenRouterLanguageModel.layer({ model }).pipe(Layer.provide(OpenRouterClientLayer))

/** For dynamic model selection at request time (used in handler.ts) */
export const makeOpenRouterModel = (model: string) =>
	OpenRouterLanguageModel.make({ model }).pipe(Effect.provide(OpenRouterClientLayer))
