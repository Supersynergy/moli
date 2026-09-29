from __future__ import annotations

import tempfile
import unittest
from contextlib import ExitStack
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

from moli_benchmark.wpt_cross.case_set import enumerate_cases
from moli_benchmark.wpt_cross.server import WptFixtureServer


RESOURCE = "/html/syntax/charset/resources/bogus-charset-http.py"
META_RESOURCE = "/html/syntax/charset/resources/bogus-charset-http-valid-meta.py"


class DocumentCharsetFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        (self.root / "resources").mkdir()
        (self.root / "resources/testharness.js").write_text("// testharness")
        stack.enter_context(patch(
            "moli_benchmark.wpt_cross.server._global_ipv6_address", return_value=None
        ))
        self.server = stack.enter_context(WptFixtureServer(self.root))

    def request(self, path: str, method: str = "GET"):
        connection = HTTPConnection("127.0.0.1", self.server.port, timeout=2)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    def test_serves_exact_bytes_and_invalid_charset_without_applying_pipes(self) -> None:
        for path, expected in [(RESOURCE, b"\xa2\n"),
                               (META_RESOURCE, b"<meta charset=windows-1251>\xa2\n")]:
            for method in ("GET", "HEAD", "POST", "OPTIONS", "PUT", "YO", "CUSTOM"):
                with self.subTest(path=path, method=method):
                    status, headers, body = self.request(
                        path + "?pipe=status(404)|header(Content-Type,text/plain)", method
                    )
                    self.assertEqual(status, 200)
                    self.assertEqual(headers.get_all("Content-Type"),
                                     ["text/html;charset=this-is-not-a-charset"])
                    self.assertEqual(headers["Content-Length"], str(len(expected)))
                    self.assertEqual(body, b"" if method == "HEAD" else expected)
                    self.assertNotIn("Cache-Control", headers)

    def test_only_canonical_paths_are_handled(self) -> None:
        for path in (RESOURCE + "2", RESOURCE + ".js", "/wrong" + RESOURCE):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_case_selection_accepts_only_supported_resource_references(self) -> None:
        sources = {
            "html/syntax/charset/direct.html": "fetch('resources/bogus-charset-http.py');",
            "html/syntax/charset/nested/meta.html": "fetch('../resources/bogus-charset-http-valid-meta.py');",
            "other/absolute.html": f"fetch('{RESOURCE}');",
            "other/wrong-relative.html": "fetch('resources/bogus-charset-http.py');",
            "other/suffix.html": f"fetch('{RESOURCE}2');",
            "other/unknown.html": f"fetch('{RESOURCE}'); fetch('unknown.py');",
        }
        for path, source in sources.items():
            file = self.root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('<script src="/resources/testharness.js"></script>' + source)
        self.assertEqual(
            [case.case_path for case in enumerate_cases(self.root, dir_prefixes=("html/syntax/charset", "other"))],
            ["html/syntax/charset/direct.html", "html/syntax/charset/nested/meta.html", "other/absolute.html"],
        )


if __name__ == "__main__":
    unittest.main()
