# WebMCP compatibility audit

Audited on 2026-10-02 against local Chromium commit
`2d184faab9fb11e1070fb1eeafebf291f6e85923` (2026-09-30). The target is that
revision's base `WebMCP` feature enabled. Chromium still marks this feature
experimental; this audit records a specific implementation target.

## Implementation boundaries

| Layer | Responsibility |
| --- | --- |
| `moli-webmcp` | Native DOM schema inference, validation of complete fill plans, scalar conversion, and JSON-LD navigation results. No V8, renderer, or protocol dependency. |
| `moli-renderer-v8::context_bootstrap::web_mcp` | IDL bindings, document registries, realms, tasks, promises, events, control updates, invocation cancellation, and document lifecycle. |
| `moli-page-types::web_mcp` | Shared protocol DTOs and typed renderer errors. |
| `moli-protocol::domains::web_mcp` | CDP session state, commands, events, and Runtime remote-object projection. |

## Compatibility fixes covered by regressions

- Native form sanitization is validated before applying any fill. Select
  options use native ownership and normalized values; duplicate values select
  the first match for a single select and all matches for a multiple select.
  Schema generation preserves empty option titles, effective range bounds,
  decimal step alignment, and rounded time/datetime step precision.
- Fill events depend on observable value changes rather than native dirty
  flags. Unchanged checkbox/radio fills still dispatch `change`, matching Blink.
  Numeric scalar conversion follows Blink's int32 versus double distinction,
  including its six-significant-digit double string conversion.
- Author `toJSON` callbacks can replace a document or detach a frame. The API
  revalidates its target after serialization, avoiding two renderer crashes.
  Reentrant same-name registration preserves the inner registration and
  rejects the outer duplicate instead of leaving a promise unresolved.
  Discovery acknowledges on a browser task, and origin/abort error precedence
  follows the reference implementation.
- Invalid declarative tool names are excluded. Non-object serialized schemas
  are excluded from discovery. IDL interface descriptors, inheritance, and
  receiver checks have a direct regression.
- CDP distinguishes disabled-domain server errors from invalid parameters.
  Imperative registrations retain stack traces, and failed result
  serialization retains an inspectable Runtime exception object.

The same-name reentrancy guard also hardens the unique-name invariant: it is
not a claim that Chromium's current registration code handles this adversarial
case identically.

## Validation and reference sources

There are 119 WebMCP tests: 71 ported Chromium WPT fixtures, 31 renderer tests,
and 17 protocol tests. The imported behavior fixtures use the shared WPT runner.
One renderer test additionally checks 38 schema cases ported from Chromium's
C++ form tests. This audit adds 18 regression tests.
The 71 imported behavior fixtures match the pinned Chromium files byte for
byte. The upstream IDL harness fixture is not ported; direct interface-shape
coverage does not substitute for the complete upstream IDL harness.

Verification runs from the repository root:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo nextest run --no-fail-fast
```

The source comparison uses Blink's `core/script_tools/model_context.cc`,
`core/html/forms/{form_mcp_schema,html_form_element,step_range}.cc`,
`core/inspector/inspector_web_mcp_agent.cc`, JSON parsing/number conversion in
`platform/{json,wtf}`, and the browser-side WebMCP DevTools handler and PDL.
Evidence is source comparison plus Moli regressions; this audit does not run
a differential test against a Chromium binary built from the pinned commit.

## Separately gated Chromium features

The following extensions remain unimplemented:

| Chromium gate | Additional surface |
| --- | --- |
| `WebMCPFormAssociatedCustomElements` | `ElementInternals.setToolParamSchema` and custom-element `toolFillCallback`. |
| `WebMCPDeclarativeFileInput` | Declarative file-input parameters. |
| `WebMCPTesting` | `Document.modelContextTesting`. |

Chromium's `runtime_enabled_features.json5` makes these gates imply base
`WebMCP`; enabling base `WebMCP` alone does not enable these extensions.
They are outside this audit's compatibility target.
