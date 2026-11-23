/** The browser-safe entry: definitions and registry lookups, no adapter code. */
export type { DemoRole, DemoScope, IntegrationDemo } from "./kit/demo"
export type { IngestPolicy, IntegrationCapabilities, IntegrationDefinition } from "./kit/define"
export type {
	ConfigField,
	FieldMapping,
	IntegrationPresentation,
	KeyValueListField,
	NumberField,
	ProviderPermission,
	SettingsField,
	SettingsFields,
	StringListField,
} from "./kit/presentation"
export * from "./registry"
