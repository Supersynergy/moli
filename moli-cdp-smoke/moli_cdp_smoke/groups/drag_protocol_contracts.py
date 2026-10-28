"""Drag payload, event-view, and pointer contracts checked against Chromium."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from ..assertions import assert_equal
from ..diagnostics import new_cdp_session
from ..helpers import capture_layout
from . import SmokeState


_BOARD = """<!doctype html><style>
  html,body{margin:0;height:320px}
  #source,#a,#b{position:absolute;width:100px;height:80px}
  #source{left:20px;top:20px}#a{left:220px;top:20px}#b{left:420px;top:20px}
</style><div id=source draggable=true>source</div><div id=a>A</div><div id=b>B</div>"""

_INSTALL = """options => {
  const contract = window.__dragContract = {events:[], views:[], stringCallbacks:[]};
  const identities = new WeakMap();
  let nextIdentity = 1;
  const identity = value => {
    if (!identities.has(value)) identities.set(value, nextIdentity++);
    return identities.get(value);
  };
  const node = value => value ? (value.id || value.nodeName) : null;
  const oldView = view => ({
    type:view.type, data:view.dt.getData('text/plain'), types:Array.from(view.dt.types),
    itemCount:view.items.length, fileNames:Array.from(view.files,file=>file.name),
    savedTypes:Array.from(view.types), kind:view.item?.kind ?? null,
    fileKind:view.fileItem?.kind ?? null, file:view.fileItem?.getAsFile()?.name ?? null,
  });
  contract.sourceState = () => {
    const view=contract.sourceView;
    if(!view) return null;
    return {data:view.dt.getData('text/plain'),nativeData:view.dt.getData('application/x-native'),
      types:Array.from(view.dt.types),items:Array.from(view.items,item=>({kind:item.kind,type:item.type})),
      files:Array.from(view.dt.files,file=>file.name),savedTypes:Array.from(view.types),
      savedItem:{kind:view.item.kind,type:view.item.type},
      savedFile:view.fileItem ? {kind:view.fileItem.kind,type:view.fileItem.type,
        name:view.fileItem.getAsFile()?.name ?? null} : null};
  };
  for (const type of ['dragstart','drag','dragenter','dragover','dragleave','drop','dragend']) {
    document.addEventListener(type, event => {
      const dt=event.dataTransfer;
      if(type==='dragstart') {
        dt.setData('text/plain','native-secret');
        dt.setData('application/x-native','native-only');
        if(options.sourceFile) dt.items.add(new File(['native-file-payload'],'source-file.txt',{type:'text/plain'}));
        dt.effectAllowed='copyMove';
      }
      if(type==='dragover' && ['a','b'].includes(event.target.id)) event.preventDefault();
      if(type==='drop') event.preventDefault();
      const view={type,dt,items:dt.items,types:dt.types,files:dt.files,item:dt.items[0],
        fileItem:Array.from(dt.items).find(item=>item.kind==='file')};
      if(type==='dragstart') contract.sourceView=view;
      const record={type,target:node(event.target),relatedTarget:node(event.relatedTarget),
        cancelable:event.cancelable,dt:identity(dt),data:dt.getData('text/plain'),
        types:Array.from(dt.types),allowed:dt.effectAllowed,effect:dt.dropEffect};
      if(contract.sourceView) record.source=contract.sourceState();
      if(type==='drop') {
        record.oldViews=contract.views.filter(view=>['dragenter','dragover'].includes(view.type)).map(oldView);
        contract.dropFiles=Array.from(dt.files);
        contract.dropView=view;
        if(options.strings) {
          for(const previous of contract.views) if(previous.item) previous.item.getAsString(data =>
            contract.stringCallbacks.push({type:'old:'+previous.type,data}));
          contract.dropString = new Promise(resolve => {
            view.item.getAsString(data => resolve({data,kind:view.item.kind,type:view.item.type}));
          });
        }
      }
      if(options.strings && type!=='drop' && view.item) view.item.getAsString(data =>
        contract.stringCallbacks.push({type,data}));
      contract.views.push(view);
      contract.events.push(record);
    });
  }
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel',
                      'gotpointercapture','lostpointercapture','mousedown','mousemove','mouseup']) {
    document.addEventListener(type,event => {
      contract.events.push({type,target:node(event.target),buttons:event.buttons,cancelable:event.cancelable});
      if(options.capture && type==='pointerdown' && event.target.id==='source')
        event.target.setPointerCapture(event.pointerId);
    });
  }
}"""


def _data(value: str | None, mask: int = 1, mime: str = "text/plain") -> dict:
    return {
        "items": [] if value is None else [{"mimeType": mime, "data": value}],
        "dragOperationsMask": mask,
    }


async def _mouse(session, kind: str, x: int, y: int, buttons: int) -> None:
    await session.send("Input.dispatchMouseEvent", {
        "type": kind, "x": x, "y": y, "buttons": buttons,
        "button": "none" if kind == "mouseMoved" and not buttons else "left",
    })


async def _drag(session, kind: str, data: dict, x: int = 250) -> None:
    await session.send("Input.dispatchDragEvent", {"type": kind, "x": x, "y": 40, "data": data})


async def _events(page) -> list[dict]:
    return await page.evaluate("() => window.__dragContract.events")


async def _drag_step(page, session, kind: str, data: dict, x: int = 250) -> list[dict]:
    start = len(await _events(page))
    await _drag(session, kind, data, x)
    return [event for event in (await _events(page))[start:]
            if event["type"] in ("dragenter", "dragover", "dragleave", "drop")]


@asynccontextmanager
async def _board(state: SmokeState, *, native: bool = True, capture: bool = False,
                 strings: bool = False, source_file: bool = False, page=None):
    page = state.page if page is None else page
    await page.set_content(_BOARD)
    await page.evaluate(_INSTALL, {"capture": capture, "strings": strings, "sourceFile": source_file})
    await capture_layout(page)
    session = await new_cdp_session(page.context, page)
    intercepted = []
    ready = asyncio.Event()

    def on_intercepted(event: dict) -> None:
        intercepted.append(event)
        ready.set()

    session.on("Input.dragIntercepted", on_intercepted)
    try:
        await session.send("Input.setInterceptDrags", {"enabled": native})
        if native:
            await _mouse(session, "mouseMoved", 40, 40, 0)
            await _mouse(session, "mousePressed", 40, 40, 1)
            await _mouse(session, "mouseMoved", 55, 50, 1)
            await asyncio.wait_for(ready.wait(), timeout=5)
        yield session, intercepted
    finally:
        # dragCancel really ends intercepted native drags in Chromium. Its
        # cancelDragging command can leave that particular source pending.
        await _drag(session, "dragCancel", _data(None))
        await _mouse(session, "mouseReleased", 250, 40, 0)
        await session.send("Input.setInterceptDrags", {"enabled": False})
        await session.detach()


async def _payload_contracts(state: SmokeState) -> None:
    page = state.page
    async with _board(state) as (session, intercepted):
        assert_equal(intercepted[0]["data"]["items"][0]["data"], "native-secret", "source interception payload")
        enter = await _drag_step(page, session, "dragEnter", _data(None))
        assert_equal([(event["type"], event["types"]) for event in enter],
                     [("dragenter", [])], "an explicitly empty enter replaces the native secret")
        drop = await _drag_step(page, session, "drop", _data("drop-replacement"))
        assert_equal([(event["type"], event["types"], event["data"]) for event in drop],
                     [("dragover", [], ""), ("drop", ["text/plain"], "drop-replacement")],
                     "drop pre-over keeps enter data; drop consumes its own payload")

    async with _board(state) as (session, _):
        await _drag_step(page, session, "dragEnter", _data("enter-secret"))
        over = await _drag_step(page, session, "dragOver", _data("ignored-over", 16, "application/x-over"))
        assert_equal([(event["type"], event["types"], event["allowed"]) for event in over],
                     [("dragover", ["text/plain"], "move")], "over updates mask without replacing enter items")
        drop = await _drag_step(page, session, "drop", _data("drop-replacement", 1))
        assert_equal([(event["type"], event["types"], event["allowed"], event["data"]) for event in drop],
                     [("dragover", ["text/plain"], "copy", ""),
                      ("drop", ["text/plain"], "copy", "drop-replacement")],
                     "drop updates the pre-over mask and replaces data only for drop")

    async with _board(state) as (session, _):
        await _drag_step(page, session, "dragEnter", _data("enter-secret"))
        drop = await _drag_step(page, session, "drop", _data(None))
        assert_equal([(event["type"], event["types"], event["data"]) for event in drop],
                     [("dragover", ["text/plain"], ""), ("drop", [], "")],
                     "an explicitly empty drop cannot reuse enter payload")
    state.record("drag_command_payload_and_operation_replacement")


async def _view_contracts(state: SmokeState) -> None:
    page = state.page
    source_types = ["text/plain", "application/x-native", "Files"]
    protected_source = {
        "data": "", "nativeData": "", "types": source_types,
        "items": [{"kind": "string", "type": "text/plain"},
                  {"kind": "string", "type": "application/x-native"},
                  {"kind": "file", "type": "text/plain"}],
        "files": [], "savedTypes": source_types,
        "savedItem": {"kind": "string", "type": "text/plain"},
        "savedFile": {"kind": "file", "type": "text/plain", "name": None},
    }
    async with _board(state, source_file=True) as (session, _):
        assert_equal(await page.evaluate("() => window.__dragContract.sourceState()"), protected_source,
                     "the retained source view exposes metadata but protects data and files after dragstart")
        packet = _data("target-data", 17)
        for kind in ("dragEnter", "dragOver", "drop"):
            await _drag_step(page, session, kind, packet)
        events = await _events(page)
        start = next(event for event in events if event["type"] == "dragstart")
        end = next(event for event in events if event["type"] == "dragend")
        target = [event for event in events if event["type"] in ("dragenter", "dragover", "drop")]
        assert_equal(start["dt"], end["dt"], "source dragend retains the source DataTransfer identity")
        assert_equal(end["effect"], "move", "accepted copyMove without explicit dropEffect prefers move")
        assert_equal(start["source"], {**protected_source, "data": "native-secret", "nativeData": "native-only",
                     "files": ["source-file.txt"],
                     "savedFile": {"kind": "file", "type": "text/plain", "name": "source-file.txt"}},
                     "the source is writable and its File is readable inside dragstart")
        assert_equal(len({event["dt"] for event in target}), len(target),
                     "distinct target updates use distinct DataTransfer views")
        assert_equal(start["dt"] in {event["dt"] for event in target}, False,
                     "target views do not borrow the source's writable object")
        for event in events:
            if "source" in event and event["type"] != "dragstart":
                assert_equal(event["source"], protected_source,
                             f"retained source metadata survives {event['type']} without exposing native data")
            if event["type"] in ("dragstart", "drag", "dragend"):
                assert_equal(event["cancelable"], event["type"] != "dragend",
                             f"source {event['type']} cancellation contract")
        assert_equal(await page.evaluate("() => window.__dragContract.sourceState()"),
                     {"data": "", "nativeData": "", "types": [], "items": [], "files": [],
                      "savedTypes": source_types, "savedItem": {"kind": "", "type": ""},
                      "savedFile": {"kind": "", "type": "", "name": None}},
                     "the source becomes disabled only after dragend dispatch finishes")

    with TemporaryDirectory(prefix="moli-drag-views-") as directory:
        file = Path(directory) / "payload.txt"
        file.write_text("retained-file-payload", encoding="utf-8")
        async with _board(state, native=False, strings=True) as (session, _):
            packet = {**_data("enter-data"), "files": [str(file)]}
            for kind in ("dragEnter", "dragOver"):
                await _drag_step(page, session, kind, packet)
            await _drag_step(page, session, "drop", {**packet, "items": _data("drop-data")["items"]})
            callback = await page.evaluate("async () => await window.__dragContract.dropString")
            assert_equal(callback, {"data": "drop-data", "kind": "", "type": ""},
                         "queued getAsString reads its captured value after the item becomes disabled")
            drop = next(event for event in await _events(page) if event["type"] == "drop")
            for view in drop["oldViews"]:
                assert_equal({key: view[key] for key in ("data", "types", "itemCount", "fileNames", "kind", "fileKind", "file")},
                             {"data": "", "types": [], "itemCount": 0, "fileNames": [],
                              "kind": "", "fileKind": "", "file": None},
                             "saved protected target views cannot regain access during drop")
                assert_equal(view["savedTypes"], ["text/plain", "Files"], "saved types array is a snapshot")
            result = await page.evaluate("""async () => {
              const contract=window.__dragContract;
              return {protectedCallbacks:contract.stringCallbacks,
                capturedFiles:await Promise.all(contract.dropFiles.map(async file=>({name:file.name,data:await file.text()}))),
                data:contract.dropView.dt.getData('text/plain'),types:Array.from(contract.dropView.dt.types),
                items:contract.dropView.dt.items.length,files:contract.dropView.dt.files.length};
            }""")
            assert_equal(result, {"protectedCallbacks": [],
                         "capturedFiles": [{"name": "payload.txt", "data": "retained-file-payload"}],
                         "data": "", "types": [], "items": 0, "files": 0},
                         "completed stores stay disabled while captured File objects remain readable")
    state.record("drag_data_transfer_view_access_and_async_callbacks")


async def _target_contracts(state: SmokeState) -> None:
    page = state.page
    async with _board(state, native=False) as (session, _):
        packet = _data("target-data", 17)
        steps = []
        for kind, x in (("dragEnter", 250), ("dragOver", 250), ("dragOver", 450),
                        ("dragOver", 250), ("drop", 250)):
            steps.append(await _drag_step(page, session, kind, packet, x))
        expected = [
            [("dragenter", "a", None)], [("dragover", "a", None)],
            [("dragenter", "b", "a"), ("dragleave", "a", "b")],
            [("dragenter", "a", "b"), ("dragleave", "b", "a")],
            [("dragover", "a", None), ("drop", "a", None)],
        ]
        assert_equal([[(event["type"], event["target"], event["relatedTarget"]) for event in step] for step in steps],
                     expected, "target changes enter new before leaving old, without an extra over")
        for step in steps[2:4]:
            assert_equal(step[0]["dt"], step[1]["dt"], "one target transition shares one event view")
        events = [event for step in steps for event in step]
        for event in events:
            assert_equal(event["cancelable"], event["type"] != "dragleave", f"{event['type']} cancellation contract")
            assert_equal(event["effect"], "none", "plain target event views start with no explicit dropEffect")
    state.record("drag_target_transition_order_related_target_and_views")


async def _pointer_contracts(state: SmokeState) -> None:
    async with AsyncExitStack() as cleanup:
        # Give pointer capture its own Page, independent of the earlier external
        # drag cases and the pointer streams those commands created.
        page = await state.page.context.new_page()
        cleanup.push_async_callback(page.close)
        async with _board(state, capture=True, page=page) as (session, intercepted):
            await page.wait_for_function(
                "() => window.__dragContract.events.some(event => event.type === 'lostpointercapture')",
                timeout=5_000,
            )
            initial = await _events(page)
            start = next(index for index, event in enumerate(initial) if event["type"] == "dragstart")
            assert_equal([event["type"] for event in initial[start:start + 3]],
                         ["dragstart", "pointercancel", "lostpointercapture"],
                         "native drag cancels the pointer before releasing capture")
            assert_equal([(event["buttons"], event["cancelable"]) for event in initial[start + 1:start + 3]],
                         [(0, False), (0, False)], "pointer cancellation and capture loss have no pressed buttons")
            assert_equal(any(event["type"] == "gotpointercapture" for event in initial[:start]), True,
                         "the source actually acquired capture before dragging")
            before = len(initial)
            await _mouse(session, "mouseMoved", 60, 50, 1)
            await _mouse(session, "mouseMoved", 250, 40, 1)
            ordinary = [event["type"] for event in (await _events(page))[before:]
                        if event["type"].startswith("pointer") or event["type"] in ("mousemove", "mouseup")]
            assert_equal(ordinary, [], "an active native drag suppresses the ordinary pointer/mouse stream")
            await _drag(session, "dragCancel", intercepted[0]["data"])
            end = [event for event in await _events(page) if event["type"] == "dragend"]
            assert_equal([(event["effect"], event["cancelable"]) for event in end], [("none", False)],
                         "effective cancellation ends the source exactly once")
            before = len(await _events(page))
            await _mouse(session, "mouseMoved", 60, 50, 1)
            await _mouse(session, "mouseReleased", 60, 50, 0)
            resumed = [event["type"] for event in (await _events(page))[before:]]
            assert_equal(resumed, ["pointermove", "mousemove", "pointerup", "mouseup"],
                         "a completed dragCancel restores ordinary input even before the held button is released")
            assert_equal(len(intercepted), 1, "held movement after cancellation cannot start a second drag")

    state.record("native_drag_pointer_cancel_capture_and_stream_recovery")


async def run_drag_protocol_contracts(state: SmokeState) -> None:
    await _payload_contracts(state)
    await _view_contracts(state)
    await _target_contracts(state)
    await _pointer_contracts(state)
