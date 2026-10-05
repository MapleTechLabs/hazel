import { Layer, ManagedRuntime } from "effect"
import { ApiClient } from "./api-client"
import { HazelRpcClient } from "./rpc-atom-client"
import { TracerLive } from "./telemetry"

/**
 * Shared layer containing all services
 *
 * This layer includes:
 * - ApiClient: HTTP client for REST API calls
 * - RpcClient: RPC client for collection mutations
 * - HazelRpcClient: RPC client for atom mutations
 * - TracerLive: OpenTelemetry tracing (DevTools in dev, Maple in production)
 *
 * All RPC clients share the same WebSocket connection via RpcProtocolLive.
 */
export const runtimeLayer = Layer.mergeAll(ApiClient.layer, HazelRpcClient.layer, TracerLive)

/**
 * MemoMap shared between the ManagedRuntime and the atom runtime factory.
 */
export const sharedMemoMap = Layer.makeMemoMapUnsafe()

/**
 * Managed runtime for imperative Effect execution
 *
 * Uses sharedMemoMap to ensure layer memoization is shared with
 * atom runtimes created via `atomRuntime` (see registry.ts). This prevents duplicate WebSocket connections by
 * ensuring both the ManagedRuntime (for collections) and AtomRuntime (for
 * mutations) build layers with the same MemoMap, allowing Effect to reuse
 * already-built layer instances.
 *
 * Used by collections.ts and other imperative code that calls runtime.runPromise().
 */
export const runtime = ManagedRuntime.make(runtimeLayer, { memoMap: sharedMemoMap })
