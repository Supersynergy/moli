from __future__ import annotations

from wpt_cross_test_support import *


class WptCrossHtmlReportsTests(WptCrossTestCase):
    def test_render_html_escapes_embedded_json_script_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "summary.json").write_text(
                json.dumps({"total": 1, "engines": {"moli": {"pass": 1}}}),
                encoding="utf-8",
            )
            (output_dir / "matrix.json").write_text(
                json.dumps(
                    [
                        {
                            "case_path": "xss.html",
                            "results": {
                                "moli": {
                                    "status": "</script><img src=x onerror=alert(1)>",
                                    "duration_ms": 1,
                                }
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            html = render_html(output_dir).read_text(encoding="utf-8")

        self.assertNotIn("</script><img", html)
        self.assertIn("\\u003c/script\\u003e", html)
    def test_render_html_includes_recorded_failure_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "summary.json").write_text(
                json.dumps(
                    {
                        "total": 1,
                        "engines": {"moli": {"fail": 1}, "chrome": {"fail": 1}},
                        "recorded_failure_drift": {
                            "primary": "moli",
                            "recorded_failure_limit_per_engine": 40,
                            "comparison_count": 1,
                            "comparisons": [
                                {
                                    "case_path": "WebCryptoAPI/shared.html",
                                    "primary": "moli",
                                    "peer": "chrome",
                                    "primary_only_count": 1,
                                    "peer_only_count": 0,
                                    "message_diff_count": 0,
                                    "primary_only_examples": ["lm-only"],
                                    "peer_only_examples": [],
                                    "message_diff_examples": [],
                                }
                            ],
                        },
                    }
                ),
                encoding="utf-8",
            )
            (output_dir / "matrix.json").write_text(
                json.dumps(
                    [
                        {
                            "case_path": "WebCryptoAPI/shared.html",
                            "results": {
                                "moli": {"status": "fail", "duration_ms": 1},
                                "chrome": {"status": "fail", "duration_ms": 1},
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            html = render_html(output_dir).read_text(encoding="utf-8")

        self.assertIn("Recorded subtest drift", html)
        self.assertIn("lm-only", html)
    def test_render_html_includes_known_failure_audit_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "summary.json").write_text(
                json.dumps(
                    {
                        "total": 1,
                        "engines": {"moli": {"fail": 1}},
                        "known_failure_audits": {
                            "moli": {
                                "ok": False,
                                "manifest": "known.json",
                                "output": "known-failure-audit-moli.json",
                                "counts": {
                                    "known_failures": 1,
                                    "resolved_known_failures": 1,
                                    "mismatched_known_failures": 0,
                                    "missing_expected_failures": 0,
                                    "skipped_known_failures": 2,
                                    "unexpected_failures": 0,
                                },
                                "category_counts": {
                                    "known_failures": {
                                        "wasm-global-live-binding": 1,
                                    }
                                },
                                "categories": {
                                    "wasm-global-live-binding": {
                                        "tracking_doc": "docs/wasm-global-live-binding-design-current.md",
                                        "scope": "V8-backed live binding work",
                                        "evidence": [
                                            {
                                                "kind": "doc",
                                                "path": "docs/wasm-global-live-binding-design-current.md",
                                                "note": "local fixture evidence",
                                            }
                                        ],
                                    }
                                },
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            (output_dir / "matrix.json").write_text(
                json.dumps(
                    [
                        {
                            "case_path": "wasm/example.html",
                            "results": {
                                "moli": {
                                    "status": "fail",
                                    "duration_ms": 1,
                                }
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            html = render_html(output_dir).read_text(encoding="utf-8")

        self.assertIn("Known-failure audit", html)
        self.assertIn("known-failure-audit-moli.json", html)
        self.assertIn("wasm-global-live-binding", html)
        self.assertIn("docs/wasm-global-live-binding-design-current.md", html)
        self.assertIn("V8-backed live binding work", html)
        self.assertIn("doc <code>docs/wasm-global-live-binding-design-current.md</code>", html)
        self.assertIn("local fixture evidence", html)
        self.assertIn("<th>skipped</th>", html)
        self.assertIn("<td>2</td>", html)
        self.assertIn(">attention<", html)
