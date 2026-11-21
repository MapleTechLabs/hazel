/**
 * The services a `CustomersObject`'s own work and its RPC handlers run with: ingest, the provider
 * adapters, the credentials' encryption and company lookups. `CustomerIngest` takes the object's `Database` and
 * `SqlClient`, which the host provides.
 */
import { Layer } from "effect"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { ContextDev } from "./enrichment/client"
import { CustomerIngest } from "./ingest"
import { CustomerProviders } from "./providers"

export const CustomersServicesLive = Layer.mergeAll(
	CustomerIngest.layer,
	CustomerProviders.layer,
	IntegrationEncryption.layer,
	ContextDev.layer,
)
