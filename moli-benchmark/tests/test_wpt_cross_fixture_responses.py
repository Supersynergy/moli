from __future__ import annotations

from wpt_cross_test_support import *


class WptCrossFixtureResponsesTests(WptCrossTestCase):
    def test_fixture_server_parses_wpt_trickle_pipe_delay(self) -> None:
        self.assertEqual(_pipe_trickle_delay_seconds("pipe=trickle(d1)&cachebust=1"), 1.0)
        self.assertEqual(_pipe_trickle_delay_seconds("pipe=header(X,Y)|trickle(d2.5)"), 2.5)
        self.assertEqual(
            _pipe_trickle_delay_seconds("pipe=trickle(d3)&pipe=trickle(d1)"),
            1.0,
        )
        self.assertEqual(_pipe_trickle_delay_seconds("pipe=trickle(d999)"), 10.0)
        self.assertEqual(_pipe_trickle_delay_seconds("notpipe=trickle(d1)"), 0.0)

    def test_fixture_server_parses_delay_handler_duration(self) -> None:
        self.assertEqual(_wpt_delay_seconds("ms=3000"), 3.0)
        self.assertEqual(_wpt_delay_seconds("ms=2.5"), 0.0025)
        self.assertEqual(_wpt_delay_seconds("ms=250&ms=750"), 0.25)
        self.assertEqual(_wpt_delay_seconds(""), 0.5)
        self.assertIsNone(_wpt_delay_seconds("ms=invalid"))
        self.assertIsNone(_wpt_delay_seconds("ms=-1"))
        self.assertIsNone(_wpt_delay_seconds("ms=nan"))

    def test_fixture_server_models_xhr_delay_py_methods(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                with patch(
                    "moli_benchmark.wpt_cross.server.time.sleep"
                ) as sleep_mock:
                    url = f"{server.base_url}/xhr/resources/delay.py?ms=250"
                    responses = []
                    for method in ("GET", "HEAD", "POST", "OPTIONS", "YO"):
                        request = Request(
                            url,
                            data=b"upload" if method in {"POST", "YO"} else None,
                            method=method,
                        )
                        with urlopen(request, timeout=2) as response:
                            responses.append(
                                (
                                    method,
                                    response.status,
                                    response.read(),
                                    response.headers["Content-Type"],
                                    response.headers["Access-Control-Allow-Origin"],
                                    response.headers["Access-Control-Allow-Methods"],
                                )
                            )

        self.assertEqual(
            [call.args for call in sleep_mock.call_args_list],
            [(0.25,)] * 5,
        )
        self.assertEqual(
            responses,
            [
                ("GET", 200, b"TEST_DELAY", "text/plain", "*", "YO"),
                ("HEAD", 200, b"", "text/plain", "*", "YO"),
                ("POST", 200, b"TEST_DELAY", "text/plain", "*", "YO"),
                ("OPTIONS", 200, b"TEST_DELAY", "text/plain", "*", "YO"),
                ("YO", 200, b"TEST_DELAY", "text/plain", "*", "YO"),
            ],
        )

    def test_fixture_server_models_delayed_module_script_handler(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                with patch(
                    "moli_benchmark.wpt_cross.server.time.sleep"
                ) as sleep_mock:
                    url = (
                        f"{server.base_url}/html/semantics/scripting-1/"
                        "the-script-element/module/resources/"
                        "delayed-modulescript.py?ms=250"
                    )
                    responses = []
                    for method in ("GET", "HEAD"):
                        request = Request(url, method=method)
                        with urlopen(request, timeout=2) as response:
                            responses.append(
                                (
                                    method,
                                    response.status,
                                    response.read(),
                                    response.headers["Content-Type"],
                                )
                            )

        self.assertEqual(
            [call.args for call in sleep_mock.call_args_list],
            [(0.25,), (0.25,)],
        )
        self.assertEqual(
            responses,
            [
                (
                    "GET",
                    200,
                    b"export let delayedLoaded = true;",
                    "text/javascript",
                ),
                ("HEAD", 200, b"", "text/javascript"),
            ],
        )

    def test_fixture_server_models_common_redirect_opt_in_handler(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                connection.request(
                    "GET",
                    "/common/redirect-opt-in.py?status=307&location=%2Ftarget",
                )
                response = connection.getresponse()
                self.assertEqual(response.status, 307)
                self.assertEqual(response.headers.get("Location"), "/target")
                self.assertEqual(response.headers.get("Timing-Allow-Origin"), "*")
                connection.close()

    def test_fixture_server_drains_xhr_delay_yo_body_before_next_request(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            server = WptFixtureServer(root_path)
            server.httpd.RequestHandlerClass.protocol_version = "HTTP/1.1"
            with server, patch(
                "moli_benchmark.wpt_cross.server.time.sleep"
            ):
                connection = HTTPConnection("localhost", server.port, timeout=2)
                try:
                    path = "/xhr/resources/delay.py?ms=0"
                    connection.request("YO", path, body=b"upload")
                    first = connection.getresponse()
                    self.assertEqual(
                        (first.status, first.read()),
                        (200, b"TEST_DELAY"),
                    )
                    first_socket = connection.sock

                    connection.request("GET", path)
                    second = connection.getresponse()
                    self.assertEqual(
                        (second.status, second.read()),
                        (200, b"TEST_DELAY"),
                    )
                    self.assertIs(connection.sock, first_socket)
                finally:
                    connection.close()

    def test_fixture_server_drains_chunked_xhr_delay_body_before_next_request(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            server = WptFixtureServer(root_path)
            server.httpd.RequestHandlerClass.protocol_version = "HTTP/1.1"
            with server, patch(
                "moli_benchmark.wpt_cross.server.time.sleep"
            ):
                connection = HTTPConnection("localhost", server.port, timeout=2)
                try:
                    path = "/xhr/resources/delay.py?ms=0"
                    connection.request(
                        "POST",
                        path,
                        body=[b"chunk-one", b"chunk-two"],
                        encode_chunked=True,
                    )
                    first = connection.getresponse()
                    self.assertEqual(
                        (first.status, first.read()),
                        (200, b"TEST_DELAY"),
                    )
                    first_socket = connection.sock

                    connection.request("GET", path)
                    second = connection.getresponse()
                    self.assertEqual(
                        (second.status, second.read()),
                        (200, b"TEST_DELAY"),
                    )
                    self.assertIs(connection.sock, first_socket)
                finally:
                    connection.close()

    def test_fixture_server_parses_wpt_header_pipe(self) -> None:
        def applied_pipe_headers(query: str) -> list[tuple[str, str]]:
            return _apply_header_operations(
                [], _pipe_response_header_operations(query)
            )

        self.assertEqual(
            applied_pipe_headers(
                "pipe=header(Access-Control-Allow-Origin,*)|header(X-Test,ok)"
            ),
            [("Access-Control-Allow-Origin", "*"), ("X-Test", "ok")],
        )
        self.assertEqual(
            applied_pipe_headers(
                "pipe=header(Content-Security-Policy,first)"
                "|header(Content-Security-Policy,second,True)"
            ),
            [
                ("Content-Security-Policy", "first"),
                ("Content-Security-Policy", "second"),
            ],
        )
        self.assertEqual(
            applied_pipe_headers(
                "pipe=header(Content-Security-Policy,first)"
                "|header(Content-Security-Policy,second,False)"
            ),
            [("Content-Security-Policy", "second")],
        )
        self.assertEqual(applied_pipe_headers("pipe=header(Bad Header,ok)"), [])
        self.assertEqual(
            applied_pipe_headers("pipe=header(X-Test,bad%0D%0AInjected:%20x)"),
            [("X-Test", "bad  Injected: x")],
        )
        self.assertEqual(applied_pipe_headers("notpipe=header(X,Y)"), [])

    def test_fixture_server_parses_wpt_status_pipe(self) -> None:
        self.assertEqual(_pipe_response_status("pipe=status(204)&cachebust=1"), 204)
        self.assertEqual(
            _pipe_response_status("pipe=header(X,Y)|status(205)"),
            205,
        )
        self.assertEqual(
            _pipe_response_status("pipe=status(204)&pipe=status(205)"),
            205,
        )
        self.assertIsNone(_pipe_response_status("pipe=status(099)"))
        self.assertIsNone(_pipe_response_status("pipe=status(600)"))
        self.assertIsNone(_pipe_response_status("notpipe=status(204)"))

    def test_fixture_server_parses_wpt_headers_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            fixture = Path(root) / "case.html"
            fixture.write_text("<!doctype html>", encoding="utf-8")
            fixture.with_name("case.html.headers").write_text(
                "Referrer-Policy: no-referrer\n"
                "Bad Header: skip\n"
                "X-Test: ok\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _sidecar_response_headers(fixture),
                [("Referrer-Policy", "no-referrer"), ("X-Test", "ok")],
            )

    def test_fixture_server_parses_sub_headers_sidecar_for_sub_files(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            fixture = Path(root) / "worker.sub.js"
            fixture.write_text("// worker", encoding="utf-8")
            fixture.with_name("worker.sub.js.sub.headers").write_text(
                "Content-Security-Policy: connect-src 'none'\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _sidecar_response_headers(fixture),
                [("Content-Security-Policy", "connect-src 'none'")],
            )

    def test_fixture_server_combines_immediate_directory_and_file_headers(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            fixture_dir = root_path / "support"
            fixture_dir.mkdir()
            fixture = fixture_dir / "ufoo"
            fixture.write_text("ufoo", encoding="utf-8")
            fixture_dir.joinpath("__dir__.headers").write_text(
                "Content-Type: text/html\nX-Directory: immediate\n",
                encoding="utf-8",
            )
            fixture.with_name("ufoo.headers").write_text(
                "X-File: exact\n",
                encoding="utf-8",
            )
            root_path.joinpath("__dir__.headers").write_text(
                "X-Directory: parent\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _sidecar_response_headers(fixture),
                [
                    ("Content-Type", "text/html"),
                    ("X-Directory", "immediate"),
                    ("X-File", "exact"),
                ],
            )

    def test_fixture_server_prefers_file_sub_headers_when_both_exist(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            fixture = Path(root) / "case.sub.html"
            fixture.write_text("<!doctype html>", encoding="utf-8")
            fixture.with_name("case.sub.html.headers").write_text(
                "X-Source: plain\n",
                encoding="utf-8",
            )
            fixture.with_name("case.sub.html.sub.headers").write_text(
                "X-Source: substituted\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _sidecar_response_headers(fixture),
                [("X-Source", "substituted")],
            )

    def test_fixture_server_prefers_directory_sub_headers_when_both_exist(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            fixture = root_path / "case.html"
            fixture.write_text("<!doctype html>", encoding="utf-8")
            root_path.joinpath("__dir__.headers").write_text(
                "X-Source: plain\n",
                encoding="utf-8",
            )
            root_path.joinpath("__dir__.sub.headers").write_text(
                "X-Source: substituted\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _sidecar_response_headers(fixture),
                [("X-Source", "substituted")],
            )

    def test_fixture_server_content_type_sidecar_overrides_static_guess(self) -> None:
        content_type, headers = _response_content_type_and_extra_headers(
            "application/octet-stream",
            [
                ("Content-Type", "text/javascript; charset=utf-8"),
                ("X-Test", "ok"),
            ],
        )

        self.assertEqual(content_type, "text/javascript; charset=utf-8")
        self.assertEqual(headers, [("X-Test", "ok")])

    def test_fixture_server_combines_sidecar_and_pipe_headers_for_static_responses(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as root:
            fixture = Path(root) / "feature.any.js"
            fixture.write_text("// test", encoding="utf-8")
            fixture.with_name("feature.any.js.headers").write_text(
                "Content-Security-Policy: script-src 'self'\n",
                encoding="utf-8",
            )

            self.assertEqual(
                _static_response_headers(fixture, "pipe=header(X-Test,ok)"),
                [
                    ("Content-Security-Policy", "script-src 'self'"),
                    ("X-Test", "ok"),
                ],
            )
            self.assertEqual(
                _static_response_headers(
                    fixture,
                    "pipe=header(Content-Security-Policy,script-src 'none',False)",
                ),
                [("Content-Security-Policy", "script-src 'none'")],
            )
            self.assertEqual(
                _static_response_headers(
                    fixture,
                    "pipe=header(Content-Security-Policy,require-trusted-types-for 'script',True)",
                ),
                [
                    ("Content-Security-Policy", "script-src 'self'"),
                    (
                        "Content-Security-Policy",
                        "require-trusted-types-for 'script'",
                    ),
                ],
            )

    def test_fixture_server_reads_sub_headers_for_plain_static_resource(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            fixture = Path(root) / "policy.html"
            fixture.write_text("<!doctype html>", encoding="utf-8")
            fixture.with_name("policy.html.sub.headers").write_text(
                "Set-Cookie: policy={{$id:uuid()}}\n"
                "Content-Security-Policy: frame-src 'none'; report-uri /report.py?reportID={{$id}}\n",
                encoding="utf-8",
            )

            headers = _static_response_headers(fixture, "", port=8000)

        self.assertEqual(len(headers), 2)
        cookie_value = headers[0][1].removeprefix("policy=")
        self.assertEqual(headers[0][0], "Set-Cookie")
        self.assertNotIn("{{", cookie_value)
        self.assertEqual(
            headers[1],
            (
                "Content-Security-Policy",
                f"frame-src 'none'; report-uri /report.py?reportID={cookie_value}",
            ),
        )

    def test_fixture_server_validates_form_submission_entity_bodies(self) -> None:
        def multipart(*parts: bytes) -> bytes:
            return (
                b"--form-boundary\r\n"
                + b"\r\n--form-boundary\r\n".join(parts)
                + b"\r\n--form-boundary--\r\n"
            )

        foo = b'Content-Disposition: form-data; name="foo"\r\n\r\nbar'
        wrong_foo = b'Content-Disposition: form-data; name="foo"\r\n\r\nwrong'
        multipart_type = 'multipart/form-data; boundary="form-boundary"'
        cases = [
            ("query=1", "application/x-www-form-urlencoded", b"foo=bara", b"OK"),
            ("query=1", "application/x-www-form-urlencoded", b"foo=bar", b"FAIL"),
            ("query=1", "application/x-www-form-urlencoded", b"foo=ba%72a", b"FAIL"),
            ("query=1", "application/x-www-form-urlencoded", b"foo=bara&extra=1", b"FAIL"),
            ("query=1", "application/x-www-form-urlencoded; charset=UTF-8", b"foo=bar", b"OK"),
            ("query=1", "text/plain", b"qux=baz\r\n", b"OK"),
            ("query=1", "text/plain", b"qux=baz\n", b"FAIL"),
            ("query=1", multipart_type, multipart(foo), b"OK"),
            ("query=1", multipart_type, multipart(foo, wrong_foo), b"OK"),
            ("query=1", multipart_type, multipart(wrong_foo, foo), b"FAIL"),
            ("query=1", multipart_type, multipart(foo.replace(b'"foo"', b'"other"')), b"FAIL"),
            (
                "query=1",
                multipart_type,
                multipart(foo.replace(b'name="foo"', b'name="foo"; filename="field.txt"')),
                b"FAIL",
            ),
            (
                "query=1",
                multipart_type,
                multipart(b'Content-Disposition: form-data; name="foo"\r\nContent-Transfer-Encoding: base64\r\n\r\nYmFy'),
                b"FAIL",
            ),
            ("query=1", "multipart/form-data; boundary=wrong", multipart(foo), b"FAIL"),
            ("query=1", "multipart/form-data", multipart(foo), b"FAIL"),
            ("query=1", "Multipart/Form-Data; boundary=form-boundary", multipart(foo), b"FAIL"),
            (
                "expected_body=foo.x%3D0%26foo.y%3D0",
                "application/x-www-form-urlencoded",
                b"foo.x=0&foo.y=0",
                b"OK",
            ),
            (
                "expected_body=foo.x%3D0%26foo.y%3D0",
                "application/x-www-form-urlencoded",
                b"foo.x=1&foo.y=0",
                b"FAIL",
            ),
            ("expected_body=%E9%9B%AA", "text/plain", "雪".encode("utf-8"), b"OK"),
            ("expected_body=wrong&expected_body=right", "text/plain", b"right", b"OK"),
            (
                "query=1&expected_body=wrong",
                "application/x-www-form-urlencoded",
                b"foo=bara",
                b"OK",
            ),
            ("expected_body=", "text/plain", b"", b"FAIL"),
            ("", "application/x-www-form-urlencoded", b"foo=bara", b"FAIL"),
        ]
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text("// testharness")
            with WptFixtureServer(root_path) as server:
                url = (
                    f"{server.base_url}/html/semantics/forms/"
                    "form-submission-0/resources/form-submission.py"
                )
                for query, content_type, body, expected in cases:
                    with self.subTest(query=query, content_type=content_type, body=body):
                        request = Request(
                            f"{url}?{query}",
                            data=body,
                            headers={"Content-Type": content_type},
                        )
                        with urlopen(request, timeout=2) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers["Content-Type"], "text/plain")
                            self.assertEqual(response.read(), expected)

                for method in ("GET", "HEAD"):
                    with self.subTest(method=method):
                        with urlopen(Request(url, method=method), timeout=2) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers["Content-Type"], "text/plain")
                            self.assertEqual(response.headers["Content-Length"], "4")
                            self.assertEqual(
                                response.read(), b"FAIL" if method == "GET" else b""
                            )

    def test_fixture_server_models_fetch_inspect_headers_handler(self) -> None:
        self.assertEqual(
            _inspect_headers_response_headers(
                "headers=referer%7Corigin%7Cmissing&cors&allow_headers=x-test",
                [
                    ("Referer", "http://source.test/path"),
                    ("Origin", "http://origin.test"),
                    ("X-Test", "value"),
                ],
            ),
            [
                ("x-request-referer", "http://source.test/path"),
                ("x-request-origin", "http://origin.test"),
                ("Access-Control-Allow-Origin", "http://origin.test"),
                ("Access-Control-Allow-Credentials", "true"),
                ("Access-Control-Allow-Methods", "GET, POST, HEAD"),
                (
                    "Access-Control-Expose-Headers",
                    "x-request-referer, x-request-origin, x-request-missing",
                ),
                ("Access-Control-Allow-Headers", "x-test"),
            ],
        )

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                url = (
                    f"{server.base_url}/fetch/api/resources/"
                    "inspect-headers.py?headers=referer%7Corigin&cors"
                )
                request = Request(
                    url,
                    headers={
                        "Referer": "http://source.test/path",
                        "Origin": "http://origin.test",
                    },
                )
                with urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), b"")
                    self.assertEqual(
                        response.headers["x-request-referer"],
                        "http://source.test/path",
                    )
                    self.assertEqual(
                        response.headers["x-request-origin"],
                        "http://origin.test",
                    )
                    self.assertEqual(
                        response.headers["Access-Control-Allow-Origin"],
                        "http://origin.test",
                    )
                    self.assertEqual(
                        response.headers["Access-Control-Expose-Headers"],
                        "x-request-referer, x-request-origin",
                    )

    def test_fixture_server_models_worker_url_utf8_query_check(self) -> None:
        self.assertEqual(_workers_url_encoding_response("x=%C3%A5"), b"PASS")
        self.assertEqual(_workers_url_encoding_response("x=%C3%A5&x=wrong"), b"PASS")
        self.assertEqual(_workers_url_encoding_response("x=%C3%83%C2%A5"), b"FAIL")
        self.assertEqual(_workers_url_encoding_response("x=%E5"), b"FAIL")
        self.assertEqual(_workers_url_encoding_response(""), b"FAIL")

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                url = (
                    f"{server.base_url}/workers/semantics/encodings/"
                    "003-1.py?x=%C3%A5"
                )
                responses = []
                for method in ("GET", "HEAD"):
                    with urlopen(Request(url, method=method), timeout=2) as response:
                        responses.append(
                            (
                                method,
                                response.status,
                                response.read(),
                                response.headers["Content-Type"],
                            )
                        )

        self.assertEqual(
            responses,
            [
                ("GET", 200, b"PASS", "text/plain; charset=utf-8"),
                ("HEAD", 200, b"", "text/plain; charset=utf-8"),
            ],
        )

    def test_fixture_server_models_form_echo_handler(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                url = (
                    f"{server.base_url}/html/semantics/forms/"
                    "form-submission-0/form-echo.py"
                )
                responses = []
                for method, body in (
                    ("GET", None),
                    ("HEAD", None),
                    ("POST", b"\x00\x09\x7f\x80\xff"),
                ):
                    request = Request(url, data=body, method=method)
                    with urlopen(request, timeout=2) as response:
                        responses.append(
                            (
                                method,
                                response.status,
                                response.read(),
                                response.headers["Content-Type"],
                            )
                        )

        self.assertEqual(
            responses,
            [
                ("GET", 200, b"", "text/plain"),
                ("HEAD", 200, b"", "text/plain"),
                ("POST", 200, b"00 09 7f 80 ff", "text/plain"),
            ],
        )

    def test_fixture_server_models_fetch_nosniff_javascript_handler(self) -> None:
        self.assertEqual(
            _nosniff_javascript_response(""),
            (
                None,
                b"// nothing to see here\nlog('FAIL: Content-Type missing')",
            ),
        )
        self.assertEqual(
            _nosniff_javascript_response("type=text%2Fjavascript&outcome=p"),
            ("text/javascript", b"// nothing to see here\np()"),
        )

        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                base_url = f"{server.base_url}/fetch/nosniff/resources/js.py"
                responses = []
                for query in (
                    "",
                    "?type=",
                    "?type=text%2Fjavascript&outcome=p",
                ):
                    with urlopen(base_url + query, timeout=2) as response:
                        responses.append(
                            (
                                response.headers.get("Content-Type"),
                                response.headers["X-Content-Type-Options"],
                                response.read(),
                            )
                        )

        self.assertEqual(
            responses,
            [
                (
                    None,
                    "nosniff",
                    b"// nothing to see here\nlog('FAIL: Content-Type missing')",
                ),
                ("", "nosniff", b"// nothing to see here\nlog('FAIL: ')"),
                ("text/javascript", "nosniff", b"// nothing to see here\np()"),
            ],
        )

    def test_fixture_server_models_dynamic_import_redirect_without_cors(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            (root_path / "resources").mkdir()
            (root_path / "resources" / "testharness.js").write_text(
                "// testharness", encoding="utf-8"
            )
            with WptFixtureServer(root_path) as server:
                for method in ("GET", "HEAD"):
                    for query, status, location in (
                        ("location=%2Ftarget", 302, "/target"),
                        (
                            "status=307&location=https%3A%2F%2Fexample.test%2Fx",
                            307,
                            "https://example.test/x",
                        ),
                        ("status=invalid&location=%2Ftarget", 302, "/target"),
                        (
                            "status=302&status=307&location=%2Fa&location=%2Fb",
                            302,
                            "/a",
                        ),
                    ):
                        with self.subTest(method=method, query=query):
                            connection = HTTPConnection("127.0.0.1", server.port, timeout=2)
                            try:
                                connection.request(
                                    method,
                                    "/html/semantics/scripting-1/the-script-element/module/"
                                    f"dynamic-import/beta/redirect.py?{query}",
                                )
                                response = connection.getresponse()
                                self.assertEqual(response.status, status)
                                self.assertEqual(response.headers.get("Location"), location)
                                self.assertIsNone(
                                    response.headers.get("Access-Control-Allow-Origin")
                                )
                                self.assertEqual(response.read(), b"")
                            finally:
                                connection.close()
