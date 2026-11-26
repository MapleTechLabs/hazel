/**
 * Loaded first by `live-entry.ts`: the runtime baseline gaps (`./jsc-globals.ts`) and the web API
 * shims Effect's HTTP client constructs (`URL`, `AbortController`), before any other module runs.
 */
import "./jsc-globals"
import { installRuntimeShims } from "../../../packages/client-data/src/platform/jsc/runtime-shims.ts"

export const shimmed = installRuntimeShims()
