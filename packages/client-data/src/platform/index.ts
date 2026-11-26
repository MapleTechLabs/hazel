/**
 * Platform services. HTTP is Effect's own `HttpClient` service (`effect/http`): the web provides
 * `FetchHttpClient`, another host its own client. Everything else is in `./services.ts`.
 */
export * from "./services"
export { HttpClient } from "effect/http"
export * from "./runtime-baseline"
