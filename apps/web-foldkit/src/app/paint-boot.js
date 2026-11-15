// The last screen's paint (`./paint.ts`), drawn before the app's script has loaded. Plain ES5 with no
// imports: a production build inlines it in `index.html` (`vite.config.ts`, `inlinePaintBoot`), where
// `hazelPaintBoot(window).read()` (the `export` dropped) runs in the head, and `.show()` then `.start(entry)` right after `#app`.
//
// The paint is shown only to the user it was taken for (the remembered user, `hazel:last-user`), on
// the page it was taken on, at the same layout (phone or not) and system theme. `/` resumes the
// painted page, as a reopened app does. What is shown is inert: a copy of markup the app drew, with
// anything that runs or loads a document removed, and no ids, so the live app never finds it.
export function hazelPaintBoot(win) {
	var KEY = "hazel:paint"
	var USER_KEY = "hazel:last-user"
	var VERSION = 1
	var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
	// The longest the paint stays up, from when it appears: whatever the app's script does, a slow
	// or failed load never leaves the page covered by an inert copy (`paint.ts`, `MAX_PAINT_MS`).
	var MAX_SHOWN_MS = 6000
	var DROP =
		"script,iframe,frame,frameset,object,embed,base,link,meta,noscript,template,dialog,video,audio," +
		'[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[popover],[data-paint-skip]'
	var URL_ATTRIBUTES = ["href", "src", "srcset", "action", "formaction", "xlink:href", "poster", "data"]
	var doc = win.document
	var paint = null
	var isShown = false

	var matches = function (query) {
		return !!(win.matchMedia && win.matchMedia(query).matches)
	}

	var read = function () {
		try {
			var stored = JSON.parse(win.localStorage.getItem(KEY) || "null")
			var user = JSON.parse(win.localStorage.getItem(USER_KEY) || "null")
			if (stored === null || user === null || stored.v !== VERSION) return null
			if (stored.userId !== user.id || typeof stored.html !== "string") return null
			// A page script, before the app exists: no update runs here.
			// oxlint-disable-next-line foldkit/no-impure-call-at-decision-time
			if (!(Date.now() - stored.savedAtMs < MAX_AGE_MS)) return null
			if (stored.isMobile !== matches("(max-width: 767px)")) return null
			if (stored.isSystemDark !== matches("(prefers-color-scheme: dark)")) return null
			var path = win.location.pathname
			if (path !== stored.path && path !== "/") return null
			return stored
		} catch (error) {
			return null
		}
	}

	var isUnsafeUrl = function (value) {
		var url = value.replace(/[\u0000- ]/g, "").toLowerCase()
		return (
			url.indexOf("javascript:") === 0 ||
			url.indexOf("vbscript:") === 0 ||
			url.indexOf("data:text/html") === 0
		)
	}

	/** Removes from `root` whatever could run, load a document, or be found by id. */
	var sanitize = function (root) {
		var dropped = root.querySelectorAll(DROP)
		for (var i = 0; i < dropped.length; i++)
			dropped[i].parentNode && dropped[i].parentNode.removeChild(dropped[i])
		var elements = root.querySelectorAll("*")
		for (var j = 0; j < elements.length; j++) {
			var element = elements[j]
			var names = []
			for (var k = 0; k < element.attributes.length; k++) names.push(element.attributes[k].name)
			for (var n = 0; n < names.length; n++) {
				var name = names[n].toLowerCase()
				var value = element.getAttribute(names[n]) || ""
				if (
					name.indexOf("on") === 0 ||
					name === "id" ||
					name === "srcdoc" ||
					name === "autofocus" ||
					name === "contenteditable" ||
					(URL_ATTRIBUTES.indexOf(name) !== -1 && isUnsafeUrl(value))
				)
					element.removeAttribute(names[n])
			}
		}
	}

	return {
		/** Reads the paint this page may show; on `/`, moves to the painted page first. */
		read: function () {
			paint = read()
			if (paint === null) return
			if (win.location.pathname !== paint.path)
				win.history.replaceState(
					win.history.state,
					"",
					paint.path + win.location.search + win.location.hash,
				)
			var root = doc.documentElement
			if (paint.theme === "light" || paint.theme === "dark") {
				root.classList.remove("light", "dark")
				root.classList.add(paint.theme)
			}
			if (typeof paint.rootStyle === "string") root.style.cssText = paint.rootStyle
		},
		/** Draws the paint over the page until the app has drawn the same screen (`handOffPaint`). */
		show: function () {
			if (paint === null || !doc.body) return
			try {
				var template = doc.createElement("template")
				template.innerHTML = paint.html
				sanitize(template.content)
				var host = doc.createElement("div")
				host.setAttribute("data-hazel-paint", "")
				host.setAttribute("inert", "")
				host.setAttribute("aria-hidden", "true")
				host.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow:hidden"
				host.appendChild(template.content)
				doc.body.appendChild(host)
				isShown = true
				win.setTimeout(function () {
					if (host.parentNode) host.parentNode.removeChild(host)
				}, MAX_SHOWN_MS)
				var scrolled = host.querySelectorAll("[data-paint-scroll]")
				for (var i = 0; i < scrolled.length; i++) {
					var offsets = scrolled[i].getAttribute("data-paint-scroll").split(" ")
					scrolled[i].scrollTop = Number(offsets[0]) || 0
					scrolled[i].scrollLeft = Number(offsets[1]) || 0
				}
			} catch (error) {
				var drawn = doc.querySelector("[data-hazel-paint]")
				if (drawn) drawn.parentNode.removeChild(drawn)
			}
		},
		/**
		 * Runs the app's script (`src`, preloaded by the head). Behind a paint, after the paint's first
		 * frame: a script the cache already holds would otherwise run before anything is drawn. A
		 * hidden page draws no frames, so it starts a moment later regardless.
		 */
		start: function (src) {
			var isStarted = false
			var run = function () {
				if (isStarted) return
				isStarted = true
				var script = doc.createElement("script")
				script.type = "module"
				script.crossOrigin = ""
				script.src = src
				doc.head.appendChild(script)
			}
			if (!isShown) return run()
			if (win.requestAnimationFrame)
				win.requestAnimationFrame(function () {
					win.setTimeout(run, 0)
				})
			win.setTimeout(run, 100)
		},
		sanitize: sanitize,
	}
}
