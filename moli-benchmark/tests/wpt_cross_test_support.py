from __future__ import annotations

import asyncio
import hashlib
import io
import json
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.client import HTTPConnection
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from urllib.request import Request, urlopen

from PIL import Image

from moli_benchmark.config import clear_current_proxy_env
from moli_benchmark.raw_cdp import RawCdpError
from moli_benchmark.wpt_cross.__main__ import (
    CASE_LIST_FILES,
    WPT_CROSS_CASE_TIMEOUT_SECONDS,
    WPT_CROSS_PARALLELISM,
    _build_parser,
    _case_requires_non_trustworthy_origin,
    _case_requires_trustworthy_origin,
    _deduplicate_cases,
    _harness_timeout_multiplier,
    _is_full_case_list_run,
    _recorded_failure_drift,
    _url_for_case_origin,
    _write_repo_case_lists,
    main,
)
from moli_benchmark.wpt_cross.build_partial import main as build_partial_main
from moli_benchmark.wpt_cross.case_set import (
    ANY_JS_WINDOW_QUERY,
    WINDOW_JS_WINDOW_QUERY,
    any_js_window_case_path,
    DEFAULT_EXCLUDE_DIR_PREFIXES,
    FuzzyTolerance,
    LAYOUT_PROFILE_DIR_PREFIXES,
    LONG_TIMEOUT_MULTIPLIER,
    ReftestReference,
    WptCase,
    enumerate_cases,
    enumerate_reftest_cases,
    explicit_reftest_case,
    explicit_case,
    parse_any_js_meta,
    window_js_window_case_path,
)
from moli_benchmark.wpt_cross.engine import (
    _moli_command,
    _moli_fetch,
    _lightpanda_fetch,
)
from moli_benchmark.wpt_cross.cli_runner import (
    MOLI_WPT_USER_AGENT,
    _CliCaseWorkerInput,
    _CliSubprocessResult,
    _classify_cli_case_result,
    _moli_fixture_host_resolve_args,
    _nonzero_exit_status,
    _payload_from_stdout_html,
    _payload_grace_for_process_result,
    _run_cli_case_worker,
    _stderr_tail,
    run_engine_on_cases_cli,
)
from moli_benchmark.wpt_cross.any_js import (
    ANY_JS_DEDICATED_WORKER_GLOBAL,
    ANY_JS_WINDOW_GLOBAL,
    any_js_case_path_for_global,
    any_js_source_script_path,
    any_js_worker_script_path,
)
from moli_benchmark.wpt_cross.render_html import render_html
from moli_benchmark.wpt_cross.runner import (
    _AttachedPage,
    _PageSessionUnusable,
    _ReftestEvidence,
    _close_page,
    _has_navigation_evidence,
    _navigation_identity,
    _normalized_case_path,
    _normalized_navigation_url,
    _run_async,
    _run_one_case,
    _write_reftest_failure_artifacts,
    CapturedScreenshot,
    CaseResult,
    EngineRunResult,
    LAYOUT_VIEWPORT,
    ReftestReferenceRun,
    ReftestRun,
    case_result_to_dict,
    classify_payload,
    compare_reftest_screenshots,
    reftest_comparisons_pass,
    reftest_relation_passes,
)
from moli_benchmark.wpt_cross.scheduler import (
    FIXED_RUN_SHUFFLE_SEED,
    build_run_schedule,
)
from moli_benchmark.wpt_cross.server import (
    BENCH_REPORT_BRIDGE,
    BENCH_TESTDRIVER_VENDOR_BRIDGE,
    BENCH_TIMEOUT_MULTIPLIER_QUERY,
    WptFixtureServer,
    ResultsStore,
    _apply_header_operations,
    _any_js_window_wrapper,
    _bench_report_bridge,
    _content_security_policy_resource_response,
    _workers_modules_export_on_load_script_response,
    _inject_bench_report_bridge_config,
    _host_header_hostname,
    _headers_include,
    _inspect_headers_response_headers,
    _fetch_status_response,
    _normalize_harness_case_key,
    _nosniff_javascript_response,
    _needs_wpt_template_substitution,
    _legacy_wpt_resource_alias,
    _pipe_response_header_operations,
    _pipe_response_status,
    _pipe_trickle_delay_seconds,
    _redirect_fixture_response,
    _response_content_type_and_extra_headers,
    _resolve_wpt_static_script_url,
    _sidecar_response_headers,
    _static_response_header_block,
    _static_response_headers,
    _substitute_wpt_template_variables,
    _window_js_window_wrapper,
    _wasm_webapi_status_code,
    _workers_url_encoding_response,
    _wpt_delay_seconds,
    _wpt_dedicated_worker_js_wrapper_html,
    _wpt_any_dedicated_worker_wrapper_html,
    _wpt_any_dedicated_worker_wrapper_js,
    _wpt_any_window_wrapper_html,
    _wpt_window_js_wrapper_html,
)


