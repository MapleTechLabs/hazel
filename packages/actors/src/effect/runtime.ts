import { FetchHttpClient } from "effect/http"
import { ConfigProvider, Layer, ManagedRuntime } from "effect"
import { TokenValidationLive } from "../auth"

const MessageActorRuntimeLayer = Layer.mergeAll(
	TokenValidationLive,
	FetchHttpClient.layer,
	ConfigProvider.layer(ConfigProvider.fromEnv()),
)

export const messageActorRuntime = ManagedRuntime.make(MessageActorRuntimeLayer)
