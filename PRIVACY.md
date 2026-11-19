# Privacy — poe2ultra

poe2ultra is a local fork of poe2perfect with optional guide and selection translation. The upstream statement that no data leaves mobalytics.gg no longer describes this fork.

## Data sent when translating

Opening a guide or changing its display language does not trigger translation API requests. Clicking Start translation sends uncached, normalized guide text, matching terminology, and configured prompts to the configured API endpoint (api.deepseek.com by default). Both Chinese versions are generated together. Custom endpoints require access permission; the configured API key and extra headers are sent to that selected endpoint, so these values must match the service you intend to use.

Selection translation sends the selected text and page context (title, URL and declared language), configured prompts and terminology when triggered by the floating button, Alt+Q or context menu. Automatic selection translation is off by default; enabling it makes selecting text trigger a request. Loading a page alone does not trigger a selection translation request. The connection-test button sends a sample sentence through the same translation and terminology services. These requests can incur provider charges.

When enabled, missing terms are looked up on poe2db.tw. Optional Tavily fallback sends a terminology query (which may include a short excerpt of guide text) and the Tavily key to api.tavily.com. The bundled glossary and exact-name translations run locally. The guide author identity, browsing history, unrelated page UI, advertisements, and comments are not collected by the translation planner.

## Local storage

API keys, prompts, options, imported glossaries and display preferences are stored in the extension's local browser storage, not account sync. Guide translation pairs are stored in the extension's IndexedDB and have no automatic expiration. Selection results are displayed in the page panel and do not use the persistent guide cache. Terminology lookup modules retain their original bounded caches. There is no developer server, analytics, or cloud translation-cache sync. Error diagnostics can show short excerpts of a malformed model response locally; they are not uploaded to a developer service.

Translation settings lets you clear the guide cache and individual terminology caches. Deleting a key and saving removes the saved credential. Uninstalling the extension or clearing its data removes the local cache and configuration. Browser profiles have separate storage. Guide translations are looked up by a SHA-256 hash of the source text; each record also stores a hash of the translation settings used to create it. If settings or terminology change, an existing translation for the same source remains visible and is not automatically regenerated. Manually retranslating a block replaces its saved translation with one produced using the current settings. Changing panel appearance, display language or cost-estimation rates does not change either hash.

## Optional Debug mode

Debug mode is off by default and records subsequent full-guide translation batches in a separate extension-origin IndexedDB database. It stores complete source text, prompts and terminology context, the actual API request, decoded HTTP/SSE response, model output and any reasoning returned by the provider, progress events, validation failures and cache-write counts. It retains the most recent 500 batches; older records are deleted. Interrupted streams may contain only the part received and saved so far.

Known API keys, authentication headers and credential-bearing fields are redacted before persistence and debug console output. Logs still contain full guide text and user-provided prompts. Viewing and exporting logs are local operations; exports are JSON files downloaded by the user and are not uploaded automatically. Turning off Debug stops recording future runs but does not delete existing logs. Clearing debug records does not clear translations. Debug mode does not invalidate translation caches, replay cached requests or trigger paid retries.

## Permissions and hosts

- `storage`: local settings and terminology caches.
- `unlimitedStorage`: persistent translations without a small fixed extension quota.
- `contextMenus`: the Translate selected text menu item.
- `scripting` and `activeTab`: inject the selection script on demand after a shortcut/menu action in an already-open page.
- Content script on mobalytics.gg and www.mobalytics.gg: original build parsing and focused reading interface.
- Selection content script on HTTP/HTTPS pages: detect the user's selection and display the translation panel; it receives display preferences, not API credentials. Restricted browser pages are not supported.
- Optional HTTP/HTTPS host access: a custom API endpoint selected in settings. Permission is requested when the user saves or tests that endpoint, not for background autosave.
- api.deepseek.com: user-requested translation.
- poe2db.tw: optional direct terminology lookup.
- api.tavily.com: optional terminology search.

Guide content and game assets remain the property of their respective owners. This extension is unofficial and is not affiliated with Mobalytics or Grinding Gear Games.