# WPT fixture tests use loopback servers; inherited shell proxies can intercept
# urllib requests to those servers, so normalize the script process once.
clear_current_proxy_env()


class WptCrossTestCase(unittest.TestCase):
        def _run_wpt_cross_with_fake_moli(
            self,
            *,
            output_dir: Path,
            known_failures: Path,
            case_status: str,
            failure_message: str = "expected 555 but got 100",
            allow_missing_known_failures: bool = False,
            extra_args: list[str] | None = None,
        ) -> int:
            class FakeServer:
                def __init__(self, wpt_root: Path, *, primary_hostname: str) -> None:
                    assert primary_hostname == "web-platform.localhost"
                    self.wpt_root = Path(wpt_root)
                    self.base_url = "http://127.0.0.1:8000"
                    self.alternate_base_url = "http://127.0.0.1:8001"
                    self.external_base_url = None
                    self.external_alternate_base_url = None
                    self.external_remote_base_url = None
                    self.external_host = None

                def __enter__(self) -> "FakeServer":
                    return self

                def __exit__(self, *args: object) -> None:
                    return None

                def set_harness_timeout_multipliers(
                    self,
                    multipliers: dict[str, float],
                    *,
                    default_multiplier: float,
                ) -> None:
                    return None

                def url_for_case(self, case_path: str, *, external: bool = False) -> str:
                    return f"{self.base_url}/{case_path}"

            failures = []
            if case_status != "pass":
                failures = [{"name": "subtest", "message": failure_message}]
            result_dict = {
                "engine": "moli",
                "binary": "/tmp/moli",
                "binary_sha256": "sha",
                "binary_version": "0.1.0",
                "endpoint": "cli:/tmp/moli",
                "ready_ms": None,
                "setup_error": None,
                "cases": [
                    {
                        "case_path": "known.html",
                        "status": case_status,
                        "duration_ms": 1.0,
                        "subtests": {
                            "total": 1,
                            "pass": int(case_status == "pass"),
                            "fail": int(case_status != "pass"),
                            "timeout": 0,
                            "notrun": 0,
                        },
                        "failures": failures,
                        "harness_status_name": "OK",
                        "harness_message": (
                            "Harness completed with a tracked message"
                            if case_status != "pass"
                            else None
                        ),
                        "error": None,
                    }
                ],
            }
            with (
                patch(
                    "moli_benchmark.wpt_cross.__main__.enumerate_cases",
                    return_value=[WptCase("known.html")],
                ),
                patch(
                    "moli_benchmark.wpt_cross.__main__.build_driver",
                    return_value=SimpleNamespace(cli_fetch_command=["moli"]),
                ),
                patch(
                    "moli_benchmark.wpt_cross.__main__.run_engine_on_cases_cli",
                    return_value=SimpleNamespace(setup_error=None),
                ),
                patch(
                    "moli_benchmark.wpt_cross.__main__.engine_result_to_dict",
                    return_value=result_dict,
                ),
                patch("moli_benchmark.wpt_cross.server.WptFixtureServer", FakeServer),
                patch(
                    "moli_benchmark.wpt_cross.__main__.REPO_CASE_LIST_DIR",
                    output_dir.parent / "repo-case-lists",
                ),
                redirect_stdout(StringIO()),
                redirect_stderr(StringIO()),
            ):
                args = [
                    "--wpt-root",
                    "/tmp/wpt",
                    "--engine",
                    "moli",
                    "--output-dir",
                    str(output_dir),
                    "--known-failures",
                    str(known_failures),
                ]
                if allow_missing_known_failures:
                    args.append("--allow-missing-known-failures")
                if extra_args is not None:
                    args.extend(extra_args)
                return main(args)


__all__ = [name for name in globals() if not name.startswith("__")]
