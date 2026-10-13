# Superweb browser parity checks

This branch updates the fork to upstream v1.1.17 and carries the existing drag-interception changes onto that version. It adds a bounded server shutdown path so cookies are flushed even when CDP clients remain connected. Fetch and import retain the immediate termination handlers. The server listens for SIGTERM or SIGINT. It also handles SIGHUP and permits at most five seconds for profile shutdown.

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

Raw JavaScript geometry and DOM geometry can remain stale after mutations until an explicit layout pass. Superweb works around this with a mutation-driven refresh task. A native fix should connect these geometry reads to the renderer's layout invalidation lifecycle and add regressions for CSS changes, frames and viewport changes.

Broader acceptance should cover authenticated application journeys, media playback, accessibility trees, cross-origin frames, service workers, downloads and long recordings. Playwright's Firefox/WebKit coverage, test runner and trace inspection tools are separate products; this comparison uses its Chromium automation library.

## macOS test startup

On this host, compiled test programs launched slowly from the shared Cargo target directory. The same program in an isolated directory started faster. `scripts/test-macos.cjs` uses Nextest build reuse, APFS clones and ad-hoc signing to run the same compiled tests in a temporary target directory. It requires Node, APFS and `codesign`; it removes its temporary files afterward. It does not strip code, change assertions or filter tests. Run `node scripts/test-macos.cjs --test-threads 8` with the desired Cargo test profile environment.
