# Superweb browser parity checks

This local build uses upstream v1.1.19 at `bd0ddc3f8d8886f1bf339694ebdc89bfb4848efa` and retains the existing drag-interception and live-layout changes. SIGTERM, SIGINT and SIGHUP request shutdown through upstream's `BrowserInstanceControl`, sharing the profile flush and five-second shutdown budget with CDP `Browser.close`. Fetch and import retain the immediate termination handlers.

The lockfile preserves rustls 0.23.46 and applies compatible security updates identified by the current Cargo audit. The local browser is built from this source; source and binary hashes identify the patch set.

The drag changes preserve the native `DataTransfer` payload, publish `Input.dragIntercepted` when interception is enabled, support CDP drag replay and dispatch `dragend`. Superweb's monitor can subscribe to Moli's existing screencast and forward trusted pointer and keyboard input. Video encoding and the recording controls live in Superweb; Moli supplies the frames and input protocol.

## Reproduce the comparison

Use an existing installation of `playwright-core` and its Chromium browser:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core \
  node scripts/bench-superweb.cjs --moli /path/to/moli --engines moli,chromium \
  --require-fork --out /tmp/moli-parity
```

The script serves local fixtures and writes capability checks, three cold and three warm samples alongside screenshots and PDF files. It also retains Playwright traces. Its common timed workload covers trusted form input, XHR, a 1-pixel layout refresh, a dynamic button click and a final assertion. Both engines receive the same explicit layout refresh. Capability checks separately expose raw dynamic geometry failures. RSS is the process-tree sample taken after the workflow, not peak memory; host load and binary path are included.

`--require-fork` fails if HTML drag with `dragend` or cookie/localStorage restoration after a restart with an open CDP connection fails. Other capability failures remain visible in the JSON matrix rather than being discarded. A release binary and a development build must be labelled separately when reporting timings.

The matrix tests role locators, input trust, dynamic layout, uploads, HTML drag, iframe locators, history, scrolling, storage isolation, network routing, PNG/PDF generation, Canvas/WebGL, Playwright traces, screencasts and native WebMCP. It is a bounded fixture comparison. It does not establish browser standards compliance, cross-browser coverage or compatibility with arbitrary sites.

## Remaining work

Use `--layout --live-layout` or `MOLI_LIVE_LAYOUT=true` for current geometry after mutations. The live-layout oracle covers raw JavaScript and CDP geometry, CSSOM, frames and viewport changes. Snapshot mode continues to retain published geometry.

Broader acceptance should cover authenticated application journeys, media playback, accessibility trees, cross-origin frames, service workers, downloads and long recordings. Playwright's Firefox/WebKit coverage, test runner and trace inspection tools are separate products; this comparison uses its Chromium automation library.

## macOS test startup

On this host, compiled test programs launched slowly from the shared Cargo target directory. The same program in an isolated directory started faster. `scripts/test-macos.cjs` uses Nextest build reuse, APFS clones and ad-hoc signing to run the same compiled tests in a temporary target directory. It builds `moli-fetch` with full debug information so macOS backtraces retain the qualified owner names required by its panic regression. It requires Node, APFS and `codesign`; it removes its temporary files afterward. It does not strip code or change assertions. Run `node scripts/test-macos.cjs --test-threads 8` with the desired Cargo test profile environment; Nextest filters may be supplied explicitly.
