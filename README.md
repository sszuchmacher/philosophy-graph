# Philosophy as a network — chronological map of philosophers

**▶ Live site: [sszuchmacher.github.io/philosophy-graph](https://sszuchmacher.github.io/philosophy-graph/)**

A mobile-first, chronologically-organized map of Western philosophy:

- **Time runs left to right.** A node's horizontal position is its midlife year.
- **Each horizontal lane is a school of thought.** Schools are ordered roughly chronologically (Pre-Socratics on top, contemporary feminism near the bottom).
- **Each circle is a philosopher**, colored by school.
- **Lines connect philosophers who argued with one another** — six kinds of relation: continuation, critique, reinterpretation, radicalization, inversion, diagnosis.
- **Tap any circle** for that philosopher's card — including a tappable **connections list** ("looks back to" / "taken up by"), a signature quote, and look-up links. **Tap any line** (or a connection in the card) to read how they connected — **every one of the 260 relations has a full ~350-word essay** (about 91,000 words in all) explaining the philosophical link, rendered inline.
- **Follow a guided trail.** The **Trails** button opens 13 curated journeys — *The Death of God*, *The Social Contract*, *Everything Flows*, *One Is Not Born a Woman*… Each trail walks one theme chronologically through 4–6 connections: the path lights up on the map, each stop opens the essay framed by a trail note, and your place is saved so you can resume or complete trails over time.
- **Add your own philosophers** with the ＋ button. They're generated, previewed (with proposed connections you can toggle), added live to the map, and saved in your browser. Export them as JSON to merge into the repo.
- A **century axis** (vertical gridlines + year labels) makes "time flows left to right" legible.
- **Everything is a link.** Every philosopher, every essay, and every trail stop has its own URL (`#/p/kant`, `#/r/kant-hume`, `#/t/death-of-god/3`) — open a card or an essay and the 🔗 button next to the close button shares or copies that exact view. Opening a shared link jumps straight there (and skips the welcome overlay). The back button retraces your steps through the graph.
- **Installable.** Add it to your phone's home screen for a full-screen app icon, and it keeps working offline once you've visited (a small service worker caches the app and its data).

121 philosophers, 260 relations, 21 schools — plus whatever you add.

## Running it

The site loads its data over HTTP, so it needs a local server:

```bash
cd grafo-filosofos
python3 serve.py
# open http://localhost:8123
```

## Mobile-first design

- **Topbar**: hamburger (left) opens the drawer, theme toggle (right).
- **Drawer**: relation-type filters + school index ("tap to jump" pans the graph to that school's lane; the eye icon toggles its visibility).
- **Side panel** (desktop) becomes a **bottom sheet** (mobile) with a grip handle and a backdrop.
- **Zoom controls** bottom-right: + / − / fit-to-screen.
- **Lane labels** on the left (desktop only) — they stick to the screen and follow the lanes as you pan.

On a phone the lanes panel hides (recovered via the drawer's school list), the inline search collapses into a topbar search button that opens the drawer, and the panel and add-sheet slide up from the bottom (with a grip you can swipe down to dismiss). Safe-area insets keep controls clear of notches.

## Adding a philosopher (and the LLM seam)

The ＋ button opens a sheet: type a name → **Generate** → preview the node and its proposed connections (toggle any off) → **Add to map**. The node is positioned by its era/school, the graph pans to it, and it's persisted to `localStorage`. The drawer's **Export** button downloads `philograph-additions.json` (your additions only) to merge into `data/`.

The generator currently returns **placeholder data** (a working demo). The real Claude call is written out in comments at the `=== LLM INTEGRATION POINT ===` in [`scripts/generator.js`](scripts/generator.js): `generate()` is already `async`, so wiring a real request (structured tool-use output, the existing roster in a cached system block, model `claude-sonnet-4-6`) is a localized change. Use the `claude-api` skill when implementing it. Because a static page can't safely hold an API key, that step also needs either a serverless proxy or a bring-your-own-key field — see the comments.

## Interaction model

- **Default view**: all 121 philosophers visible at low contrast — you see the shape of philosophical history.
- **Tap a node**: that philosopher and its direct neighbors light up; everything else dims to a faint trace. Panel opens.
- **Tap an edge**: both endpoints light up; panel opens with the relation's summary and (if present) full essay.
- **Tap the background**: clears highlight, closes the panel.
- **Zoom in past ~0.42**: all node labels appear. Below that, only highlighted labels show — so the graph stays readable at any scale.

## Deep links & sharing

`scripts/router.js` keeps the URL hash in sync with whatever the panel is showing, so every view is a real, bookmarkable/shareable link:

| Route | Opens |
|---|---|
| `#/p/<id>` | A philosopher's card (e.g. `#/p/kant`) |
| `#/r/<id>` | A relation's essay (e.g. `#/r/kant-hume`) |
| `#/t/<trailId>/<step>` | A specific stop in a guided trail (e.g. `#/t/death-of-god/3`) |

Opening the panel pushes a history entry (so the back button retraces your path through the graph); closing it — by the × button, Escape, swipe-down, or tapping the background — drops back to the home route, unless a trail is active, in which case it just closes the panel and leaves you on that trail stop. Loading the app on a specific route skips the first-visit welcome overlay and jumps straight there; an unresolvable link (e.g. an old/mistyped id) falls back to the normal welcome screen instead of failing silently.

The 🔗 button next to the panel's close button shares the current URL — the native share sheet on mobile (Messages, WhatsApp, etc. via the Web Share API), or a clipboard copy elsewhere, with a small toast confirming it.

## Installing as an app (PWA)

`manifest.webmanifest` + `sw.js` make the site installable. On iPhone: Safari → Share → **Add to Home Screen** gives it a standalone icon and window (no browser chrome). The service worker uses a stale-while-revalidate cache — the app shell and data JSON are cached on first visit, served instantly (and offline) afterward, and refreshed from the network in the background on every visit so the next load picks up whatever changed. Bump `CACHE_VERSION` in `sw.js` after a deploy that needs to force a clean cache.

## Data model

```jsonc
// philosophers.json — one object per philosopher
{
  "id": "kant",
  "name": "Immanuel Kant",
  "dates": "1724–1804",
  "school": "german-idealism",
  "tradition": "Transcendental idealism / Enlightenment",
  "region": "Königsberg, Prussia",
  "central_ideas": ["…"],
  "key_works": ["…"],
  "short_description": "…"
}

// relations.json — one object per directed edge
{
  "id": "kant-hume",
  "source": "kant",
  "target": "hume",
  "type": "continuacion",
  "bridge": "Response to empiricist skepticism",
  "title": "Kant and the awakening from dogmatic slumber",
  "summary": "Hume had argued that …",        // always shown
  "essay": "content/essays/kant-hume.md",     // optional full essay
  "quotes": [{ "text": "…", "source": "…" }]
}
```

Edge direction: from the later philosopher to the earlier one. Relations are interpretive; the graph encodes one defensible reading, not the only one.

## Structure

```
grafo-filosofos/
├── index.html               # topbar, drawer, panel, lanes, welcome, error
├── manifest.webmanifest     # PWA metadata (name, icons, theme color)
├── sw.js                    # service worker: stale-while-revalidate cache
├── styles/main.css          # theme variables, mobile-first responsive layout
├── scripts/
│   ├── graph.js             # chronological + school-lane layout, addPhilosopher, time helpers
│   ├── panel.js             # philosopher card (connections list) + relation/essay view
│   ├── search.js            # drawer content: filters, school index, export button
│   ├── generator.js         # generate a philosopher (stub now; real-Claude seam inside)
│   ├── store.js             # localStorage persistence + JSON export of additions
│   ├── trails.js            # guided trails: sheet, trail bar, progress, walking logic
│   ├── router.js            # hash-based deep links (#/p/, #/r/, #/t/) + browser history
│   ├── toast.js             # tiny transient message ("Link copied")
│   └── app.js               # data merge, theme, drawer, zoom, lane labels, century axis, add-flow
├── data/
│   ├── philosophers.json    # 121 philosophers
│   ├── relations.json       # 260 relations
│   └── trails.json          # 13 curated guided trails (68 stops)
├── content/essays/          # 260 full essays, one per relation (~91k words)
├── assets/
│   ├── icons/                # app icon (SVG source + PNG sizes for favicon/PWA/home screen)
│   └── social-card.png       # Open Graph / Twitter card image (1200×630)
└── serve.py                 # static server on port 8123
```

## Adding content

- **A philosopher**: append to `philosophers.json` with a unique `id`, a valid `school` (or add a new one in the CSS palette under `:root` + dark theme), and parseable `dates` (the chronological position is computed from this field).
- **A relation**: append to `relations.json` with `source`/`target` ids that exist; always include a `summary`. Optional `essay` path → drop the `.md` under `content/essays/`.

## Layout tuning

Three constants at the top of `scripts/graph.js` control the look:

- `LANE_HEIGHT` — vertical spacing between school lanes (130 px).
- `X_SCALE` — horizontal pixels per year (4.5).
- `JITTER` — sub-row offsets within a lane to spread philosophers of similar dates.

The label-show zoom threshold is also tuneable (`syncLabels` uses `0.42`).

## Known trade-offs

- **The X axis is linear**: antiquity is sparse, modernity is dense. A piecewise scale would even out the visual rhythm but distort time.
- **Edges across many lanes** look chaotic at low opacity by design — they become readable only when a node is selected.
- **Wittgenstein → Wittgenstein** stays as a self-loop. Modeling it as two nodes ("early" / "late") remains a defensible alternative.
