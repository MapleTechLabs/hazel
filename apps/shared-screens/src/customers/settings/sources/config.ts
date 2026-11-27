/**
 * Reading and editing a connection's provider config by a descriptor's field key (today's
 * `web-foldkit/.../settings/sources/model.ts`): the config's schema checks every edit.
 */
import { IntegrationConfig } from "@hazel/customer-integrations"
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Option, Schema } from "effect"

/**
 * `config` with one of its fields set, when the value fits the field: a descriptor's `ConfigField`
 * names the key, and the config's schema checks it.
 */
export const withConfigField = (
	config: IntegrationConfig,
	key: string,
	value: string | boolean,
): IntegrationConfig =>
	Option.getOrElse(Schema.decodeOption(IntegrationConfig)({ ...config, [key]: value }), () => config)

/** A field of `config` that fits `schema`, else `empty`. */
export const readField = <A>(
	config: ConnectionConfig,
	key: string,
	schema: Schema.Codec<A, unknown>,
	empty: A,
): A => {
	const value = Object.entries(config).find(([field]) => field === key)?.[1]
	return Schema.is(schema)(value) ? value : empty
}

/** A descriptor's Toggle field in `config`. */
export const configFlag = (config: IntegrationConfig, key: string): boolean =>
	readField(config, key, Schema.Boolean, false)

/** A descriptor's Text (or Select) field in `config`. */
export const configText = (config: IntegrationConfig, key: string): string =>
	readField(config, key, Schema.String, "")
