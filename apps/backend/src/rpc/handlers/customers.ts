/**
 * Customers RPC handlers. Run in the org's `CustomersObject` (`rpc/routing.ts`).
 *
 * TODO(customers, backend agent): every method is a stub that dies until its implementation lands
 * (`docs/customers/tech-design.md` §7a). Replace each group's layer with the real handlers.
 */
import { CustomerAdminRpcs, CustomerQueueRpcs, CustomerReadRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"

const notImplemented = (group: { readonly requests: ReadonlyMap<string, unknown> }) =>
	Object.fromEntries(
		[...group.requests.keys()].map((tag) => [
			tag,
			() => Effect.die(new Error(`${tag} is not implemented yet (customers core)`)),
		]),
	) as never

export const CustomerReadRpcLive = CustomerReadRpcs.toLayer(Effect.succeed(notImplemented(CustomerReadRpcs)))
export const CustomerQueueRpcLive = CustomerQueueRpcs.toLayer(
	Effect.succeed(notImplemented(CustomerQueueRpcs)),
)
export const CustomerAdminRpcLive = CustomerAdminRpcs.toLayer(
	Effect.succeed(notImplemented(CustomerAdminRpcs)),
)
