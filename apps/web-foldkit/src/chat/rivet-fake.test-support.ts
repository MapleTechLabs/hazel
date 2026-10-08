/** A fake `~/lib/rivet-client`: connections open at once and stream one text chunk each. */

const connects: Array<string> = []
const disposed: Array<string> = []

export const rivet = { connects, disposed, brokenConnect: new Set<string>(), brokenState: new Set<string>() }

export const getAccessToken = async (): Promise<string | null> => "token"

const connectionOf = (id: string) => ({
	onOpen: (handler: () => void) => queueMicrotask(handler),
	getState: (): Promise<unknown> =>
		rivet.brokenState.has(id) ? Promise.reject(new Error("state")) : Promise.resolve(null),
	on: (name: string, handler: (payload: unknown) => void) => {
		if (name === "textChunk") setTimeout(() => handler({ fullText: `hi ${id}` }), 5)
	},
	dispose: async () => {
		rivet.disposed.push(id)
	},
})

export const rivetClient = {
	message: {
		getOrCreate: ([id = ""]: ReadonlyArray<string>, _options: unknown) => ({
			connect: () => {
				if (rivet.brokenConnect.has(id)) throw new Error("actor unavailable")
				rivet.connects.push(id)
				return connectionOf(id)
			},
		}),
	},
}
