# Changelog

## Unreleased

## 1.7.3

- Rebuild Simplified Chinese equipment trade links as `/trade2/search/poe2/<league>/<gzip-base64url query>` instead of replacing only the international site's hostname. Convert item names and supplied bases with the bundled/imported Simplified Chinese terminology while preserving rarity, stat IDs, numeric thresholds and other query filters.
- Match the verified Evergrasping Ring search with 永恒紧缩之戒 and 珠玉戒指. Add an editable China trade league in settings, defaulting to 周年庆巅峰挑战; English and Traditional Chinese retain the original links.
- Report missing name mappings or conversion errors on the trade icon instead of opening an empty search. Refresh links after league or glossary changes without requesting AI translations.

## 1.7.2

- Fix weapon rune details being blocked by an already open equipment detail card. Clicking or pressing Enter/Space on another detail trigger now switches the card; hover leaves it pinned and activating the same trigger again closes it.

## 1.7.1

- Use the China realm trade site (poe.game.qq.com/trade2) for equipment searches in Simplified Chinese, preserving the search path and query parameters. English and Traditional Chinese keep the international trade site.

## 1.7.0

- Let the site's tree receive Control keydown/keyup when guide navigation retains keyboard focus, restoring Ctrl+wheel after switching away from and back to tree tabs while keeping other guide keyboard events isolated.
- Keep browser page zoom suppressed within passive and atlas tree regions while forwarding Control key state; other guide shortcuts and text input remain isolated from the site.

## 1.6.7

- Restore per-line ellipsis for the original and translated build title so long bilingual headings do not stretch the narrow header.
- Keep the guide identity and summary readable on laptop widths; remove the repeated summary from the header when space is very limited.
- Keep guide tabs and translation controls on one row, with horizontally scrollable tabs when space is limited.
- Shorten language controls to 英 / 简 / 繁 and explain their regional translations on hover.
- Remove the compact build title when the header is collapsed and add a direct settings button beside the collapse/exit controls.
- Fix clicks on support gems and gem-priority buttons opening no details; retain gem-name copying and native keyboard activation.
- Prevent Ctrl+wheel over passive and atlas trees from zooming the browser page, including overlays and variant remounts, while allowing site wheel handlers to run.

## 1.6.6 — poe2ultra

- Move the guide language switch and circular cache progress indicator into the right side of the tab bar, separated from the guide tabs and next to the collapse/exit controls.
- Open a dismissible translation details card from the progress ring, including saved block counts, live batch progress, actions, current-run cost and cumulative guide cost.
- Persist one cost estimate receipt per model response in IndexedDB, including malformed responses with usage; include receipts in JSON backup/restore and deduplicate them on import.
- Preserve expense history when clearing translation text; old requests without recorded usage cannot be reconstructed.

## 1.6.5 — poe2ultra

- Keep the collapsed guide header compact: show only the selected language's title on one ellipsized line, with the full title available on hover.

## 1.6.4 — poe2ultra

- Localize the guide tabs and fixed skill and tooltip labels for Simplified and Traditional Chinese without sending UI text to DeepSeek.
- Increase the contrast of cached translations inside pinned detail cards, including implicit modifiers and flavour text.

## 1.6.3 — poe2ultra

- Show the estimated cost of each completed full-guide translation run, summing provider-reported token usage for valid and malformed responses.
- Continue later batches after an isolated malformed model response with or without Debug, leaving failed blocks uncached for manual retry; pause after three consecutive output failures.

## 1.6.2 — poe2ultra

- Export locally accumulated guide and completed dual-output selection translations as a three-column English/Simplified/Traditional Chinese CSV.
- Store the English source with new guide cache entries and fill it in for older entries when their guides are revisited, without another model request.
- Keep JSON cache backup and restore independent from the readable CSV export.

## 1.6.1 — poe2ultra

- Add local JSON backup and restore for all cached guide translations, including both Chinese versions and the parameters required to match existing cache keys.
- Restore imported terminology and guide cache parameters without exporting API keys or authentication headers; validate backups before merging and keep existing entries.
- Prevent a guide translation from starting during a cache transfer.

## 1.6.0 — poe2ultra

- Tooltips now open on click instead of hover, with keyboard Enter/Space toggle and Escape to close.

## 1.5.1 — poe2ultra

- Separate full-guide and selection prompts into their own files; send the requested guide system text without appended selection, glossary or formatting rules.
- Keep batch text, terminology, sources and the JSON return shape in guide user data; preserve both API transports and selection customization.
- Preserve existing paid guide caches when selection prompts change, and clarify the scope of prompt settings in the Chinese options page.

## 1.5.0 — poe2ultra

- Translate complete paragraphs as plain text, with no numeric markers or formatting-span alignment checks.
- Keep original guide text and formatting; display cached Simplified/Traditional Chinese translations below each block in light grey.
- Reuse previous span-based caches by joining their text, preserving paid work and debug logging.
- Keep source English names for skill-copy actions and retain selection translation.

## 1.4.2 — poe2ultra

- Add opt-in full-guide Debug mode with persistent records for the most recent 500 batches, a Chinese batch viewer, JSON export and independent log clearing.
- Record source segments, numeric protection and terminology context, the actual request body, decoded HTTP/SSE response, full model output, progress events, cache writes and failures. Redact credentials before storage and console output.
- Report the failing locale/block and expected versus actual span count/type, with a debug record ID. Include explicit span counts in model input while retaining strict validation and no automatic retries.
- Debug mode does not change translation cache keys or re-request cached text; logging storage failure does not interrupt translation.

