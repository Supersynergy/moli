from __future__ import annotations

from wpt_cross_test_support import *


class WptCrossFetchFixturesTests(WptCrossTestCase):
    def test_fixture_server_parses_fetch_status_parameters_as_bytes(self) -> None:
        self.assertEqual(_fetch_status_response(""), (200, "OMG", "", b""))
        self.assertEqual(
            _fetch_status_response(
                "code=201&code=404&text=&text=ignored&type=text%2Fplain"
                "&content=%FF%FE%00%2B+end&content=ignored"
            ),
            (201, "", "text/plain", b"\xff\xfe\x00+ end"),
        )
    def test_fixture_server_models_fetch_status_for_supported_methods(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                for method in ["GET", "HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE", "YO"]:
                    for status in [200, 204, 205, 304]:
                        with self.subTest(method=method, status=status):
                            connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                            try:
                                connection.request(
                                    method,
                                    "/fetch/api/resources/status.py"
                                    f"?code={status}&text=Custom%20%FF"
                                    "&type=text%2Fplain%3Bcharset%3DUTF-16"
                                    "&content=%FF%FE%00%2B+end",
                                    body=b"ignored" if method not in {"GET", "HEAD"} else None,
                                )
                                response = connection.getresponse()
                                self.assertEqual(response.status, status)
                                self.assertEqual(response.reason, "Custom \xff")
                                self.assertEqual(response.headers["X-Request-Method"], method)
                                self.assertEqual(
                                    response.headers["Content-Type"],
                                    "text/plain;charset=UTF-16",
                                )
                                self.assertEqual(response.headers["Content-Length"], "8")
                                self.assertEqual(
                                    response.read(),
                                    b"" if method == "HEAD" or status in {204, 304}
                                    else b"\xff\xfe\x00+ end",
                                )
                            finally:
                                connection.close()
    def test_fixture_server_models_fetch_trickle_parameters_and_methods(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text("// testharness")
            with WptFixtureServer(root_path) as server, patch(
                "moli_benchmark.wpt_cross.server.time.sleep"
            ) as sleep:
                cases = [
                    ("", 50, "text/plain", 0.5),
                    ("count=2&count=9&ms=1.5&ms=900", 2, "text/plain", 0.0015),
                    ("count=0&ms=0&notype", 0, None, 0.0),
                    ("count=-1&ms=0&notype=false", 0, None, 0.0),
                ]
                for method in ["GET", "HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE", "YO"]:
                    for query, count, mime, delay in cases:
                        with self.subTest(method=method, query=query):
                            sleep.reset_mock()
                            connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                            try:
                                connection.request(
                                    method, "/fetch/api/resources/trickle.py?" + query,
                                    body=b"upload" if method not in {"GET", "HEAD"} else None,
                                )
                                response = connection.getresponse()
                                self.assertEqual(response.status, 200)
                                self.assertEqual(response.headers.get("Content-Type"), mime)
                                self.assertIsNone(response.headers.get("Content-Length"))
                                self.assertIsNone(response.headers.get("Transfer-Encoding"))
                                self.assertEqual(response.read(), b"" if method == "HEAD" else b"TEST_TRICKLE\n" * count)
                                expected_sleeps = 1 if method == "HEAD" else count + 2
                                self.assertEqual([args.args[0] for args in sleep.call_args_list], [delay] * expected_sleeps)
                            finally:
                                connection.close()
                for query in ["count=invalid", "count=", "ms=invalid", "ms=-1", "ms=nan", "ms=inf"]:
                    with self.subTest(query=query):
                        connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                        try:
                            connection.request("GET", "/fetch/api/resources/trickle.py?" + query)
                            response = connection.getresponse()
                            self.assertEqual(response.status, 500)
                            response.read()
                        finally:
                            connection.close()
    def test_fixture_server_delivers_fetch_trickle_headers_and_chunks_before_eof(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text("// testharness")
            headers_ready, chunk_ready = threading.Event(), threading.Event()
            release_first, release_second = threading.Event(), threading.Event()
            sleeps = []

            def pause(delay: float) -> None:
                sleeps.append(delay)
                if len(sleeps) == 2:
                    headers_ready.set()
                    self.assertTrue(release_first.wait(2))
                elif len(sleeps) == 3:
                    chunk_ready.set()
                    self.assertTrue(release_second.wait(2))

            with WptFixtureServer(root_path) as server, patch(
                "moli_benchmark.wpt_cross.server.time.sleep", side_effect=pause
            ):
                connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                try:
                    connection.request("GET", "/fetch/api/resources/trickle.py?count=2&notype")
                    response = connection.getresponse()
                    self.assertTrue(headers_ready.wait(2))
                    self.assertIsNone(response.headers.get("Content-Type"))
                    release_first.set()
                    self.assertEqual(response.read(13), b"TEST_TRICKLE\n")
                    self.assertTrue(chunk_ready.wait(2))
                    release_second.set()
                    self.assertEqual(response.read(), b"TEST_TRICKLE\n")
                    self.assertEqual(sleeps, [0.5] * 4)
                finally:
                    release_first.set()
                    release_second.set()
                    connection.close()
    def test_fixture_server_reads_upload_before_starting_fetch_trickle(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text("// testharness")
            started = threading.Event()
            with WptFixtureServer(root_path) as server, patch(
                "moli_benchmark.wpt_cross.server.time.sleep",
                side_effect=lambda _: started.set(),
            ):
                for framing, first, last in [
                    (b"Content-Length: 6", b"abc", b"def"),
                    (b"Transfer-Encoding: chunked", b"3\r\nabc\r\n", b"3\r\ndef\r\n0\r\n\r\n"),
                ]:
                    with self.subTest(framing=framing), socket.create_connection(("127.0.0.1", server.port), timeout=2) as connection:
                        started.clear()
                        connection.sendall(
                            b"POST /fetch/api/resources/trickle.py?count=1&ms=0 HTTP/1.1\r\n"
                            b"Host: localhost\r\n" + framing + b"\r\n\r\n" + first
                        )
                        self.assertFalse(started.wait(0.05), "response started before upload completed")
                        connection.sendall(last)
                        self.assertTrue(started.wait(2))
                        response = connection.makefile("rb").read()
                        self.assertEqual(response.split(b"\r\n\r\n", 1)[1], b"TEST_TRICKLE\n")
    def test_fixture_server_counts_link_stylesheet_requests_and_clears_on_read(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text("// testharness", encoding="utf-8")
            resource = "/html/semantics/document-metadata/the-link-element/stylesheet.py"
            fixture = root_path / resource.lstrip("/")
            fixture.parent.mkdir(parents=True)
            fixture.write_text("# dynamic stylesheet resource", encoding="utf-8")
            first = "11111111-1111-4111-8111-111111111111"
            second = "22222222-2222-4222-8222-222222222222"
            with WptFixtureServer(root_path) as server:
                def request(query: str, *, method: str = "GET", alternate: bool = False) -> tuple[str, bytes]:
                    port = server.alternate_port if alternate else server.port
                    url = f"http://127.0.0.1:{port}{resource}?{query}"
                    with urlopen(Request(url, method=method), timeout=2) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIsNone(response.headers.get("Cache-Control"))
                        return response.headers["Content-Type"], response.read()

                self.assertEqual(request(f"id={first}&count="), ("text/html", b"0"))
                self.assertEqual(request(f"id={first}"), ("text/css", b"body {color: red;}"))
                self.assertEqual(request(f"id={first}", alternate=True), ("text/css", b"body {color: red;}"))
                self.assertEqual(request(f"id={first}", method="HEAD"), ("text/css", b""))
                self.assertEqual(request(f"id={second}"), ("text/css", b"body {color: red;}"))
                self.assertEqual(request(f"id={first}&count=foo"), ("text/html", b"3"))
                self.assertEqual(request(f"id={second}&count=foo"), ("text/html", b"1"))
                self.assertEqual(request(f"id={first}&count=foo"), ("text/html", b"0"))
                self.assertEqual(request(f"id={first}"), ("text/css", b"body {color: red;}"))
                self.assertEqual(request(f"id={first}&count=foo"), ("text/html", b"1"))
