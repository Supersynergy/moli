from __future__ import annotations

import unittest
from typing import Any

from moli_cdp_smoke.assertions import SmokeError
from moli_cdp_smoke.groups.cdp_ordering import _Page, _Wire, _world_prefix


class _ScriptedClient:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.messages = iter(messages)
        self.next_id = 0

    async def send(self, *_args: Any, **_kwargs: Any) -> int:
        self.next_id += 1
        return self.next_id

    async def recv(self) -> dict[str, Any]:
        return next(self.messages)


class OrderingTranscriptTests(unittest.IsolatedAsyncioTestCase):
    async def test_reverse_waiter_retains_earlier_response_without_reading_again(self) -> None:
        client = _ScriptedClient([
            {"id": 1, "sessionId": "page", "result": {"first": True}},
            {"id": 2, "sessionId": "page", "result": {"second": True}},
        ])
        wire = _Wire(client, "reverse-waiter")  # type: ignore[arg-type]
        first = await wire.send("Page.getFrameTree", session="page")
        second = await wire.send("Runtime.enable", session="page")
        await wire.response(second)
        self.assertEqual((await wire.response(first))["result"], {"first": True})
        self.assertLess(wire.index(first), wire.index(second))
        wire.assert_all_replied()

    async def test_duplicate_terminal_is_rejected_while_waiting_for_later_command(self) -> None:
        client = _ScriptedClient([
            {"id": 1, "result": {}},
            {"id": 1, "result": {}},
            {"id": 2, "result": {}},
        ])
        wire = _Wire(client, "duplicate")  # type: ignore[arg-type]
        await wire.call("Browser.getVersion")
        with self.assertRaisesRegex(SmokeError, "duplicate response id=1"):
            await wire.call("Target.getTargets")
        self.assertEqual(wire.trace[-1], {"direction": "receive", "message": {"id": 1, "result": {}}})
        self.assertEqual(sum(frame["direction"] == "receive" for frame in wire.trace), 2)

    async def test_response_cannot_be_claimed_by_a_different_session(self) -> None:
        client = _ScriptedClient([{"id": 1, "sessionId": "replacement", "result": {}}])
        wire = _Wire(client, "session-owner")  # type: ignore[arg-type]
        with self.assertRaisesRegex(SmokeError, "original response session"):
            await wire.call("Page.getFrameTree", session="original")
        self.assertEqual(wire.trace[-1], {
            "direction": "receive", "message": {"id": 1, "sessionId": "replacement", "result": {}}
        })

    async def test_callback_reply_cannot_overtake_its_context_notification(self) -> None:
        client = _ScriptedClient([
            {"id": 1, "sessionId": "page", "result": {}},
            {"id": 2, "sessionId": "page", "result": {"executionContextId": 7}},
            {"method": "Runtime.executionContextCreated", "sessionId": "page",
             "params": {"context": {"id": 7}}},
        ])
        wire = _Wire(client, "late-context")  # type: ignore[arg-type]
        page = _Page(session="page", url="http://fixture/plain", frame="frame", node=1,
                     root=2, sheet="sheet", css_event_index=0, css_reply_index=0)
        with self.assertRaisesRegex(SmokeError, "notification must precede world response"):
            await _world_prefix(wire, page, False)


if __name__ == "__main__":
    unittest.main()
