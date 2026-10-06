import { Context, Layer } from "effect"

/** The single Electric instance's Durable Object name. Electric owns one replication slot. */
export const ELECTRIC_INSTANCE_NAME = "electric"

/**
 * The slice of a `DurableObjectNamespace` the proxy uses. Structural, so this module needs neither
 * the Workers nor the Bun ambient types.
 */
export interface ElectricNamespace {
	readonly getByName: (name: string) => {
		readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	}
}

/** Where shape requests go: the Electric container's Durable Object, or a plain URL. */
export interface ElectricUpstreamShape {
	readonly kind: "durable-object" | "url" | "unconfigured"
	/** Base URL shape requests are built on (`<base>/v1/shape`). */
	readonly baseUrl: string
	/** Query params Electric authenticates with (`secret`; Electric Cloud's `source_id`). */
	readonly authParams: Readonly<Record<string, string>>
	/** Sends one shape request upstream. The response body is passed through unread. */
	readonly fetch: (url: string) => Promise<Response>
}

export class ElectricUpstream extends Context.Service<ElectricUpstream, ElectricUpstreamShape>()(
	"ElectricUpstream",
) {
	/** A plain Electric URL: docker Electric in dev, or Electric Cloud from the legacy Bun entry. */
	static readonly layerUrl = (options: {
		readonly baseUrl: string
		readonly authParams?: Readonly<Record<string, string>>
	}): Layer.Layer<ElectricUpstream> =>
		Layer.succeed(this, {
			kind: "url",
			baseUrl: options.baseUrl.replace(/\/+$/, ""),
			authParams: options.authParams ?? {},
			fetch: (url) => fetch(url),
		})

	/**
	 * The self-hosted Electric container, through its Durable Object. The host is a placeholder:
	 * the container class forwards every request to Electric's port whatever the URL's host.
	 */
	static readonly layerDurableObject = (
		namespace: ElectricNamespace,
		authParams: Readonly<Record<string, string>> = {},
	): Layer.Layer<ElectricUpstream> =>
		Layer.succeed(this, {
			kind: "durable-object",
			baseUrl: "http://electric",
			authParams,
			fetch: (url) => namespace.getByName(ELECTRIC_INSTANCE_NAME).fetch(url),
		})

	/**
	 * No Electric for this deployment (PR previews): every shape request answers 503, and the
	 * web app falls back to its non-synced reads.
	 */
	static readonly layerUnconfigured: Layer.Layer<ElectricUpstream> = Layer.succeed(this, {
		kind: "unconfigured",
		baseUrl: "http://electric.invalid",
		authParams: {},
		fetch: () =>
			Promise.resolve(
				new Response(JSON.stringify({ error: "Electric is not configured for this deployment" }), {
					status: 503,
					headers: { "Content-Type": "application/json" },
				}),
			),
	})
}
