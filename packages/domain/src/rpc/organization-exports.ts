import { OrganizationExportId, OrganizationId, TransactionId } from "@hazel/schema"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { InternalServerError, UnauthorizedError } from "../errors"
import { OrganizationExport } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"
import { AuthMiddleware } from "./middleware"

/**
 * Self-serve organization data exports (owners and admins): the `OrgObject` builds an NDJSON file
 * of the organization's data in the background; the exports are synced to admins
 * (`organization_exports`), and a ready one is downloaded through a short-lived signed URL.
 */

export class OrganizationExportResponse extends Schema.Class<
	OrganizationExportResponse,
	{ readonly brand: unique symbol }
>("OrganizationExportResponse")({
	data: OrganizationExport.Schema,
	transactionId: TransactionId,
}) {}

export class OrganizationExportListResponse extends Schema.Class<
	OrganizationExportListResponse,
	{ readonly brand: unique symbol }
>("OrganizationExportListResponse")({
	data: Schema.Array(OrganizationExport.Schema),
}) {}

export class OrganizationExportDownload extends Schema.Class<
	OrganizationExportDownload,
	{ readonly brand: unique symbol }
>("OrganizationExportDownload")({
	url: Schema.String,
	/** Epoch milliseconds; the URL is refused after. */
	expiresAt: Schema.Finite,
}) {}

export class OrganizationExportNotFoundError extends Schema.TaggedError<
	OrganizationExportNotFoundError,
	{ readonly brand: unique symbol }
>()("OrganizationExportNotFoundError", {
	exportId: OrganizationExportId,
}) {}

/** Another export of the organization is still being built. */
export class OrganizationExportInProgressError extends Schema.TaggedError<
	OrganizationExportInProgressError,
	{ readonly brand: unique symbol }
>()("OrganizationExportInProgressError", {
	exportId: OrganizationExportId,
}) {}

/** The export is not ready (still building, failed) or its file has expired. */
export class OrganizationExportUnavailableError extends Schema.TaggedError<
	OrganizationExportUnavailableError,
	{ readonly brand: unique symbol }
>()("OrganizationExportUnavailableError", {
	exportId: OrganizationExportId,
	reason: Schema.Literals(["NotReady", "Failed", "Expired"]),
}) {}

export class OrganizationExportRpcs extends RpcGroup.make(
	Rpc.make("organizationExport.start", {
		payload: Schema.Struct({ organizationId: OrganizationId }),
		success: OrganizationExportResponse,
		error: Schema.Union([OrganizationExportInProgressError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("organizationExport.list", {
		payload: Schema.Struct({ organizationId: OrganizationId }),
		success: OrganizationExportListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:read"])
		.middleware(AuthMiddleware),

	Rpc.make("organizationExport.downloadUrl", {
		payload: Schema.Struct({ organizationId: OrganizationId, id: OrganizationExportId }),
		success: OrganizationExportDownload,
		error: Schema.Union([
			OrganizationExportNotFoundError,
			OrganizationExportUnavailableError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),
) {}
