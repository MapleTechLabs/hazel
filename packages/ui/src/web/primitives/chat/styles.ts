/**
 * The chat leaves' renderer-owned CSS (C3 `rendererFeatures`): layout inside a leaf, hover reveals,
 * motion, focus rings. Every value is a token variable; the recipes say the same for codegen and Swift.
 */

const color = (name: string) => `var(--hz-color-${name})`
const space = (step: string) => `var(--hz-space-${step.replace(".", "_")})`
const radius = (name: string) => `var(--hz-radius-${name})`
const type = (step: string) =>
	`font-size: var(--hz-text-${step}-size); line-height: var(--hz-text-${step}-leading);`
const STRONG = "font-weight: var(--hz-weight-strong);"
// Today's author, thread and card titles are semibold; `**bold**` runs are bold (`chat-weights`).
const SEMIBOLD = "font-weight: var(--hz-weight-semibold);"
const BOLD = "font-weight: var(--hz-weight-bold);"

const M = '[data-hz="message"]'
const TIP = '[data-hz="tooltip"] > [data-hz-part="bubble"]'
const p = (name: string) => `[data-hz-part="${name}"]`
/** Parts the message shares with the standalone tags. */
const inChat = (tags: ReadonlyArray<string>, name: string) =>
	`:is(${tags.map((tag) => `[data-hz="${tag}"]`).join(", ")}) ${p(name)}`
const reactions = (name: string) => inChat(["message", "reactionBar"], name)
const files = (name: string) => inChat(["message", "attachmentGrid"], name)
const cards = (name: string) => inChat(["message", "embed"], name)
const G = '[data-hz="attachmentGrid"]'
/** A token colour at `percent` over transparent (today's `bg-secondary/30`, `bg-black/60`). */
const tint = (token: string, percent: number) => `color-mix(in oklab, ${token} ${percent}%, transparent)`
const BLACK = "var(--hz-palette-black)"
const WHITE = "var(--hz-palette-white)"

// Today's `max-w-md` (28rem) and `max-w-lg` (32rem) column caps, and the 300px media cap.
const COLUMN = `calc(${space("14")} * 8)`
const THREAD_COLUMN = `calc(${space("8")} * 16)`
const MEDIA_HEIGHT = `calc(${space("10")} * 7.5)`
/** A mosaic row: whole pixels, so the rows below stay on the pixel grid. */
const TILE = `calc(${space("10")} * 4)`

