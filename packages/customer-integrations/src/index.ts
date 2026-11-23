/** The browser-safe entry: definitions and registry lookups, no adapter code. */
export type { IngestPolicy, IntegrationCapabilities, IntegrationDefinition } from "./kit/define"
export type {
	ConfigField,
	FieldMapping,
	IntegrationPresentation,
	KeyValueListField,
	NumberField,
	ProviderPermission,
	SettingsFields,
	StringListField,
} from "./kit/presentation"
export * from "./registry"
