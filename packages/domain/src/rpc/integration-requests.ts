import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { IntegrationRequestId, OrganizationId } from "@hazel/schema"
import { IntegrationRequest } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful integration request creation.
 */
export class IntegrationRequestResponse extends Schema.Class<IntegrationRequestResponse>(
	"IntegrationRequestResponse",
)({
	data: IntegrationRequest.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Payload for creating an integration request.
 */
export class CreateIntegrationRequestPayload extends Schema.Class<CreateIntegrationRequestPayload>(
	"CreateIntegrationRequestPayload",
)({
	organizationId: OrganizationId,
	integrationName: Schema.NonEmptyString,
	integrationUrl: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
}) {}

/**
 * Integration Request RPC Group
 *
 * Simple RPC for submitting integration requests.
 */
export class IntegrationRequestRpcs extends RpcGroup.make(
	Rpc.make("integrationRequest.create", {
		payload: CreateIntegrationRequestPayload,
		success: IntegrationRequestResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["integration-connections:write"])
		.middleware(AuthMiddleware),
) {}
