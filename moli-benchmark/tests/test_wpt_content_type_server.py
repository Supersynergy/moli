from __future__ import annotations

import socket
import tempfile
import unittest
from contextlib import ExitStack
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from moli_benchmark.wpt_cross.case_set import enumerate_cases
from moli_benchmark.wpt_cross.server import WptFixtureServer


RESOURCE = "/fetch/content-type/resources/content-type.py"


class ContentTypeFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        (self.root / "resources").mkdir()
        (self.root / "resources/testharness.js").write_text("// testharness")
        self.stack.enter_context(patch(
            "moli_benchmark.wpt_cross.server._global_ipv6_address", return_value=None
        ))
        self.server = self.stack.enter_context(WptFixtureServer(self.root))

    def request(self, query="", *, method="GET", path=RESOURCE, body=None):
        connection = HTTPConnection("127.0.0.1", self.server.port, timeout=2)
        try:
            connection.request(method, path + "?" + query, body)
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    def wire_response(self, method: str, query: str = "", headers: bytes = b"") -> bytes:
        with socket.create_connection(("127.0.0.1", self.server.port), timeout=2) as connection:
            connection.sendall(
                method.encode() + b" " + RESOURCE.encode() + b"?" + query.encode() +
                b" HTTP/1.1\r\nHost: localhost\r\n" + headers + b"\r\n"
            )
            with connection.makefile("rb") as stream:
                return stream.read()

    def test_default_response_is_the_upstream_raw_response_even_for_head(self) -> None:
        expected = (
            b"HTTP/1.1 200 OK\r\nX-Content-Type-Options: nosniff\r\n"
            b"Content-Length: 10\r\nConnection: close\r\n\r\n<b>hi</b>\n"
        )
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                self.assertEqual(self.wire_response(method), expected)

    def test_preserves_separate_combined_missing_and_empty_content_types(self) -> None:
        cases = [
            ([], None),
            ([("single_header", "")], [""]),
            ([("value", "")], [""]),
            ([("value", "text/plain"), ("value", ""), ("value", "text/html")],
             ["text/plain", "", "text/html"]),
            ([("single_header", ""), ("value", "text/plain"), ("value", "text/html")],
             ["text/plain,text/html"]),
            ([("value", 'text/plain; x="a,b"'), ("value", "APPLICATION/JSON")],
             ['text/plain; x="a,b"', "APPLICATION/JSON"]),
        ]
        for query, expected in cases:
            with self.subTest(query=query):
                status, headers, body = self.request(urlencode(query))
                self.assertEqual((status, body), (200, b"<b>hi</b>\n"))
                self.assertEqual(headers.get_all("Content-Type"), expected)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(headers["Connection"], "close")
                self.assertNotIn("Cache-Control", headers)
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_serves_standard_and_extension_methods_without_consuming_uploads(self) -> None:
        for method in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "YO", "patcH", "chicken"):
            with self.subTest(method=method):
                status, headers, body = self.request("value=text/html", method=method, body=b"upload")
                self.assertEqual((status, body), (200, b"" if method == "HEAD" else b"<b>hi</b>\n"))
                self.assertEqual(headers.get_all("Content-Type"), ["text/html"])
                self.assertEqual(headers["Content-Length"], "10")
        for headers in (b"Content-Length: 100\r\n", b"Transfer-Encoding: chunked\r\n"):
            with self.subTest(headers=headers):
                self.assertTrue(self.wire_response("POST", headers=headers).endswith(b"<b>hi</b>\n"))

    def test_query_parameters_preserve_raw_bytes_and_first_content_value(self) -> None:
        query = "value=text/plain%3Bx=%80%FF&content=%00%80%FF%2B%26&content=ignored"
        status, headers, body = self.request(query)
        self.assertEqual((status, body), (200, b"\x00\x80\xff+&"))
        self.assertEqual(headers.get_all("Content-Type"), ["text/plain;x=\x80\xff"])
        self.assertEqual(headers["Content-Length"], "5")
        self.assertEqual(self.request("content=")[2], b"")

    def test_raw_fixture_bypasses_pipelines_and_header_normalization(self) -> None:
        query = "value=text/plain%0D%0AX-Raw:%20yes&pipe=status(404)%7Cheader(Content-Type,text/html)"
        wire = self.wire_response("GET", query)
        self.assertTrue(wire.startswith(b"HTTP/1.1 200 OK\r\n"))
        self.assertIn(b"Content-Type: text/plain\r\nX-Raw: yes\r\n", wire)
        self.assertNotIn(b"Content-Type: text/html", wire)
        self.assertTrue(wire.endswith(b"<b>hi</b>\n"))

    def test_dispatch_matches_only_the_canonical_resource(self) -> None:
        for path in (RESOURCE + "2", RESOURCE + ".js", "/wrong" + RESOURCE,
                     "/resource-timing/resources/content-type.py"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path=path)[0], 404)

    def test_case_selection_resolves_exact_absolute_and_relative_references(self) -> None:
        sources = {
            "fetch/content-type/direct.window.js": "fetch('resources/content-type.py?value=text/html');",
            "fetch/content-type/nested/relative.window.js": "fetch('../resources/content-type.py');",
            "resource-timing/direct.window.js": f"fetch('{RESOURCE}?single_header');",
            "resource-timing/suffix.window.js": f"fetch('{RESOURCE}2');",
            "resource-timing/extension.window.js": f"fetch('{RESOURCE}.js');",
            "resource-timing/prefix.window.js": f"fetch('/wrong{RESOURCE}');",
            "resource-timing/unknown.window.js": f"fetch('{RESOURCE}'); fetch('unknown.py');",
            "other/wrong-relative.window.js": "fetch('resources/content-type.py');",
        }
        for path, source in sources.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source)
        selected = enumerate_cases(self.root, dir_prefixes=("fetch/content-type", "resource-timing", "other"))
        self.assertEqual([case.case_path for case in selected], [
            "fetch/content-type/direct.window.js?moli-wpt-script=window",
            "fetch/content-type/nested/relative.window.js?moli-wpt-script=window",
            "resource-timing/direct.window.js?moli-wpt-script=window",
        ])


if __name__ == "__main__":
    unittest.main()
