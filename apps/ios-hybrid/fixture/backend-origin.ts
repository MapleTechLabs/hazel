/** Whether `url` is on the backend's origin: the session bearer goes nowhere else. */
export const isBackendUrl = (url: string, backendUrl: string) => {
	const backend = URL.parse(backendUrl)
	return backend !== null && URL.parse(url)?.origin === backend.origin
}
