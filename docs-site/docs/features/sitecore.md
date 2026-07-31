# Sitecore Schema Validation

Validate the JSS field names in your Sitecore components against the schema of a **real Layout Service response** — so typos and renamed fields are caught in review instead of at runtime.

Point the extension at your Sitecore Experience Edge endpoint, and it learns which fields each component actually has. During a review, every `fields.Headline`-style access in your diff is checked against that schema, with spelling suggestions for near-misses.

## Setup

The feature is off by default. Enable it:

```json
{
  "ollama-code-review.sitecore": {
    "enabled": true
  }
}
```

### Zero-config credential detection

If you already have a JSS app configured, there is nothing else to set. The extension reads your environment files in this order:

1. `.env.local`
2. `.env.development.local`
3. `.env`
4. `.env.development`

and looks for these variables (the first match in each row wins):

| What | Variables recognized |
|------|----------------------|
| API key | `SITECORE_API_KEY`, `SITECORE_EDGE_API_KEY`, `NEXT_PUBLIC_SITECORE_API_KEY` |
| GraphQL endpoint | `GRAPH_QL_ENDPOINT`, `SITECORE_EDGE_URL`, `GRAPHQL_ENDPOINT`, `SITECORE_GRAPHQL_ENDPOINT` |
| Site name | `SITECORE_SITE_NAME`, `NEXT_PUBLIC_SITECORE_SITE_NAME`, `JSS_APP_NAME` (defaults to `website`) |

Both an API key and an endpoint must be found. To override detection — or to point at a different environment — set `graphqlEndpoint`, `apiKey`, and `siteName` in your settings; those always take priority.

:::note
Your API key is only ever used to call Experience Edge. It is never written to the schema cache file and never passed to the Schema Explorer webview.
:::

## Schema Explorer

The best way to build a useful schema is the interactive explorer:

**Command Palette → `Ollama Code Review: Explore Sitecore Schema`**

1. Confirm the detected endpoint and site name at the top of the panel
2. Pick a route — click the route box and **search by name, path, or template** (see below), or type a path and click **Fetch**
3. Browse the discovered **placeholders** — click one to filter the component list
4. Search or click a component to see its field table
5. Save the result for use in reviews

### Searching for a route

You don't need to remember exact paths. Click the route box (or the **Browse** button) and the explorer loads the site's route list, then filters it as you type:

```
Route: [ hero                          ]  Browse  Fetch
       ┌──────────────────────────────────────────┐
       │ /campaigns/hero-test        Landing Page │
       │ /news/2024/hero-awards           Article │
       └──────────────────────────────────────────┘
       47 route(s) available — type to search.
```

- Matches on **path**, **page name**, and **template name** — so typing `Landing Page` lists every landing page, and typing `team` finds `/about/team`
- Ranked so the closest path match comes first, shortest path winning ties
- <kbd>↓</kbd>/<kbd>↑</kbd> to move, <kbd>Enter</kbd> to fetch the highlighted route, <kbd>Esc</kbd> to dismiss
- **Enter with nothing highlighted fetches exactly what you typed**, so unpublished routes and anything discovery missed stay reachable

The route list is fetched once per session and filtered locally, so typing never hits your endpoint. **Browse** forces a refresh if content changed while the panel was open.

:::note
Route discovery uses Experience Edge's `search` query, scoped to your site's content subtree. If your endpoint's schema doesn't support it, the panel says so in a status line and free-text entry keeps working exactly as before — nothing breaks.

Route paths and page names are held for the panel session only and are never written to `.sitecore/schema-cache.json`. When your API key has preview access, the list can include unpublished pages.
:::

### Seeing the real JSON

The field table shows each field's **shape** — the actual Layout Service value structure with content stripped:

| Field Name | Type | Shape |
|---|---|---|
| `Hero` | Image | `{value:{src:str,alt:str,width:str,height:str}}` |
| `Cta` | General Link | `{value:{href:str,text:str,linktype:str,…}}` |

**Click any field row** to expand the raw JSON exactly as Experience Edge returned it, with long strings truncated:

```json
{
  "value": {
    "src": "https://edge.sitecorecloud.io/-/media/Project/hero.jpg?h=800&w=1200",
    "alt": "Hero",
    "width": "1200",
    "height": "800"
  }
}
```

This matters when the inferred **Type** column says `unknown` — a shape like `{value:{foo:str,nested:{…}}}` tells you what the value really is, where the type label tells you nothing. It also surfaces things the type hides: that `width` arrives as the *string* `"1200"`, and that a link's label key is `text`, not `label`.

