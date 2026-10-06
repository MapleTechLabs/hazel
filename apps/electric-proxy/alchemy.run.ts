/**
 * electric-proxy for the root stack: the Effect Worker (`src/worker.ts`) plus, on deployed
 * non-PR stages, the `electric` Worker running self-hosted Electric in a Container
 * (`resources.ts`), which the proxy's props yield. The root needs only `yield* ElectricProxy`.
 */
export { default } from "./src/worker.ts"
export { ELECTRIC_IMAGE, ElectricHost, ProxyCache, usesElectricContainer } from "./resources.ts"
