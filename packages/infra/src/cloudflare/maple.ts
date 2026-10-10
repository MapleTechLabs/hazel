/**
 * Worker telemetry to Maple through `@maple-dev/alchemy`. The stack merges `Maple.providers()`
 * when `MAPLE_API_KEY` is set, and each Effect Worker provides {@link hazelTelemetry} on its init:
 * the deploy binds the org's private ingest key onto the Worker, so no ingest key is copied into
 * CI or Infisical. Environment and revision reach the SDK as `MAPLE_ENVIRONMENT` / `COMMIT_SHA`
 * (`telemetryEnv` in `../env.ts`).
 */
import * as Maple from "@maple-dev/alchemy"
import { Telemetry } from "@maple-dev/alchemy/telemetry"

/** Every Hazel service reports under this `service.namespace`. */
export const MAPLE_SERVICE_NAMESPACE = "hazel"

/**
 * Whether this deploy talks to the Maple API. Not under `alchemy dev` (Workers then run without
 * an ingest key and the SDK is a no-op), nor without `MAPLE_API_KEY`. Plan-time only.
 */
export const isMapleDeploy = (): boolean =>
	process.env.ALCHEMY_DEV !== "true" && Boolean(process.env.MAPLE_API_KEY?.trim())

/** The org's ingest keys: a read-only singleton whose private key the Workers export with. */
export const MapleIngest = Maple.IngestKeys("ingest")

/** Traces, logs and metrics of an Effect Worker to Maple. Provide it on the Worker's init. */
export const hazelTelemetry = (serviceName: string) =>
	Telemetry({
		serviceName,
		serviceNamespace: MAPLE_SERVICE_NAMESPACE,
		// `__ALCHEMY_RUNTIME__` folds to `true` in the bundle: the deployed Worker reads the bound key.
		ingestKey: !globalThis.__ALCHEMY_RUNTIME__ && isMapleDeploy() ? MapleIngest : undefined,
	})
