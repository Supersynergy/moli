# Moli / Superweb integration review — 2026-10-15

**Decision: NO-GO for merge/release acceptance.** Review fixes are prepared, but
fresh Rust gates and the combined native-browser acceptance have not run here.
No merge, installation replacement, release, or deployment was performed.

## Exact reviewed inputs

| PR | Base | Head | Relationship |
| --- | --- | --- | --- |
| [Moli #1](https://github.com/Supersynergy/moli/pull/1) | `c1893e0599c92f42eea8e188b375946ce319632d` | `cac20d15b83892d71fa8efc27d1e802002a4d68e` | Exact upstream `lexmount/moli` tag `v1.1.17`, verified with `git ls-remote` |
| [Moli #2](https://github.com/Supersynergy/moli/pull/2) | `cac20d15b83892d71fa8efc27d1e802002a4d68e` | `8fac63e31ed0d004033e16813ed6921ec6e21135` | One direct child commit of Moli #1 |
| [Superweb #1](https://github.com/Supersynergy/superweb/pull/1) | `0bb6a34e42d56f97f00101887ecd044c4765646c` | `d22b68b37aa99214a4ba166174c95ea0b9bb07ab` | Runtime dependency on the Moli #2 behavior, without a Cargo source dependency |

All three were open drafts with zero submitted GitHub reviews at inspection.
Moli #2's [CI run](https://github.com/Supersynergy/moli/actions/runs/38449058968)
was **cancelled**, not successful. Superweb's exact head had no PR-triggered
workflow run. Neither head returned commit-status entries. Those API results
are not proof that every possible external check is absent.

Moli was cloned at its exact PR head. Superweb was read through the authorized
connector at its exact head; it is a partial local source snapshot, not a full
build checkout. The original contents of every edited existing file were
checked against their Git blob hashes before publication.

## Findings and changes

Severities describe impact, including defects inherited from the base. They do
not imply that every issue was introduced by these PRs. Source findings are
distinguished from executed reproductions.

| ID | Severity | Evidence and impact | Disposition |
| --- | --- | --- | --- |
| L1 | P1 | `BrowserSession::close` sent SIGINT and waited only `100 × 20ms` before force-killing Moli. `ProtocolServer::serve_until` permits 5s of checkpointing and main permits another 1s of runtime shutdown. Valid slow flushes could be killed early. | Superweb candidate increases the wait to 7s. Needs a native slow-checkpoint regression; not executed here. |
| L2 | P1 | Daemon/cockpit installed SIGTERM handling after browser startup; cockpit also dispatched an initial task first. Termination in that window could bypass owned-child cleanup. | Install signal streams before launch; retain SIGTERM, SIGINT, and SIGHUP streams. Rust candidate, not compiled here. Cancellation still waits for an in-progress cockpit operation to yield. |
| L3 | P1 | Daemon spawned detached connection tasks, then awaited the shared state lock on shutdown. A request holding that lock in CDP could delay cleanup. | Track connections in `JoinSet`, abort and join them before taking the session for explicit close. Native concurrent-shutdown test still required. |
| D1 | P2 | `Input.cancelDragging` cleared only `input_drag_intercepted`; it did not retire `ScriptVm::active_drag_session` or deliver `dragend`. Existing test merely toggled the flag. | Moli candidate routes cancellation through the renderer's existing clear command and acknowledges after its terminal. Adds an active-drag/idempotence regression. Uncompiled patch only, under Moli's pre-commit gate. |
| D2 | P2 | `dispatch_drag_event_at_point` returned on a failed hit test before clearing a drop/cancellation. A release outside the viewport could retain the drag source. | Moli candidate retires terminal drags even without a hit and adds an off-viewport cancellation regression. Uncompiled patch only. |
| U1 | P2 | Monitor `toPage` added scroll offsets before sending CDP Input coordinates. CDP defines viewport CSS coordinates, so a scrolled click was displaced. | Fixed in production HTML; scroll and scale/inset regressions pass. Added a real scrolled-click check to the native acceptance script; that check is unrun. |
| U2 | P2 | `pointercancel` cleared only a local boolean; lost capture and a disappearing frame could also omit the remote release. | Retain the active pointer/button/last position; release exactly once with clickCount 0; reject a secondary pointer. Executed regressions pass. |
| V1 | P1 | Acceptance `stop()` silently SIGKILLed a child after 5s and still returned success, allowing forced cleanup to count as controlled shutdown. Its request interception also serialized input independently of the product. | Oracle now rejects forced/signal/nonzero exits, allows a 12s cleanup budget, and only observes input requests. Four executed oracle regressions pass. |
| W1 | P2 | A timeout/error waiting for the `WebMCP.invokeTool` acknowledgement can occur after submission but before receipt of an invocation ID. The tool may have run, and cancellation cannot safely be assumed. | Add an explicit unconfirmed-submission warning with a verify-before-retry instruction. Rust candidate; fault-injected native test remains required. |

The CDP coordinate contract is in the primary
[Input protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl).

## Promises checked against implementation and tests

**Profiles and cookies.** Moli retains the upstream exclusive OS-backed profile
lock and disk-backed storage partition. Shutdown signals are registered for
serve; fetch/import keep immediate-exit handling. `serve_until` stops ingress,
signals CDP owners, and waits at most 5s for their checkpoint workers. Existing
restart tests cover cookies, localStorage, IndexedDB and isolated contexts, but
several close their websocket before stopping the test server. They do not
replace an OS-signal test with CDP left open. The original process-signal test
checked only SIGTERM and an empty server. Cookie checkpoint write failures are
logged; exit zero alone does not prove durable storage under disk failure.

The new Moli `scripts/test-profile-lifecycle.mjs` exercises each of SIGTERM,
SIGINT and SIGHUP with CDP open: recent cookie update/deletion, localStorage,
exclusive profile refusal, restart, released lock, and handled exit zero. It
uses only temporary profiles and its own children and records the binary SHA256.
It passed syntax validation, **not native execution** in this session.

**Drag.** Positive existing tests demonstrate string MIME payload forwarding,
operation masks, `Input.dragIntercepted`, replayed enter/over/drop, dragend on
the source, and cancelled dragstart. Files/directories are deliberately not
exported by the intercepted-string payload. Added candidates cover real
`cancelDragging` and off-viewport cancellation. Multi-client/session isolation,
navigation/detach mid-drag, modifiers/dropEffect on failed drops, and file
payload equivalence remain acceptance gates. In particular interception is
stored on `PageTargetHost`, although comments describe issuing-session state;
two simultaneous CDP clients need a native regression before claiming isolation.

**WebMCP authorization.** Toolbus checks both `allow_writes` and explicit
confirmation. The compatibility CLI refuses invocation without `--confirm`
and preserves invalid JSON errors. Native invocation subscribes before sending,
matches invocation IDs, preserves tool errors, and distinguishes acknowledged
cancellation from failure/timeout. Navigation replay and self-healing are
disabled for WebMCP calls. This is a per-call opt-in contract, not proof of a
human approval UI or of rollback of already-performed tool side effects.
Multi-frame ambiguity, response-before-ack, lost-ack, concurrent invocations,
and navigation during cancellation still need native fixtures. The extra
unconfirmed-submission diagnostic does not make an unknown operation retryable.

**Processes and recording.** Owned Moli is explicitly closed; attach-mode
sessions do not own the external browser. Drop remains an emergency hard-kill
fallback, so callers must await close for persistence. Encoding is bounded and
the shared recorder leaves screencast ownership with the monitor. The ffmpeg
smoke check below validates only padding/container/decoding. It does not validate
the Rust recorder, live frame acknowledgements, cleanup after an early recorder
drop, capture limits, or a shutdown while a cockpit operation/encoding is busy.
These remain native gates; bounded close is not a universal process-exit bound.

## Fresh evidence from this session

| Check | Result | Limit |
| --- | --- | --- |
| Production monitor handlers + acceptance stop helper, original source | **4/14 pass; 10 fail**, expected failing baseline | Node VM with a small DOM/process adapter; no browser |
| Same regressions against edited source | **14/14 pass** | Does not exercise Rust/CDP transport |
| New lifecycle script, existing benchmark and updated integration script syntax | Pass | Syntax only |
| Moli patch whitespace / apply check | Pass | Not Rust formatting, compilation or tests |
| ffmpeg odd-size/timing smoke | 321×181 JPEGs → 322×182 H.264 MP4, 12 frames, 1.2s; full decode passes | Synthetic 1.0s concat timeline, quantized at 10fps; not live recorder acceptance |
| Moli Cargo fmt/Clippy/Nextest | **Blocked: Cargo/Rust absent** | No installed binaries available either |
| Superweb `just check` / Rust tests | **Blocked: just/Cargo/Rust absent** | Local source is partial |
| Combined native/browser acceptance | **Not run** | Built candidates and Playwright Chromium executable absent |

The published claims of 20,069 Moli tests, 338 affected Superweb tests and
9/12 browser checks remain prior evidence bound to their documented revisions.
They are not fresh results of this review or coverage for these edits.
The JavaScript and encoder evidence files live in the [companion Superweb review directory](https://github.com/Supersynergy/superweb/tree/review/moli-lifecycle-20261015/docs/reviews/2026-10-15). This Moli branch preserves the native candidate as `moli-rust-candidate.patch`; apply it in an isolated checkout, run the required gates, and only then commit its Rust changes.

## Safe integration order and release gates

1. Review and test Moli #1 separately as the unmodified upstream baseline. Merge
   with ancestry preserved: prefer a merge commit over squashing 432 upstream
   commits. Verify `cac20d15...` is an ancestor of main afterward.
2. Apply/review the Moli Rust candidate on Moli #2 in an isolated checkout.
   Moli `AGENTS.md` requires `cargo fmt --all`, full workspace Clippy, and full
   Nextest **before committing Rust source**. The review branch therefore
   contains the candidate as a patch, not committed Rust modifications.
3. Integrate accepted fixes into Moli #2; retarget #2 to main after #1 lands.
   Recheck its diff and exact head. Do not merge #2 into only the upstream
   staging branch and assume main contains it.
4. Review Superweb's stacked fixes, build both candidates without replacing
   shared installations, then execute the paired acceptance below. Testing the
   pair can and should happen before either implementation PR is merged.
5. Only after all gates pass, integrate Moli #2, then Superweb #1. Keep Superweb
   dependent on the fixed Moli binary; official upstream 1.1.17 alone lacks the
   required signal-driven persistence fix.
6. Re-run relevant checks whenever either candidate head changes. Record source
   SHAs, binary SHA256s, OS, toolchain, results and cleanup evidence. Approval
   and deployment are separate actions; nothing here authorizes automatic release.

```sh
# Moli root, after applying the candidate patch in a disposable checkout
cargo fmt --all
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo nextest run --no-fail-fast
node scripts/test-profile-lifecycle.mjs --bin /absolute/path/to/candidate-moli
PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/bench-superweb.cjs \
  --moli /absolute/path/to/candidate-moli --engines moli,chromium \
  --require-fork --out /tmp/moli-review

# Full Superweb checkout at the reviewed fix branch
just check
cargo test -p superweb-agent -p superweb --all-features
node --test scripts/test-monitor-input.mjs scripts/test-acceptance-shutdown.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core MOLI_BIN=/absolute/path/to/candidate-moli \
  node scripts/verify-moli.mjs --bin /absolute/path/to/candidate-superweb \
  --case all --signal SIGTERM --out /tmp/superweb-review-term
# Repeat the native acceptance with --signal SIGINT and --signal SIGHUP,
# using distinct output directories and the same candidate binary hashes.
```

Also fault-inject slow/disk-failing checkpoints, signal startup and active
requests, stalled CDP, recorder drop, and WebMCP lost acknowledgements. Verify
zero owned live children, no zombies, successful profile reacquisition, cookie
contents, and an attached external browser that remains alive. A clean exit
code or a process list after forced cleanup is insufficient acceptance.
