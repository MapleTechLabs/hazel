import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { FetchHttpClient } from "effect/http"
import { Config, Layer } from "effect"

// OpenRouter configuration from environment
const OpenRouterClientLayer = OpenRouterClient.layerConfig({
	apiKey: Config.Redacted("OPENROUTER_API_KEY"),
	siteReferrer: Config.String("APP_URL").pipe(Config.withDefault("https://app.hazel.sh")),
	siteTitle: Config.String("APP_NAME").pipe(Config.withDefault("Hazel")),
}).pipe(Layer.provide(FetchHttpClient.layer))

const MODEL = "anthropic/claude-3.5-haiku"

export const OpenRouterLanguageModelLayer = OpenRouterLanguageModel.layer({
	model: MODEL,
	config: {
		max_tokens: 200,
		temperature: 0.3,
	},
}).pipe(Layer.provide(OpenRouterClientLayer))