:::note
Raw values are held for the Explorer session only and are never written to `.sitecore/schema-cache.json` — real content can include unpublished copy, customer names, and signed media URLs. The **shape** contains no content, so it *is* persisted and is what reviews use. Child-item fields show a shape but no raw sample.
:::

### Fetching several routes

Each fetch **accumulates** into the same in-memory schema. Fetch `/`, then `/products`, then a landing page, and the explorer builds a broader picture than any single route could — components discovered on one route are merged with fields discovered on another. Route search makes this practical: filter by template to walk every landing page in turn.

This matters because of how the Layout Service works (see [Coverage & limits](#coverage--limits)).

### Saving

| Button | What it writes |
|--------|----------------|
| **Save Schema** | Every component discovered so far |
| **Use Selected for Validation** | Only the components you ticked |

Both write to `.sitecore/schema-cache.json` (configurable via `localSchemaPath`). Commit this file to share the schema with your team and to keep reviews working offline.

### Copy as TypeScript

With a component selected, **Copy as TypeScript** puts a ready-to-paste interface on your clipboard, typed against the real JSS exports:

```ts
// Auto-generated from Sitecore Layout Service — Ticker
// Discovered on: /
// Adjust the import path if you use a different JSS flavour (…-jss-react, …-jss-vue).

import type { Field, LinkField, RichTextField } from '@sitecore-jss/sitecore-jss-nextjs';

export interface TickerFields {
  Headline: Field<string>;
  Body: RichTextField;
  Cta: LinkField;
}
```

Fields that were never observed with a value are emitted as optional (`Headline?:`).

Two other clipboard actions sit alongside it:

| Button | Copies |
|--------|--------|
| **Copy derived schema** | The extension's parsed schema for the component (names, types, shapes) |
| **Copy raw JSON** | Every raw Layout Service value for the component — ground truth |

## What gets checked in reviews

Once a schema is available, the review prompt gains a **Sitecore Layout Service Schema Validation** section containing the relevant component field tables, any mismatches found ahead of time, and instructions for the model.

### Field access patterns recognized

| Pattern | Example |
|---------|---------|
| JSS helper components | `<Text field={fields.Headline} />` |
| Dot access | `fields.Headline`, `fields?.Headline`, `props.fields.Headline` |
| Bracket access | `fields['Headline']` |
| Destructuring | `const { Headline, Body } = fields` |
| Child items | `box.fields.Image` |
| Registration | `register('BentoGrid', …)` |

The component a file belongs to is inferred from its filename — `src/components/L1Hero.tsx` is validated against the `L1Hero` schema. Accesses like `box.fields.Image` are checked against the **child template** fields derived from that component's Multilist/Treelist items, not its top-level fields.

### What the AI is asked to flag

- **Field existence** — a name absent from the schema is a HIGH severity finding, with the closest match suggested (within Levenshtein distance 3)
- **Casing** — Sitecore field names are PascalCase, so `fields.headline` is flagged in favour of `fields.Headline`
- **Sub-property access** — the shapes give the real value keys, so `fields.Hero.value.url` is flagged when the shape is `{value:{src:str,…}}`
- **Null safety** — fields not always populated should use optional chaining
- **Type alignment** (`validateFieldTypes`) — the helper is checked against the field's shape: `<Image>` needs `{value:{src,…}}`, `<Link>` needs `{value:{href,…}}`
- **Placeholder names** (`validatePlaceholders`) — `<Placeholder name="…">` values outside the known set

Findings are reported with a file and line reference, e.g.:

> **[HIGH] Sitecore Field Mismatch** (`src/components/L1Hero.tsx:42`): `fields.heding` does not exist on component `L1Hero`. Did you mean `Headline`?

### Prompt cost

Enabling this feature adds tokens to every review prompt, so the section is kept as small as the situation allows:

- **Nothing to report → nothing sent.** Field accesses are validated deterministically before the prompt is built. If every access checks out and there is no JSS helper or `<Placeholder>` for the model to look at, the section is omitted entirely (the output channel logs `prompt section skipped`).
- **Only fields in play get a full entry.** Fields the diff touches — plus any suggested near-match — are listed with their shape. The rest appear as a bare name list, roughly a sixth the cost, which still lets the model propose an alternative the Levenshtein cut-off missed.
- **Rules are conditional.** The type-alignment rule appears only when a JSS helper is present, the placeholder rule only when `<Placeholder` is, and so on.
- **Repeats collapse.** A field misspelled on five lines costs one bullet: `` `a.tsx:3, 4, 5` ``.
- **`maxComponents` truncates by suspicion**, not insertion order — components with mismatches survive the cut first.

In practice a clean review adds nothing, and a review with a real mismatch adds a few hundred tokens.

## Coverage & limits

Understanding one thing will save you confusion: **the Layout Service returns rendered content, not a template definition.** Schemas are therefore *inferred from what a sampled route actually returned*, which has two consequences.

**A field only appears if the route's datasource carried it.** If a component's optional `Subheadline` was empty on every route you fetched, it won't be in the schema.

**Validation is deliberately fail-open.** Rather than risk a confidently wrong "this field does not exist", the extension reports an access as valid whenever it cannot be sure. That happens when:

- the component name can't be inferred from the filename
- the component isn't in the schema (it's listed under *Unresolved Components* in the prompt instead)
- the relevant field list is empty

The practical takeaway: **fetch several representative routes** in the Schema Explorer before saving. The broader your sample, the more mismatches the review can actually catch.

Field types are inferred from the shape of each value — `{ src, alt }` → Image, `{ href, linktype }` → General Link, an HTML-looking string → Rich Text, and so on. An unrecognized shape becomes `unknown` and is simply not type-checked.

## Cache & invalidation

Schemas are cached in memory for `cacheTtlMinutes` (default 60), scoped to the workspace. The cache is invalidated when:

- you run **`Ollama Code Review: Reload Sitecore Schema Cache`**
- `.sitecore/schema-cache.json` is created, changed, or deleted

A failed fetch is never cached, so a brief network problem won't silence schema validation for the rest of the TTL.

## Schema sources

| `schemaSource` | Behaviour |
|----------------|-----------|
| `auto` (default) | Fetch the root route from Experience Edge; fall back to `.sitecore/schema-cache.json` if that fails |
| `graphql` | Experience Edge only — no local fallback |
| `local` | Read `.sitecore/schema-cache.json` only; never calls the network |

Use `local` in CI or offline, with a committed cache file built via the Schema Explorer.

:::tip
Automatic fetching only reads the **root route**. To cover more of your site, use the Schema Explorer to fetch each route you care about and save the accumulated result.
:::

## Commands

| Command | Description |
|---------|-------------|
| `Ollama Code Review: Explore Sitecore Schema` | Open the Schema Explorer to fetch, browse, and save component schemas |
| `Ollama Code Review: Reload Sitecore Schema Cache` | Clear the cache so the next review re-fetches |

## Settings

All keys live under the `ollama-code-review.sitecore` object.

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable Sitecore schema validation during reviews |
| `schemaSource` | `auto` | `auto`, `graphql`, or `local` |
| `envFile` | `.env.local` | Env file used for credential auto-detection |
| `graphqlEndpoint` | `""` | Experience Edge GraphQL endpoint (overrides detection) |
| `apiKey` | `""` | Sitecore API key (overrides detection) |
| `siteName` | `""` | Sitecore site name (overrides detection; defaults to `website`) |
| `localSchemaPath` | `.sitecore/schema-cache.json` | Local schema cache file, relative to the workspace root |
| `cacheTtlMinutes` | `60` | Minutes before the schema is re-fetched (5–1440) |
| `validateFieldTypes` | `true` | Check JSS helper components against field types |
| `validatePlaceholders` | `true` | Check `<Placeholder name="…">` values |
| `maxComponents` | `10` | Max component schemas to include in the review prompt (1–30) |

## Troubleshooting

Every failure path is non-fatal — the review still runs, just without the Sitecore section. Check the **Ollama Code Review** output channel for a `[Sitecore]` line explaining why.

| Message | Cause |
|---------|-------|
| `No GraphQL endpoint configured` | No API key + endpoint pair found in settings or any env file |
| `Authentication failed. Check your SITECORE_API_KEY.` | Edge returned 401/403 — key is wrong or lacks access |
| `Route "/x" not found.` | The route doesn't exist for this site and language |
| `No layout data returned` | The route resolved but has no renderings |
| `Local schema file not found` | `local` source with no cache file — build one in the Schema Explorer |

If reviews aren't flagging a field you know is wrong, the component most likely isn't in your schema yet, or the field wasn't populated on the routes you sampled. Open the Schema Explorer and confirm the component and field are listed.
