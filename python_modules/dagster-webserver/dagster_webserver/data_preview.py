"""Live table preview for the asset "Data preview" tab.

The webserver process already holds the tenant's Databricks credentials in its
environment (``DATABRICKS_HOST`` / ``DATABRICKS_TOKEN`` / ``DATABRICKS_WAREHOUSE_ID``),
so a thin preview can be served from here without standing up a separate read
API. The query is **system-generated** — never user-supplied SQL: the caller
provides a fully-qualified ``catalog.schema.table`` whose three identifiers are
validated to word characters, then backtick-quoted into a single bounded
``SELECT * ... LIMIT n``. Results are cached per ``(table, rows, version)`` where
``version`` is the asset's latest-materialization timestamp (so a fresh build
shows fresh data), with a short TTL fallback when no materialization is known.
"""

import os
import re
import time

# Identifiers are validated to this character class, which is what makes the
# backtick-quoting below injection-safe. Do not loosen without re-quoting.
_IDENT = re.compile(r"^[A-Za-z0-9_]+$")

# DLT data-quality expectations declared on the table:
#   @dp.expect_or_fail("name", "condition")
_EXPECTATION = re.compile(
    r"@dp\.(expect(?:_or_fail|_or_drop)?)\(\s*\"([^\"]+)\"\s*,\s*\"([^\"]+)\""
)
_EXPECTATION_ACTION = {
    "expect": "warn",
    "expect_or_drop": "drop",
    "expect_or_fail": "fail",
}

_DEFAULT_ROWS = 100
_MAX_ROWS = 1000
_CACHE_TTL_SECONDS = 60.0
_STATEMENT_WAIT_TIMEOUT = "50s"

# Local checkout of the databricks-transforms bundle that holds the real source
# for each table. Supplied per tenant via DATABRICKS_BUNDLE_PATH (the same env the
# code-server already uses); when unset, the source/schedule features no-op.
_BUNDLE_PATH = os.getenv("DATABRICKS_BUNDLE_PATH", "")
_LANG_BY_EXT = {".py": "python", ".sql": "sql", ".scala": "scala"}
# Each top-level bundle directory is refreshed by a single Lakeflow trigger job.
_SCHEDULE_JOB_BY_PREFIX = {
    "claims_landing": "claims_landing_schedule",
    "cms_landing": "cms_landing_schedule",
    "sis": "sis_landing_schedule",
}

# (table, rows, version) -> (cached_at_monotonic, payload)
_CACHE: dict[tuple[str, int, object | None], tuple[float, dict]] = {}