const rules: ReadonlyArray<readonly [string, string]> = [
	// The row (`messageBodyView`): `group relative flex flex-col rounded-lg px-0.5 py-1`, `mt-2` on a group start.
	[
		M,
		`position: relative; display: flex; flex-direction: column; padding: ${space("1")} ${space("0.5")};
		margin-top: ${space("2")}; border-radius: ${radius("lg")}; color: ${color("fg")}; ${type("body")}
		text-align: left; cursor: default; outline: none;`,
	],
	// HAZEL-GAP(message-text-size): today's row is `text-base` (16/24) at every size class; `body`
	// is 14/20 at regular, so a regular row takes `title`'s metrics (16/24) until a role says so.
	["@media (width >= 40rem)", `${M} { ${type("title")} }`],
	[`${M}[data-grouped]`, "margin-top: 0;"],
	[`${M}:hover, ${M}:focus-visible`, `background-color: ${color("secondary")};`],
	[`${M}:focus-visible`, `box-shadow: 0 0 0 2px ${color("ring")};`],
	[`${M}[data-highlighted]`, `background-color: ${color("primary-subtle")};`],
	// Today's pinned row: `bg-warning/10`, `/15` under the pointer (`chat-tints`).
	[
		`${M}[data-pinned]`,
		`border-left: ${space("1")} solid ${color("warning")}; border-radius: 0 ${radius("lg")} ${radius("lg")} 0;
		padding-left: ${space("2")}; background-color: ${color("warning-tint")}; box-shadow: var(--hz-shadow-xs);`,
	],
	[`${M}[data-pinned]:is(:hover, :focus-visible)`, `background-color: ${color("warning-tint-hover")};`],
	[`${M}[data-pending] > ${p("main")}`, "opacity: 0.6;"],

	// Avatar column and content (`relative flex gap-4`).
	[`${M} > ${p("main")}`, `position: relative; display: flex; column-gap: ${space("4")};`],
	[
		`${M} ${p("avatar")}`,
		`flex-shrink: 0; align-self: flex-start; cursor: pointer; border-radius: ${radius("xl")};`,
	],
	[
		`${M} :is(${p("avatarImage")}, ${p("replyAvatar")}, ${p("threadAvatar")})`,
		`display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;
		width: ${space("10")}; height: ${space("10")}; border-radius: ${radius("xl")}; corner-shape: squircle;
		background-color: ${color("muted")}; color: ${color("muted-fg")}; ${type("caption")} ${STRONG}`,
	],
	[
		`${M} :is(${p("replyAvatar")}, ${p("threadAvatar")})`,
		`width: ${space("4")}; height: ${space("4")}; border-radius: ${radius("sm")}; ${type("micro")}`,
	],
	[`${M} ${p("avatarImage")} > img`, "width: 100%; height: 100%; object-fit: cover;"],
	// A seeded avatar: today's dither under one white initial, sized to the box (`avatar-seed-tint`).
	[
		`${M} [data-seeded]:is(${p("avatarImage")}, ${p("replyAvatar")}, ${p("threadAvatar")})`,
		"position: relative; container-type: size; overflow: visible;",
	],
	[`${M} [data-seeded] > ${p("dither")}`, "corner-shape: squircle;"],
	[
		`${M} [data-seeded] > ${p("initials")}`,
		`position: relative; color: white; font-weight: var(--hz-weight-semibold); font-size: 46cqw; line-height: 1; text-box: trim-both cap alphabetic;`,
	],
	[
		`${M} ${p("gutterTime")}`,
		`display: flex; flex-shrink: 0; align-items: center; justify-content: flex-end; width: ${space("10")};
		padding-right: ${space("1")}; color: ${color("muted-fg")}; ${type("micro")} opacity: 0;`,
	],
	[`${M}:is(:hover, :focus-within) ${p("gutterTime")}`, "opacity: 1;"],
	[`${M} ${p("body")}`, "min-width: 0; flex: 1 1 0%;"],
	// Discord's spine from the avatar into the thread card's middle.
	[
		`${M} ${p("spine")}`,
		`position: absolute; pointer-events: none; top: ${space("12")}; bottom: 28px; left: 19px; width: 31px;
		border-left: 2px solid ${color("border")}; border-bottom: 2px solid ${color("border")};
		border-bottom-left-radius: ${radius("xl")};`,
	],

	// Header (`headerView`): `flex items-baseline gap-2`, wrapping on a phone.
	[`${M} ${p("header")}`, `display: flex; align-items: baseline; column-gap: ${space("2")};`],
	["@media (width < 48rem)", `${M} ${p("header")} { flex-wrap: wrap; }`],
	[`${M} ${p("author")}`, `${SEMIBOLD} color: ${color("fg")}; cursor: pointer; overflow-wrap: anywhere;`],
	[`${M} ${p("author")}:hover`, "text-decoration: underline;"],
	[`${M} ${p("status")}`, type("label")],
	[
		`${M} ${p("provider")}`,
		`display: inline-flex; align-self: center; flex-shrink: 0; width: ${space("3.5")}; height: ${space("3.5")};`,
	],
	[`${M} ${p("header")} > [data-hz="badge"]`, "align-self: center;"],
	[`${M} ${p("time")}`, `color: ${color("muted-fg")}; ${type("caption")}`],
	[
		`${M} ${p("pinnedLabel")}`,
		`display: flex; align-items: center; column-gap: ${space("1")}; color: ${color("warning")}; ${type("caption")}`,
	],
	[`${M} ${p("pinnedLabel")} > ${p("icon")}`, `width: ${space("3")}; height: ${space("3")};`],

	// Rich text (`markdownView`).
	[`${M} ${p("text")}`, "white-space: pre-wrap; overflow-wrap: break-word;"],
	[`${M} ${p("text")}[data-emoji-only]`, type("display")],
	[
		`${M} ${p("mention")}`,
		`display: inline-block; padding: ${space("0.5")} ${space("1")}; border-radius: ${radius("sm")};
		background-color: ${color("primary-tint")}; color: ${color("primary")}; ${STRONG} cursor: pointer;`,
	],
	[`${M} ${p("mention")}:hover`, `background-color: ${color("primary-tint-hover")};`],
	[`${M} ${p("link")}`, `color: ${color("primary")}; text-decoration: underline; cursor: pointer;`],
	[
		`${M} ${p("inlineCode")}`,
		`padding: ${space("0.5")} ${space("1")}; border-radius: ${radius("sm")}; background-color: ${color("muted")};
		font-family: var(--hz-font-mono); font-size: var(--hz-text-code-size);`,
	],
	[`${M} ${p("strong")}`, BOLD],
	[`${M} ${p("emphasis")}`, "font-style: italic;"],
	[`${M} ${p("strike")}`, "text-decoration: line-through;"],
	[
		`${M} ${p("quote")}`,
		`position: relative; margin-block: ${space("1")}; padding-left: ${space("4")}; font-style: italic;`,
	],
	[
		`${M} ${p("quote")}::before`,
		`content: ""; position: absolute; inset-block: 0; left: 0; width: ${space("1")};
		border-radius: ${radius("xs")}; background-color: ${color("primary")};`,
	],
	[`${M} ${p("listItem")}`, `display: flex; column-gap: ${space("1.5")}; padding-left: ${space("1")};`],
	[`${M} ${p("marker")}`, `flex-shrink: 0; color: ${color("muted-fg")};`],
	[`${M} ${p("codeBlock")}`, `position: relative; margin-block: ${space("2")};`],
	[
		`${M} ${p("code")}`,
		`overflow-x: auto; white-space: pre-wrap; padding: ${space("4")}; border-radius: ${radius("lg")};
		background-color: ${color("muted")}; font-family: var(--hz-font-mono); ${type("code")}`,
	],
	[`${M} ${p("codeBlock")}:has(${p("language")}) > ${p("code")}`, `padding-right: ${space("14")};`],
	// Today's corner: `absolute top-2 right-2 z-10 flex items-center gap-2`, the copy button `pr-24`.
	[
		`${M} ${p("codeControls")}`,
		`position: absolute; z-index: 1; top: ${space("2")}; right: ${space("2")}; display: flex;
		align-items: center; column-gap: ${space("2")};`,
	],
	[`${M} ${p("codeBlock")}:has(${p("copyCode")}) > ${p("code")}`, `padding-right: ${space("24")};`],
	[
		"@media (width < 48rem)",
		`${M} ${p("codeBlock")}:has(${p("copyCode")}) > ${p("code")} { padding-right: ${space("4")}; }
		${M} ${p("codeBlock")}:has(${p("copyCode")}):has(${p("language")}) > ${p("code")} { padding-top: ${space("10")}; }`,
	],
	[
		`${M} ${p("copyCode")}`,
		`display: flex; padding: ${space("1.5")}; border-radius: ${radius("sm")}; color: ${color("fg")};
		background-color: ${tint(color("fg"), 10)}; cursor: pointer; opacity: 0;
		transition: opacity var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${M} ${p("copyCode")}:hover`, `background-color: ${tint(color("fg"), 20)};`],
	[`${M} ${p("codeBlock")}:hover ${p("copyCode")}, ${M} ${p("copyCode")}:focus-visible`, "opacity: 1;"],
	[`${M} ${p("copyCode")} > ${p("icon")}`, `width: ${space("3.5")}; height: ${space("3.5")};`],

	// Reactions (`reactionButton`).
	[
		`${M} > ${p("main")} ${p("reactions")}, [data-hz="reactionBar"]`,
		`display: flex; flex-wrap: wrap; gap: ${space("1")};`,
	],
	[`${M} ${p("reactions")}`, `margin-top: ${space("2")};`],
	[
		`${reactions("reaction")}, ${reactions("addReaction")}`,
		`display: inline-flex; align-items: center; column-gap: ${space("1")}; white-space: nowrap; cursor: pointer;
		padding: ${space("0.5")} ${space("2.5")}; border-radius: ${radius("full")}; ${type("label")} ${STRONG}
		background-color: ${color("secondary")}; color: ${color("fg")}; box-shadow: inset 0 0 0 1px ${color("border")};
		user-select: none; transition: background-color var(--hz-duration-fast) var(--hz-ease-out),
		scale var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[
		`${reactions("reaction")}:hover, ${reactions("addReaction")}:hover`,
		`background-color: ${color("muted")};`,
	],
	[`${reactions("reaction")}:active, ${reactions("addReaction")}:active`, "scale: 0.95;"],
	[
		`${reactions("reaction")}[data-mine]`,
		`background-color: ${color("primary-tint")}; color: ${color("primary")};
		box-shadow: inset 0 0 0 1px ${color("primary-tint-ring")};`,
	],
	[`${reactions("reaction")}[data-mine]:hover`, `background-color: ${color("primary-tint-hover")};`],
	[
		`${reactions("countBox")}`,
		"display: inline-flex; overflow: hidden; font-variant-numeric: tabular-nums;",
	],
	[`${reactions("count")}`, "display: inline-block;"],
	[`${reactions("emojiImage")}`, `width: ${space("5")}; height: ${space("5")}; object-fit: contain;`],
	[`${reactions("addReaction")}`, `color: ${color("muted-fg")}; padding-inline: ${space("2")};`],
	[`${reactions("addReaction")} > ${p("icon")}`, `width: ${space("4")}; height: ${space("4")};`],

	// Attachments (`attachmentsView`): a mosaic, then a column of file cards.
	[
		`${M} ${p("attachments")}, [data-hz="attachmentGrid"]`,
		`display: flex; flex-direction: column; row-gap: ${space("2")};`,
	],
	[`${M} ${p("attachments")}`, `margin-top: ${space("2")};`],
	[
		files("mosaic"),
		`display: grid; gap: ${space("1")}; max-width: ${COLUMN}; grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-auto-rows: ${TILE};`,
	],
	[`${files("mosaic")}[data-count="1"]`, "display: flex; grid-auto-rows: auto;"],
	[`${files("mosaic")}[data-count="3"] > :first-child`, "grid-row: span 2;"],
	[`${files("cell")}`, "position: relative; display: flex; min-width: 0;"],
	[`${files("cell")} > *`, "flex: 1 1 0%; min-width: 0;"],
	[
		files("media"),
		`position: relative; display: block; overflow: hidden; width: 100%; height: 100%; max-width: 100%;
		border-radius: ${radius("lg")}; background-color: ${color("muted")}; cursor: pointer;`,
	],
	[`${files("mosaic")}[data-count="1"] ${p("media")}:not([style])`, `height: ${TILE};`],
	[`${files("mosaic")}[data-count="1"] ${p("cell")}`, "flex: 0 1 auto;"],
	[`${files("media")} > ${p("image")}`, "display: block; width: 100%; height: 100%; object-fit: cover;"],
	[
		files("play"),
		`position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
		color: ${color("primary-fg")}; ${type("title")}`,
	],
	[
		`${files("files")}`,
		`display: flex; flex-direction: column; row-gap: ${space("2")}; max-width: ${COLUMN};`,
	],
	[
		files("file"),
		`position: relative; display: flex; align-items: center; column-gap: ${space("3")}; width: 100%; overflow: hidden;
		padding: ${space("3")}; border: 1px solid ${color("border")}; border-radius: ${radius("lg")};
		background-color: ${color("bg")}; box-shadow: var(--hz-shadow-xs); cursor: pointer;
		transition: background-color var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${files("file")}[data-hz-part]:hover`, `background-color: ${color("muted")};`],
	[
		`${files("fileIcon")}`,
		`flex-shrink: 0; width: ${space("8")}; height: ${space("8")}; color: ${color("muted-fg")};`,
	],
	[`${files("fileInfo")}`, "display: flex; flex-direction: column; flex: 1 1 0%; min-width: 0;"],
	[
		files("fileName"),
		`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${color("fg")}; ${type("label")} ${STRONG}`,
	],
	[files("fileSize"), `color: ${color("muted-fg")}; ${type("caption")}`],
	[
		files("fileAction"),
		`flex-shrink: 0; width: ${space("4")}; height: ${space("4")}; color: ${color("muted-fg")}; opacity: 0;`,
	],
	[`${files("file")}:is(:hover, :focus-visible) ${p("fileAction")}`, "opacity: 1;"],
	[
		files("progress"),
		`position: absolute; left: 0; right: 0; bottom: 0; height: ${space("1")}; background-color: ${color("wash-strong")};`,
	],
	[files("progressFill"), `display: block; height: 100%; background-color: ${color("primary")};`],
	[
		files("remove"),
		`position: absolute; top: ${space("1")}; right: ${space("1")}; display: flex; align-items: center;
		justify-content: center; width: ${space("6")}; height: ${space("6")}; border-radius: ${radius("full")};
		background-color: ${color("bg")}; color: ${color("fg")}; box-shadow: var(--hz-shadow-xs); cursor: pointer;`,
	],
	[`${files("remove")} > ${p("icon")}`, `width: ${space("3.5")}; height: ${space("3.5")};`],
	// A failed upload (phase 4): the tile tints and says so; with `retry` a press retries it.
	[`${files("media")}[data-failed]`, `background-color: ${color("warning-tint")};`],
	[
		`:is(${files("media")}, ${G} ${p("tile")}) > ${p("failure")}`,
		`position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
		justify-content: center; row-gap: ${space("1")}; padding: ${space("2")}; text-align: center;`,
	],
	[
		files("failure"),
		`display: flex; align-items: center; column-gap: ${space("1")}; color: ${color("warning")}; ${type("caption")}`,
	],
	[
		`${files("failure")} > ${p("icon")}`,
		`flex-shrink: 0; width: ${space("3.5")}; height: ${space("3.5")};`,
	],
	[files("retryLabel"), `${STRONG} color: ${color("primary")};`],
	[`:is(${files("file")}, ${G} ${p("row")})[data-failed]`, `border-color: ${color("warning")};`],
	[`${files("file")}[data-failed] ${p("fileIcon")}`, `color: ${color("warning")};`],

	// The files page (phase 4, `media-view.ts`): a square grid, masonry columns, a list of rows.
	[
		`${G} > ${p("tiles")}`,
		`display: grid; gap: ${space("2")}; grid-template-columns: repeat(2, minmax(0, 1fr));`,
	],
	[`${G} > ${p("masonry")}`, `columns: 1; column-gap: ${space("3")};`],
	[`${G} > ${p("masonry")} > *`, `break-inside: avoid; margin-bottom: ${space("2")};`],
	[`${G} > ${p("rows")}`, `display: flex; flex-direction: column; row-gap: ${space("2")};`],
	[
		"@media (width >= 40rem)",
		`${G} > ${p("tiles")} { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		${G} > ${p("masonry")} { columns: 2; }`,
	],
	[
		"@media (width >= 64rem)",
		`${G} > ${p("tiles")} { grid-template-columns: repeat(4, minmax(0, 1fr)); }
		${G} > ${p("masonry")} { columns: 3; }`,
	],
	[
		"@media (width >= 80rem)",
		`${G} > ${p("tiles")} { grid-template-columns: repeat(5, minmax(0, 1fr)); }
		${G} > ${p("masonry")} { columns: 4; }`,
	],
	[
		`${G} ${p("tile")}`,
		`position: relative; display: block; width: 100%; overflow: hidden; border-radius: ${radius("lg")};
		background-color: ${color("muted")}; cursor: pointer;`,
	],
	// `aspect-square rounded-lg border border-border bg-secondary/30 hover:border-muted-fg/50`.
	[
		`${G} > ${p("tiles")} ${p("tile")}`,
		`aspect-ratio: 1; border: 1px solid ${color("border")}; background-color: ${tint(color("secondary"), 30)};
		transition: border-color var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${G} > ${p("tiles")} ${p("tile")}:hover`, `border-color: ${tint(color("muted-fg"), 50)};`],
	[`${G} > ${p("masonry")} ${p("tile")}:not([style])`, "aspect-ratio: 4 / 3;"],
	[`${G} ${p("tile")}[data-failed]`, `background-color: ${color("warning-tint")};`],
	[`${G} > ${p("tiles")} ${p("tile")}[data-failed]`, `border-color: ${tint(color("warning"), 50)};`],
	[`${G} ${p("tile")} > ${p("image")}`, "display: block; width: 100%; height: 100%; object-fit: cover;"],
	[`${G} > ${p("masonry")} ${p("tile")}:not([style]) > ${p("image")}`, "height: auto;"],
	[
		`${G} ${p("tileEmpty")}`,
		`position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
		justify-content: center; row-gap: ${space("2")}; padding: ${space("3")}; color: ${color("muted-fg")};`,
	],
	[`${G} ${p("tileIcon")}`, `width: ${space("8")}; height: ${space("8")};`],
	[
		`${G} ${p("tileName")}`,
		`max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${color("fg")};
		${type("caption")}`,
	],
	// Today's `size-12 rounded-full bg-black/60` badge round a white `size-6` play icon.
	[
		`${G} ${p("playBadge")}`,
		`position: absolute; top: 50%; left: 50%; display: flex; align-items: center; justify-content: center;
		width: ${space("12")}; height: ${space("12")}; border-radius: ${radius("full")}; transform: translate(-50%, -50%);
		background-color: ${tint(BLACK, 60)}; color: ${WHITE}; pointer-events: none;`,
	],
	[
		`${G} ${p("playBadge")} > ${p("icon")}`,
		`width: ${space("6")}; height: ${space("6")}; margin-left: ${space("0.5")};`,
	],
	[
		`${G} ${p("duration")}`,
		`position: absolute; left: ${space("2")}; bottom: ${space("2")}; padding: ${space("0.5")} ${space("1.5")};
		border-radius: ${radius("sm")}; background-color: ${tint(BLACK, 60)}; color: ${WHITE};
		font-variant-numeric: tabular-nums; pointer-events: none; ${type("caption")}`,
	],
	// `documentItem`: `flex items-center gap-3 rounded-lg border bg-secondary/30 p-3 hover:bg-secondary/60`.
	[
		`${G} ${p("row")}`,
		`position: relative; display: flex; align-items: center; column-gap: ${space("3")}; width: 100%;
		overflow: hidden; padding: ${space("3")}; border: 1px solid ${color("border")}; border-radius: ${radius("lg")};
		background-color: ${tint(color("secondary"), 30)}; text-align: left; cursor: pointer;
		transition: background-color var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${G} ${p("row")}:hover`, `background-color: ${tint(color("secondary"), 60)};`],
	[
		`${G} ${p("rowIcon")}`,
		`flex-shrink: 0; width: ${space("10")}; height: ${space("10")}; color: ${color("muted-fg")};`,
	],
	[`${G} ${p("row")}[data-failed] ${p("rowIcon")}`, `color: ${color("warning")};`],
	[`${G} ${p("row")}:is(:hover, :focus-visible) ${p("fileAction")}`, "opacity: 1;"],
	["@media (width < 48rem)", `${G} ${p("row")} ${p("fileAction")} { opacity: 1; }`],
	[`${G} ${p("rowIcon")}[data-file-type] > svg`, "display: block; width: 100%; height: 100%;"],
	// The size and time (`flex items-center gap-2 text-muted-fg text-xs`).
	[`${G} ${p("row")} ${p("fileSize")}`, `display: flex; align-items: center; column-gap: ${space("2")};`],
	// The uploader (`flex gap-2`, an `xs` avatar, the name `text-xs` from `sm` up).
	[
		`${G} ${p("uploader")}`,
		`display: flex; flex-shrink: 0; align-items: center; column-gap: ${space("2")}; color: ${color("muted-fg")};
		${type("caption")}`,
	],
	[
		`${G} ${p("uploaderAvatar")}`,
		`position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
		width: ${space("6")}; height: ${space("6")}; overflow: hidden; border-radius: ${radius("md")};
		corner-shape: squircle; outline: 0.5px solid ${color("overlay-border")}; outline-offset: -0.5px;
		background-color: ${color("muted")};`,
	],
	[`${G} ${p("uploaderAvatar")} > ${p("image")}`, "width: 100%; height: 100%; object-fit: cover;"],
	[`${G} ${p("uploaderAvatar")}[data-seeded]`, "container-type: size; overflow: visible;"],
	[`${G} ${p("uploaderAvatar")} > ${p("dither")}`, "corner-shape: squircle;"],
	[
		`${G} ${p("uploaderAvatar")} > ${p("initials")}`,
		`position: relative; color: ${WHITE}; ${SEMIBOLD} font-size: 46cqw; line-height: 1; text-box: trim-both cap alphabetic;`,
	],
	["@media (width < 40rem)", `${G} ${p("uploaderName")} { display: none; }`],
	// The row's own download (`plain sq-sm`), shown on hover or focus, always on a phone.
	[
		`${G} ${p("download")}`,
		`display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: ${space("8")};
		height: ${space("8")}; border-radius: ${radius("md")}; color: ${color("muted-fg")}; cursor: pointer;
		opacity: 0; transition: opacity var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${G} ${p("download")} > ${p("icon")}`, `width: ${space("4")}; height: ${space("4")};`],
	[
		`${G} ${p("row")} > ${p("download")}:hover`,
		`background-color: ${color("secondary")}; color: ${color("fg")};`,
	],
	[
		`${G} :is(${p("row")}:hover, ${p("row")}:focus-within, ${p("tile")}:hover, ${p("tile")}:focus-within) ${p("download")}`,
		"opacity: 1;",
	],
	["@media (width < 48rem)", `${G} ${p("row")} ${p("download")} { opacity: 1; }`],
	// A tile's download (`downloadOverlay`): a gradient from the bottom, the `secondary` button at the end.
	[
		`${G} ${p("tileActions")}`,
		`position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: flex-end;
		padding: ${space("2")}; background-image: linear-gradient(to top, ${tint(BLACK, 40)}, transparent);
		opacity: 0; pointer-events: none; transition: opacity var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	[`${G} ${p("tile")}:is(:hover, :focus-within) > ${p("tileActions")}`, "opacity: 1;"],
	[
		`${G} ${p("tileActions")} > ${p("download")}`,
		`opacity: 1; pointer-events: auto; border: 1px solid ${color("border")}; color: ${color("fg")};
		background-color: ${tint(color("bg"), 90)}; box-shadow: var(--hz-shadow-xs);`,
	],
	// "+N See all" over the last grid tile (`seeAllItem`): `bg-black/60`, `text-2xl` semibold over `text-sm`.
	[
		`${G} ${p("moreCover")}`,
		`position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
		justify-content: center; background-color: ${tint(BLACK, 60)}; color: ${WHITE};`,
	],
	[`${G} ${p("moreCount")}`, `${type("display")} ${SEMIBOLD} letter-spacing: normal;`],
	[`${G} ${p("moreLabel")}`, `${type("label")} color: ${tint(WHITE, 80)};`],

	// Link cards (`linkPreviewView`).
	[`${M} ${p("card")}`, `margin-top: ${space("2")};`],
	[
		cards("card"),
		`display: block; overflow: hidden; max-width: ${COLUMN}; border: 1px solid ${color("border")};
		border-radius: ${radius("lg")}; background-color: ${color("wash")}; color: ${color("fg")}; cursor: pointer;`,
	],
	[`${cards("card")}:hover`, `background-color: ${color("muted")};`],
	[cards("cardText"), `display: flex; flex-direction: column; min-width: 0; padding: ${space("3")};`],
	[
		cards("title"),
		`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${type("label")} ${SEMIBOLD}`,
	],
	[
		cards("description"),
		`margin-top: ${space("0.5")}; color: ${color("fg-3")}; ${type("caption")} display: -webkit-box;
		-webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`,
	],
	[cards("site"), `margin-top: ${space("1")}; color: ${color("accent-fg")}; ${type("micro")}`],
	[cards("cardMedia"), `display: block; padding: 0 ${space("3")} ${space("3")};`],
	[
		`${cards("cardMedia")} > ${p("image")}`,
		`display: block; max-width: 100%; max-height: ${MEDIA_HEIGHT}; border-radius: ${radius("md")};`,
	],

	// Thread card (`threadPreviewView`).
	[
		`${M} ${p("thread")}`,
		`display: flex; flex-direction: column; justify-content: center; row-gap: ${space("0.5")}; width: 100%;
		max-width: ${THREAD_COLUMN}; height: 58px; margin-top: ${space("2")}; padding-inline: ${space("3")};
		border: 1px solid ${color("border")}; border-radius: ${radius("lg")}; background-color: ${color("secondary-band")};
		${type("label")} cursor: pointer; user-select: none;
		transition: background-color var(--hz-duration-fast) var(--hz-ease-out);`,
	],
	// Out-ranks the recipe's part chain (`message > main > body > thread`) once it is generated.
	[`${M} > ${p("main")} > ${p("body")} > ${p("thread")}:hover`, `background-color: ${color("secondary")};`],
	[
		`${M} :is(${p("threadTop")}, ${p("threadLast")})`,
		`display: flex; align-items: center; min-width: 0; column-gap: ${space("1.5")};`,
	],
	[`${M} ${p("threadTop")}:has(${p("threadName")})`, `column-gap: ${space("2")};`],
	[
		`${M} ${p("threadName")}`,
		`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${SEMIBOLD} color: ${color("fg")};`,
	],
	[
		`${M} ${p("threadCount")}`,
		`display: flex; flex-shrink: 0; align-items: center; column-gap: ${space("0.5")}; ${STRONG} color: ${color("primary")};`,
	],
	[`${M} ${p("thread")}:hover ${p("threadCount")}`, "text-decoration: underline;"],
	[
		`${M} ${p("threadCount")} > ${p("icon")}`,
		`width: ${space("3.5")}; height: ${space("3.5")}; color: ${color("primary")};`,
	],
	// Today's `text-fg/85`: the default ink a little quieter than the card's name.
	[
		`${M} ${p("threadAuthor")}`,
		`flex-shrink: 0; ${STRONG} color: color-mix(in oklab, ${color("fg")} 85%, transparent);`,
	],
	[
		`${M} ${p("threadPreview")}`,
		`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${color("muted-fg")};`,
	],
	[
		`${M} ${p("threadTime")}`,
		`flex-shrink: 0; margin-left: ${space("1")}; color: ${color("muted-fg")}; ${type("caption")}`,
	],

	// Reply (`replySectionView`): the curve, then the quoted author and first line.
	[`${M} > ${p("reply")}`, `position: relative; margin-bottom: ${space("1")};`],
	[
		`${M} ${p("replyCurve")}`,
		`position: absolute; left: 21px; bottom: -3px; width: 22px; height: 10px; pointer-events: none;
		border-left: 2px solid ${color("muted-fg")}; border-top: 2px solid ${color("muted-fg")};
		border-top-left-radius: ${radius("md")};`,
	],
	[
		`${M} ${p("replyLine")}`,
		`display: flex; align-items: center; min-width: 0; max-width: 100%; column-gap: ${space("1.5")};
		padding-left: ${space("12")}; ${type("label")} cursor: pointer; border-radius: ${radius("sm")};`,
	],
	[`${M} ${p("replyAuthor")}`, `flex-shrink: 0; ${STRONG} color: ${color("fg")};`],
	[
		`${M} ${p("replyText")}`,
		`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${color("muted-fg")};`,
	],
	[`${M} ${p("replyLine")}:hover ${p("replyText")}`, `color: ${color("fg")};`],

	// A failed send.
	[
		`${M} ${p("failure")}`,
		`display: flex; align-items: center; column-gap: ${space("1.5")}; margin-top: ${space("1")};
		color: ${color("danger-subtle-fg")}; ${type("caption")}`,
	],
	[`${M} ${p("failure")} > ${p("icon")}`, `width: ${space("3.5")}; height: ${space("3.5")};`],
	[`${M} ${p("retry")}`, `${STRONG} text-decoration: underline; cursor: pointer;`],

	// The hover toolbar (`toolbar.ts`), shown on hover or keyboard focus inside the row.
	[
		`${M} > ${p("toolbar")}`,
		`position: absolute; z-index: 1; top: calc(${space("4")} * -1); right: ${space("4")}; display: flex;
		align-items: center; column-gap: ${space("0.5")}; padding: ${space("0.5")};
		border: 1px solid ${color("border")}; border-radius: ${radius("lg")}; background-color: ${color("bg")};
		box-shadow: var(--hz-shadow-xs); opacity: 0; pointer-events: none;
		transition: opacity var(--hz-duration-micro) var(--hz-ease-out);`,
	],
	[
		`${M}:is(:hover, :focus-within, [data-more-open]) > ${p("toolbar")}`,
		"opacity: 1; pointer-events: auto;",
	],
	[`${M}[data-more-open] ${p("tool")}[data-action="more"]`, `background-color: ${color("secondary")};`],
	[
		`${M} :is(${p("quick")}, ${p("tool")})`,
		`display: flex; align-items: center; justify-content: center; width: ${space("7")}; height: ${space("7")};
		border-radius: ${radius("md")}; color: ${color("fg-3")}; cursor: pointer; ${type("body")}`,
	],
	[
		`${M} :is(${p("quick")}, ${p("tool")}):hover`,
		`background-color: ${color("secondary")}; color: ${color("fg")};`,
	],
	[`${M} ${p("tool")}[data-action="delete"]`, `color: ${color("danger")};`],
	[`${M} ${p("tool")}[data-action="delete"]:hover`, `background-color: ${color("danger-subtle")};`],
	[`${M} ${p("tool")} > ${p("icon")}`, `width: ${space("3.5")}; height: ${space("3.5")};`],
	[
		`${M} > ${p("toolbar")} > ${p("separator")}`,
		`width: 1px; height: ${space("4")}; margin-inline: ${space("0.5")}; background-color: ${color("border")};`,
	],

	// The chat's tooltips (`tooltip-host.ts`): the kit's default panel, `rounded-lg border px-2.5 py-1
	// text-xs/5 shadow-md`, in the `tooltip` recipe's bubble; reactions lay out `gap-3 px-3 py-2`.
	[
		`${TIP}:is([data-look="panel"], [data-look="reaction"])`,
		`max-width: calc(${space("24")} * 4); padding: ${space("1")} ${space("2.5")}; border: 1px solid ${color("overlay-border")};
		border-radius: ${radius("lg")}; background-color: ${color("overlay")}; color: ${color("overlay-fg")};
		box-shadow: var(--hz-shadow-md); font-size: var(--hz-text-caption-size); line-height: ${space("5")};
		font-weight: normal; white-space: normal;`,
	],
	[
		`${TIP}[data-look="reaction"]`,
		`display: flex; align-items: center; column-gap: ${space("3")}; padding: ${space("2")} ${space("3")};`,
	],
	// Today's `text-3xl` emoji (30/36) and `size-7` custom emoji over a `text-sm` line.
	[
		`${TIP} > ${p("tipEmoji")}`,
		`font-size: calc(var(--hz-text-display-size) * 1.25); line-height: ${space("9")};`,
	],
	[`${TIP} > ${p("tipEmojiImage")}`, `width: ${space("7")}; height: ${space("7")}; object-fit: contain;`],
	[`${TIP} > ${p("tipText")}`, type("label")],

	// The right-click menu's quick reactions (`contextMenuHeader`): `flex gap-1 px-1 py-1`, `sq-md` buttons.
	[
		`${M} ${p("menuQuick")}`,
		`display: flex; align-items: center; column-gap: ${space("1")}; padding: ${space("1")};
		border-bottom: 1px solid ${color("border")};`,
	],
	// Each emoji is today's `text-lg`: 18px over the 16px title step.
	[
		`${M} ${p("menuQuick")} > ${p("item")}`,
		`display: flex; align-items: center; justify-content: center; width: ${space("9")}; height: ${space("9")};
		padding: ${space("1")}; border-radius: ${radius("md")}; cursor: pointer; outline: none;
		font-size: calc(var(--hz-text-title-size) * 1.125);`,
	],
	[
		`${M} ${p("menuQuick")} > ${p("item")}:is(:hover, [data-highlighted])`,
		`background-color: ${color("secondary")};`,
	],

	// Typing (`typingIndicatorView`): `flex h-3 items-center gap-2 text-muted-fg text-xs`.
	[
		'[data-hz="typingIndicator"]',
		`display: flex; align-items: center; column-gap: ${space("2")}; min-height: ${space("3")};
		color: ${color("muted-fg")}; ${type("caption")}`,
	],
	[`[data-hz="typingIndicator"] ${p("dots")}`, `display: flex; column-gap: ${space("1")};`],
	[
		`[data-hz="typingIndicator"] ${p("dot")}`,
		`display: inline-block; width: ${space("1.5")}; height: ${space("1.5")}; border-radius: ${radius("full")};
		background-color: ${color("muted-fg")};`,
	],

	// Focus rings on every control inside the leaves.
	[
		`:is(${M}, [data-hz="reactionBar"], [data-hz="attachmentGrid"], [data-hz="embed"]) :is(button, a):focus-visible`,
		`outline: 2px solid ${color("ring")}; outline-offset: 1px;`,
	],
]

export const chatCss = rules
	.map(([selector, body]) => `${selector} {\n\t${body.replace(/\s+/g, " ")}\n}`)
	.join("\n")
