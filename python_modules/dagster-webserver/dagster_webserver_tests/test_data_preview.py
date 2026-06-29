"""Unit tests for the asset data-preview helper.

Everything is exercised through the public ``fetch_table_preview`` entrypoint.
The Databricks SDK is stubbed so the tests never touch a real warehouse; the
stub records the issued statement and connection args so we can assert on the
system-generated query, row clamping, and caching behavior.
"""

import sys
import types

import pytest
from dagster_webserver.data_preview import PreviewError, fetch_table_preview


def _install_fake_databricks(monkeypatch, capture, *, columns, data, state="SUCCEEDED"):
    """Install a fake ``databricks.sdk`` exposing only the bits we call."""

    class _Col:
        def __init__(self, name, type_text):
            self.name = name
            self.type_text = type_text

    class _Schema:
        columns = [_Col(n, t) for n, t in columns]

    class _Manifest:
        schema = _Schema()

    class _State:
        value = state

    class _Status:
        state = _State()
        error = None

    class _Result:
        data_array = data

    class _Response:
        manifest = _Manifest()
        status = _Status()
        result = _Result()

    class _StatementExecution:
        def execute_statement(self, *, warehouse_id, statement, wait_timeout):
            capture["calls"] = capture.get("calls", 0) + 1
            capture["warehouse_id"] = warehouse_id
            capture["statement"] = statement
            capture["wait_timeout"] = wait_timeout
            return _Response()

    class _WorkspaceClient:
        def __init__(self, *, host, token):
            capture["host"] = host
            capture["token"] = token
            self.statement_execution = _StatementExecution()

    module = types.ModuleType("databricks")
    sdk = types.ModuleType("databricks.sdk")
    sdk.WorkspaceClient = _WorkspaceClient
    module.sdk = sdk
    monkeypatch.setitem(sys.modules, "databricks", module)
    monkeypatch.setitem(sys.modules, "databricks.sdk", sdk)

    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
    monkeypatch.setenv("DATABRICKS_TOKEN", "tok")
    monkeypatch.setenv("DATABRICKS_WAREHOUSE_ID", "wh123")


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "table",
        "schema.table",
        "cat.sch.tbl.extra",
        "cat.sch.tbl; DROP TABLE x",
        "cat.sch.tbl WHERE 1=1",
        "cat.sch.`tbl`",
        "cat.sch.tbl--",
        "cat.sch.tbl OR 1=1",
    ],
)
def test_rejects_malformed_or_injection_table(bad):
    # Validation happens before any warehouse access, so no stub is needed.
    with pytest.raises(PreviewError) as exc:
        fetch_table_preview(bad, 10)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "value,expected_limit",
    [
        (None, 100),
        ("not-a-number", 100),
        (5, 5),
        ("25", 25),
        (-3, 1),
        (0, 1),
        (10_000, 1000),
    ],
)
def test_row_count_is_clamped_into_the_query(monkeypatch, value, expected_limit):
    capture = {}
    _install_fake_databricks(monkeypatch, capture, columns=[("id", "INT")], data=[])
    # Distinct table per case keeps the module-level cache from interfering.
    table = f"c.s.clamp_{str(value).strip('-')}"
    fetch_table_preview(table, value)
    assert capture["statement"].endswith(f"LIMIT {expected_limit}")


def test_fetch_builds_backtick_quoted_limited_query(monkeypatch):
    capture = {}
    _install_fake_databricks(
        monkeypatch,
        capture,
        columns=[("id", "BIGINT"), ("name", "STRING")],
        data=[["1", "a"], ["2", "b"]],
    )
    out = fetch_table_preview("workspace.prod.sis_cases", 2)
    assert capture["statement"] == "SELECT * FROM `workspace`.`prod`.`sis_cases` LIMIT 2"
    assert capture["warehouse_id"] == "wh123"
    assert capture["host"] == "https://example.cloud.databricks.com"
    assert out["columns"] == [
        {"name": "id", "type": "BIGINT"},
        {"name": "name", "type": "STRING"},
    ]
    assert out["rowCount"] == 2
    assert out["truncated"] is True
    assert out["cached"] is False


def test_missing_env_raises_501(monkeypatch):
    capture = {}
    _install_fake_databricks(monkeypatch, capture, columns=[], data=[])
    monkeypatch.delenv("DATABRICKS_WAREHOUSE_ID", raising=False)
    with pytest.raises(PreviewError) as exc:
        fetch_table_preview("a.b.missing_env", 10)
    assert exc.value.status_code == 501
    assert "DATABRICKS_WAREHOUSE_ID" in str(exc.value)


def test_non_succeeded_state_raises_502(monkeypatch):
    capture = {}
    _install_fake_databricks(monkeypatch, capture, columns=[], data=[], state="FAILED")
    with pytest.raises(PreviewError) as exc:
        fetch_table_preview("a.b.failed_state", 10)
    assert exc.value.status_code == 502


def test_cache_hit_skips_second_query_and_version_busts_it(monkeypatch):
    capture = {}
    _install_fake_databricks(monkeypatch, capture, columns=[("id", "INT")], data=[["1"]])

    first = fetch_table_preview("a.b.cache_demo", 10, version=123)
    second = fetch_table_preview("a.b.cache_demo", 10, version=123)
    assert first["cached"] is False
    assert second["cached"] is True
    assert capture["calls"] == 1

    # A new version (fresh materialization) busts the cache and re-queries.
    fetch_table_preview("a.b.cache_demo", 10, version=456)
    assert capture["calls"] == 2