class PreviewError(Exception):
    """A preview failure with an HTTP status to surface to the client."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _parse_table(table: str | None) -> tuple[str, str, str]:
    parts = (table or "").split(".")
    if len(parts) != 3 or not all(_IDENT.match(part) for part in parts):
        raise PreviewError(
            "`table` must be a fully-qualified 'catalog.schema.table'; each part may "
            "contain only letters, digits, and underscores."
        )
    return parts[0], parts[1], parts[2]


def _clamp_rows(n: object) -> int:
    try:
        rows = int(n)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return _DEFAULT_ROWS
    return max(1, min(_MAX_ROWS, rows))


def fetch_table_preview(
    table: str | None,
    n: object = None,
    *,
    version: object | None = None,
) -> dict:
    """Return a bounded preview of ``table`` as ``{columns, rows, ...}``.

    ``version`` participates in the cache key (typically the asset's latest
    materialization timestamp) so that a new build invalidates stale rows.
    """
    catalog, schema, name = _parse_table(table)
    rows = _clamp_rows(_DEFAULT_ROWS if n is None else n)
    qualified = f"{catalog}.{schema}.{name}"

    cache_key = (qualified, rows, version)
    cached = _CACHE.get(cache_key)
    now = time.monotonic()
    # A known version is a strong key (only changes when the table rebuilds), so
    # trust it indefinitely; otherwise fall back to a short TTL.
    if cached and (version is not None or now - cached[0] < _CACHE_TTL_SECONDS):
        return {**cached[1], "cached": True}

    payload = _run_query(catalog, schema, name, rows)
    _CACHE[cache_key] = (now, payload)
    return {**payload, "cached": False}


def _run_query(catalog: str, schema: str, name: str, rows: int) -> dict:
    try:
        from databricks.sdk import WorkspaceClient
    except ImportError:
        raise PreviewError(
            "Live preview requires the `databricks-sdk` package in the webserver environment.",
            status_code=501,
        )

    host = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")
    warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID")
    missing = [
        key
        for key, value in (
            ("DATABRICKS_HOST", host),
            ("DATABRICKS_TOKEN", token),
            ("DATABRICKS_WAREHOUSE_ID", warehouse_id),
        )
        if not value
    ]
    if missing:
        raise PreviewError(
            "Live preview is not configured: missing "
            f"{', '.join(missing)} in the webserver environment.",
            status_code=501,
        )

    client = WorkspaceClient(host=host, token=token)
    # Identifiers are validated to ^[A-Za-z0-9_]+$ in _parse_table, so
    # backtick-quoting here cannot be escaped. Never interpolate untrusted text.
    statement = f"SELECT * FROM `{catalog}`.`{schema}`.`{name}` LIMIT {rows}"
    response = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout=_STATEMENT_WAIT_TIMEOUT,
    )

    status = getattr(response, "status", None)
    state = getattr(status, "state", None)
    state_str = getattr(state, "value", None) or (str(state) if state is not None else None)
    if state_str and state_str != "SUCCEEDED":
        error_message = getattr(getattr(status, "error", None), "message", None)
        raise PreviewError(
            f"Databricks query did not succeed (state={state_str})"
            + (f": {error_message}" if error_message else ""),
            status_code=502,
        )

    columns: list[dict] = []
    manifest = getattr(response, "manifest", None)
    manifest_schema = getattr(manifest, "schema", None) if manifest else None
    if manifest_schema and manifest_schema.columns:
        columns = [
            {
                "name": column.name,
                "type": getattr(column, "type_text", None) or getattr(column, "type_name", None),
            }
            for column in manifest_schema.columns
        ]

    data = response.result.data_array if response.result and response.result.data_array else []

    return {
        "table": f"{catalog}.{schema}.{name}",
        "query": statement,
        "columns": columns,
        "rows": data,
        "rowCount": len(data),
        "limit": rows,
        "truncated": len(data) >= rows,
    }


# --- full-file source + schedule (read from the local bundle checkout) -------


def _relpath_from_github_url(url: str) -> tuple[str, int | None]:
    """Parse a GitHub blob URL into (repo-relative path, line number).

    e.g. https://github.com/o/r/blob/main/sis/silver/build_x.py#L223
         -> ("sis/silver/build_x.py", 223)
    """
    marker = "/blob/"
    idx = url.find(marker)
    if idx == -1:
        raise PreviewError("Unrecognized code-reference URL.", status_code=400)
    rest = url[idx + len(marker) :]
    body, _, anchor = rest.partition("#")
    line_number: int | None = None
    if anchor.startswith("L"):
        try:
            line_number = int(anchor[1:].split("-", 1)[0])
        except ValueError:
            line_number = None
    # body is "<branch>/<relpath>"; drop the branch segment.
    _, _, relpath = body.partition("/")
    return relpath, line_number


def _safe_bundle_path(relpath: str) -> str:
    base = os.path.realpath(_BUNDLE_PATH)
    target = os.path.realpath(os.path.join(base, relpath))
    if target != base and not target.startswith(base + os.sep):
        raise PreviewError("Resolved path escapes the bundle.", status_code=400)
    return target


def _schedule_for_relpath(relpath: str) -> dict | None:
    prefix = relpath.split("/", 1)[0]
    job_name = _SCHEDULE_JOB_BY_PREFIX.get(prefix)
    if not job_name:
        return None
    yml_path = os.path.join(_BUNDLE_PATH, "databricks.yml")
    if not os.path.isfile(yml_path):
        return None
    try:
        from dagster_shared.yaml_utils import safe_load_yaml

        with open(yml_path, encoding="utf-8") as handle:
            doc = safe_load_yaml(handle.read())
    except Exception:
        return None
    jobs = ((doc or {}).get("resources") or {}).get("jobs") or {}
    job = jobs.get(job_name)
    if not job:
        return None
    schedule = job.get("schedule") or {}
    cron = schedule.get("quartz_cron_expression")
    return {
        "jobName": job.get("name", job_name),
        "description": job.get("description"),
        "cron": cron,
        "cronType": "quartz" if cron else None,
        "timezone": schedule.get("timezone_id"),
        "pauseStatus": schedule.get("pause_status"),
        "pipeline": prefix,
    }


# Each top-level bundle directory maps to the Lakeflow (DLT) pipeline that builds it.
_PIPELINE_BY_PREFIX = {
    "claims_landing": "claims_landing",
    "cms_landing": "cms_landing",
    "sis": "sis_silver",
}


def _iso_to_ms(value: str) -> int | None:
    try:
        from datetime import datetime

        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def fetch_asset_builds(url: str | None) -> dict:
    """Recent Lakeflow pipeline runs ("builds") that refreshed this asset.

    Each run is a DLT *update* — a snapshot (full refresh) or an incremental
    update — with its state and wall-clock duration, read live from Databricks.
    """
    if not url:
        raise PreviewError("Missing required `url` query parameter.", status_code=400)
    relpath, _ = _relpath_from_github_url(url)
    prefix = relpath.split("/", 1)[0]
    pipeline_name = _PIPELINE_BY_PREFIX.get(prefix)
    if not pipeline_name:
        return {"pipeline": None, "builds": []}

    try:
        from databricks.sdk import WorkspaceClient
    except ImportError:
        raise PreviewError(
            "Build history requires the `databricks-sdk` package in the webserver environment.",
            status_code=501,
        )
    host = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")
    if not host or not token:
        raise PreviewError(
            "Build history is not configured: missing DATABRICKS_HOST / DATABRICKS_TOKEN.",
            status_code=501,
        )
    client = WorkspaceClient(host=host, token=token)

    # Exact-name match prefers the prod pipeline over any "[dev ...]" variants.
    pipeline_id = next(
        (p.pipeline_id for p in client.pipelines.list_pipelines() if p.name == pipeline_name),
        None,
    )
    if not pipeline_id:
        return {"pipeline": pipeline_name, "builds": []}

    # Terminal-event timestamp per update gives us the end time (and so duration).
    ends_ms: dict[str, int] = {}
    for event in client.pipelines.list_pipeline_events(pipeline_id=pipeline_id, max_results=250):
        data = event.as_dict()
        if data.get("event_type") != "update_progress":
            continue
        update_id = (data.get("origin") or {}).get("update_id")
        ts_ms = _iso_to_ms(data.get("timestamp", ""))
        if update_id and ts_ms is not None:
            ends_ms[update_id] = max(ends_ms.get(update_id, 0), ts_ms)

    response = client.pipelines.list_updates(pipeline_id=pipeline_id)
    builds = []
    for update in (response.updates or [])[:15]:
        update_id = update.update_id
        start_ms = update.creation_time
        end_ms = ends_ms.get(update_id) if update_id else None
        duration_ms = end_ms - start_ms if (end_ms and start_ms and end_ms >= start_ms) else None
        state = getattr(update.state, "value", None) or (
            str(update.state) if update.state is not None else None
        )
        builds.append(
            {
                "id": (update_id or "")[:8],
                "fullRefresh": bool(update.full_refresh),
                "type": "snapshot" if update.full_refresh else "update",
                "state": state,
                "startedAt": start_ms,
                "durationMs": duration_ms,
            }
        )
    return {"pipeline": pipeline_name, "builds": builds}


def _parse_checks(code: str) -> list[dict]:
    """Parse the DLT data-quality expectations declared on the table."""
    checks = []
    for decorator, name, condition in _EXPECTATION.findall(code):
        checks.append(
            {
                "name": name,
                "condition": condition,
                "action": _EXPECTATION_ACTION.get(decorator, "warn"),
            }
        )
    return checks


def fetch_asset_source(url: str | None) -> dict:
    """Return the full source file for a code reference, with schedule and checks.

    (Build history is served separately via ``fetch_asset_builds``.)
    """
    if not url:
        raise PreviewError("Missing required `url` query parameter.", status_code=400)
    relpath, line_number = _relpath_from_github_url(url)
    if not relpath:
        raise PreviewError("Could not derive a file path from the code reference.", status_code=400)
    target = _safe_bundle_path(relpath)
    if not os.path.isfile(target):
        raise PreviewError(f"Source file not found in the local bundle: {relpath}", status_code=404)
    with open(target, encoding="utf-8") as handle:
        code = handle.read()
    ext = os.path.splitext(target)[1].lower()
    return {
        "path": relpath,
        "url": url,
        "language": _LANG_BY_EXT.get(ext, ""),
        "lineNumber": line_number,
        "code": code,
        "schedule": _schedule_for_relpath(relpath),
        "checks": _parse_checks(code),
    }
