/**
 * `CustomersObject`: one per organization (DO name = organization id), holding its Customers area
 * (`docs/customers/tech-design.md`). See `./runtime.ts`.
 */
import * as Cloudflare from "@alchemy.run/cloudflare"
import { activateObject } from "./activate"
import { OBJECT_NAMESPACES } from "./kinds"
import type { ObjectRpc } from "./protocol"

export class CustomersObject extends Cloudflare.DurableObject<CustomersObject, ObjectRpc>()(
	OBJECT_NAMESPACES.customers,
) {}

export const CustomersObjectLive = CustomersObject.make(activateObject("customers"))