## 1.4.1 — poe2ultra

- Add explicit POE2 localization expertise to every guide request, including existing saved prompts. Explain patch versions, stat units, regional terminology, and preservation of inline formatting boundaries.
- Explain numeric marker failures precisely: identify the affected value and span, distinguish missing/changed, duplicate, relocated and split markers, and show the relevant excerpt with recognized markers restored for readability.
- Retain strict validation and existing paid caches. Built-in domain guidance applies to missing translations without rewriting user settings or triggering automatic retries.

## 1.4.0 — poe2ultra

- Replace the basic options page with the Chinese configuration UI from Julian's poe2translator, including custom endpoints, request parameters, glossary import, diagnostics, prompts, panel preferences and cost estimates.
- Restore selection translation on ordinary web pages and inside the guide: floating button, Alt+Q and context menu, streamed independent Chinese versions, copy, stop and retry.
- Share settings and terminology between selection and full-guide translation. Preserve existing guide cache keys for unchanged settings; imported glossary snapshots and advanced translation parameters get separate cache profiles.
- Enable API JSON output mode for full-guide requests in both API protocols. Accept one complete JSON object surrounded by prose or fences while retaining all content validation. Report empty output, malformed JSON and truncation distinctly, without automatic paid retries.
- Update Chinese installation/use instructions and privacy documentation for the combined extension.

## 1.3.2 — poe2ultra

- Show saved progress as a percentage and bar, current batch and processing stage, streamed output character counts, and elapsed time.
- Protect numeric literals with visible markers during model translation and restore original values before validation; reject missing, duplicated or changed markers.
- Show Chinese validation errors with the failing locale and short source/translation excerpts. Keep existing cached translations and resume only missing work.

## 1.3.1 — poe2ultra

- Move the highlighted Start translation action next to the language switches instead of after the long counters.
- Explain that language switches display saved translations, and show clear guidance when the cache is empty or incomplete.
- Label cached blocks and remaining characters explicitly; use Chinese text for translation controls.
- Existing translation caches and settings are unchanged.

## 1.3.0

### Firefox
- poe2perfect is now a Firefox add-on as well, built from the same source as the Chrome extension: the same guide,
  the same tabs, the same preferences. Firefox 140 or newer.
- Loading a build could go on forever in Firefox, with the panel left on "Loading build…". The guide now gives the
  page's own storage and the site a limited time to answer, and falls back to reading the build from the page.

### Gear
- An item that grants many skills (one amulet grants seven) no longer stretches the whole gear grid: the card shows
  the first two and counts the rest, and the tooltip still lists them all.

### Pictures
- A picture the site does not give up — its CDN drops files now and then — leaves a stand-in shape instead of the
  browser's broken-image mark: armour, a weapon, a shield, jewellery, a flask, a charm, a gem, a passive or a rune,
  whichever belongs in that place. Names, modifiers and tooltips stay where they are.

### Also
- A new icon: a gothic medallion with the passive tree on it.

## 1.2.0

### Skills
- Clicking a gem — in Active Skills, in Gem Priority or in the skill details — copies its name, ready to paste
  into the game's own search. The panel says which name it took.
- A long skill name in Gem Priority ends in an ellipsis instead of reaching into the next column.

### Gear
- Item tooltips now show what the base item gives on its own — the resistance of a ring, the spirit of an amulet,
  the condition of a charm — above the rolled modifiers, as the game does. It was missing on every item that has one.

### Where a build opens
- A build opens again on the tab and at the act or stage you last read it at, remembered for each build on its own.
  A build you open for the first time starts on Overview, whatever you were reading elsewhere.
- When the author renames or rebuilds a variant, the guide finds the stage again by its name and otherwise opens
  the author's default. A link that names a tab or variant still wins, so shared links open what they point at.

### Loading
- A first visit to mobalytics.gg could fail with an HTTP 403: the site's bot protection turns away a browser it
  has not seen before. The guide now waits and asks again a few times, spends its last attempt on the visitor's
  own session, and says on screen that it is still trying instead of showing an error straight away.

## 1.1.0

### Passives and Atlas Tree
- The side panel is now called **Priority** and opens first: it shows the order in which to take the passives.
- Ascendancy passives are numbered in the order to take them.
- Point counts for the ascendancy and the atlas no longer include the free starting node, so they match the game.
- Hovering a passive in the Priority list highlights it on the tree; clicking it centres the tree on that node.

### Skills
- Hovering a gem in **Gem Priority** highlights it in **Active Skills**, so you can see which skill it belongs to.

### Gear
- The belt now sits in the left column with the helmet, body armour, gloves and boots.
- All three charm slots are always shown; empty ones appear as placeholders, so the layout stays the same across
  build variants.
- Every equipped item has a **trade** icon (scales) in the corner of its picture: it opens the official Path of
  Exile trade site with a search for that item.

### Overview
- A collapsed **At a Glance** panel now expands when you click anywhere on it.

## 1.0.0

First public release: a clean tabbed view of PoE 2 build guides on mobalytics.gg — Overview, Skills, Gear, Passives,
Atlas Tree and Progression.
