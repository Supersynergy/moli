# Live geometry for browser automation

The existing `--layout` mode publishes a screen layout on the first geometry demand and on explicit visual output. Later geometry reads retain that snapshot. Script mutations can therefore leave newly inserted nodes with zero dimensions until another publication.

Use live mode when automation needs current geometry after DOM, CSSOM or viewport changes:

```sh
moli serve --layout --live-layout
```

`MOLI_LIVE_LAYOUT=true` is the equivalent environment setting and still requires real layout. For an owned Superweb Moli session, its launcher already supplies `--layout`; the environment setting selects live geometry without changing Superweb's launch arguments:

```sh
MOLI_LIVE_LAYOUT=true MOLI_BIN=/path/to/tested/moli \
  superweb browser https://example.com --engine moli --profile live-layout
```

Live mode refreshes the shared layout tree when a geometry reader detects changed DOM, stylesheet, interaction, resource or viewport inputs. Consecutive reads with unchanged inputs reuse the published tree. It does not add a timer or background rendering loop. Mock and OnDemand retain their existing contracts. Print layouts remain separate from the published screen tree.

Run the focused local geometry oracle with an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core \
  node scripts/verify-live-layout.cjs --moli /path/to/moli --out /tmp/live-layout-proof
```

The fixture publishes an initial layout, then inserts a button and reads its JavaScript rect in the same evaluation. It also checks the CDP-backed DOM bounding box, style/CSSOM changes, viewport changes and same-origin child-frame geometry. Each failure is retained in `results.json`; startup and owned-process shutdown are bounded.

With `--snapshot` and `MOLI_LIVE_LAYOUT=false`, the same first two inputs expose the earlier frozen-snapshot behavior. This is an explicit compatibility mode comparison. It does not establish support for arbitrary sites, cross-origin application flows or browser standards compliance.
