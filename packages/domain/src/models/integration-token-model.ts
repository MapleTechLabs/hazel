import { IntegrationConnectionId, IntegrationTokenId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

class Model extends M.Class<Model>("IntegrationToken")({
	id: M.Generated(IntegrationTokenId),
	connectionId: M.Immutable(IntegrationConnectionId),
	encryptedAccessToken: M.Sensitive(S.String),
	encryptedRefreshToken: M.Sensitive(S.NullOr(S.String)),
	iv: M.Sensitive(S.String),
	refreshTokenIv: M.Sensitive(S.NullOr(S.String)),
	encryptionKeyVersion: M.GeneratedByApp(S.Number),
	tokenType: M.GeneratedByApp(S.NullOr(S.String)),
	scope: M.GeneratedByApp(S.NullOr(S.String)),
	expiresAt: M.GeneratedByApp(S.NullOr(JsonDate)),
	refreshTokenExpiresAt: M.GeneratedByApp(S.NullOr(JsonDate)),
	lastRefreshedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(JsonDate),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
