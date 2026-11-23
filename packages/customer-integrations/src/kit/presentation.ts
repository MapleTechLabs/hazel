/**
 * What the Customers pages say and show about an integration (`docs/customers/integrations.md`).
 * Plain data, so it is browser-safe. `PresentationOf<C>` checks that each field names a key of the
 * integration's config `C`; the registry reads the wider `IntegrationPresentation`.
 */

type KeysOf<C, V> = {
	[K in keyof C]: K extends "_tag" ? never : C[K] extends V ? K : never
}[keyof C] &
	string

type RowKeysOf<C> = {
	[K in keyof C]: C[K] extends ReadonlyArray<infer Row>
		? Row extends string
			? never
			: keyof Row & string
		: never
}[keyof C]

/** A boolean, text or one-of field of the config, shown in the connect form and the settings. */
export type ConfigField<ToggleKey extends string = string, TextKey extends string = string> =
	| Readonly<{
			_tag: "Toggle"
			key: ToggleKey
			label: string
			description: string
	  }>
	| Readonly<{
			_tag: "Text"
			key: TextKey
			label: string
			description: string
			placeholder: string
			/** Shown in a monospace input (ids, keys). */
			isCode: boolean
	  }>
	| Readonly<{
			_tag: "Select"
			key: TextKey
			label: string
			description: string
			/** The field's own values; the config's schema refuses anything else. */
			options: ReadonlyArray<Readonly<{ value: string; label: string }>>
	  }>

/** A list of strings: chips, and a field that adds one. Saved trimmed, blanks dropped. */
export interface StringListField<Key extends string = string> {
	readonly key: Key
	readonly title: string
	readonly description: string
	/** Shown while the list is empty. */
	readonly emptyText: string
	readonly placeholder: string
	/** The add field's accessible name. */
	readonly addLabel: string
}

export type KeyValueColumn<Key extends string = string> = Readonly<{
	key: Key
	label: string
	placeholder: string
}>

/** A list of rows of named strings, edited in columns. Saved trimmed; every cell is required. */
export interface KeyValueListField<Key extends string = string, ColumnKey extends string = string> {
	readonly key: Key
	readonly title: string
	readonly description: string
	/** Shown while the list is empty. */
	readonly emptyText: string
	readonly columns: readonly [KeyValueColumn<ColumnKey>, KeyValueColumn<ColumnKey>]
	/** One row, in "Add metric" and "Remove metric 2". */
	readonly itemNoun: string
	/** Under the rows. */
	readonly note: string
	/** Why the settings cannot be saved while a cell is blank. */
	readonly incompleteProblem: string
}

/** A number picked from fixed options. A stored value outside them shows the default as selected. */
export interface NumberField<Key extends string = string> {
	readonly key: Key
	readonly title: string
	readonly description: string
	/** The picker's accessible name. */
	readonly ariaLabel: string
	readonly options: ReadonlyArray<Readonly<{ value: number; label: string }>>
	/** After the value where it is read-only: "90 days". */
	readonly unit: string
}

/** The settings beyond `configFields`, shown only on the source's settings card, in this order. */
export interface SettingsFields<
	ListKey extends string = string,
	RowsKey extends string = string,
	ColumnKey extends string = string,
	NumberKey extends string = string,
> {
	readonly stringList?: StringListField<ListKey>
	readonly keyValueList?: KeyValueListField<RowsKey, ColumnKey>
	readonly number?: NumberField<NumberKey>
}

/** One permission the API key needs, e.g. `Invoices: Read`. */
export interface ProviderPermission {
	readonly resource: string
	readonly access: string
}

/** A row of the source detail's field mapping preview. */
export interface FieldMapping {
	readonly from: string
	readonly to: string
}

export interface IntegrationPresentation {
	readonly name: string
	/** What the tool calls an account record, singular: "organization", "customer". */
	readonly accountNoun: string
	/** Brandfetch domain for the logo. */
	readonly domain: string
	/** The hosts its record and invoice links may point to (`*.` takes any subdomain). */
	readonly linkHosts: ReadonlyArray<string>
	/** One line under the name. */
	readonly blurb: string
	/** What it brings, in a line, on the first-run setup. */
	readonly setupSummary: string
	/** Chips on the source card: what it writes. */
	readonly provides: ReadonlyArray<string>
	/** The not-connected card's "Adds to the model" list. */
	readonly adds: ReadonlyArray<Readonly<{ title: string; detail: string }>>
	/** The connect modal's subtitle: what Hazel reads, and that it never writes. */
	readonly accessNote: string
	/** While false the pages show "Coming soon". */
	readonly isAvailable: boolean
	readonly apiKey: Readonly<{
		label: string
		placeholder: string
		/** Where to create the key. */
		createHref: string
		help: string
	}>
	/** The key's required scopes; the connect modal lists them. */
	readonly permissions: ReadonlyArray<ProviderPermission>
	/** Null: no webhooks (pulled on a schedule only). */
	readonly webhook: Readonly<{
		/** Where in the provider to add the endpoint. */
		instructions: string
		/** Event types to subscribe. */
		events: ReadonlyArray<string>
		secretLabel: string
		secretPlaceholder: string
	}> | null
	/** "Webhooks + hourly sync", "Scheduled pull · hourly". */
	readonly syncMode: string
	/** The connect form's matching / identity options, in order. */
	readonly configFields: ReadonlyArray<ConfigField>
	readonly settings?: SettingsFields
	/** The source detail's mapping preview, grouped. */
	readonly mapping: ReadonlyArray<Readonly<{ group: string; fields: ReadonlyArray<FieldMapping> }>>
	readonly docsHref: string
	/** Link to a record in the provider's dashboard. */
	readonly dashboardHref: string
	/** The id records join an account by, as the tool names it; absent when it does not join by one. */
	readonly sharedIdLabel?: string
	/** The first-run suggestion: where to start, or which billing source to add. */
	readonly suggested?: "start" | "billing"
	/** How its activity reads ("sign-ins"); a lower `usageRank` is named first for usage. */
	readonly activityLabel?: Readonly<{ noun: string; usageRank: number }>
	/** What an admin must know to use impersonation with this tool. */
	readonly impersonationNote?: string
}

/** A presentation whose fields are checked against the integration's config. */
export type PresentationOf<C> = Omit<IntegrationPresentation, "configFields" | "settings"> & {
	readonly configFields: ReadonlyArray<ConfigField<KeysOf<C, boolean>, KeysOf<C, string>>>
	readonly settings?: SettingsFields<
		KeysOf<C, ReadonlyArray<string>>,
		KeysOf<C, ReadonlyArray<Readonly<Record<string, string>>>>,
		RowKeysOf<C>,
		KeysOf<C, number>
	>
}
