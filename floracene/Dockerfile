# Floracene "Conduit" Dagit image.
#
# Ships the floracene/holocene fork's *webserver + built Dagit UI* (the data-preview
# tab, the Code/Schedule/Builds/Checks lineage rail, and the Floracene branding) on
# top of the *stock* Dagster engine + GraphQL from PyPI. This is the lightweight
# path: only the webserver and the JS bundle come from the fork — verified to run
# against stock dagster/dagster-graphql 1.13.11, whose GraphQL schema the UI's
# queries already target. (Engine changes in the fork would mean building core from
# source too; not needed yet.)
#
# conduit's tenant image builds FROM this and installs the dagster_orchestrator
# project + dagster-databricks on top. See floracene/conduit#3 for the eventual
# move to a standalone Next.js app.

ARG DAGSTER_VERSION=1.13.11

# ---------------------------------------------------------------------------
# 1) Build the Dagit JS bundle from the fork. build.sh copies the static export
#    into python_modules/dagster-webserver/dagster_webserver/webapp/build.
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS ui
ENV NODE_OPTIONS=--max-old-space-size=6144
WORKDIR /src
COPY . .
# NOTE: not --immutable. master's committed yarn.lock is slightly stale (a leftover
# @blueprintjs/select peer entry from the upstream "Replace Blueprint Select" change),
# which yarn 4 reconciles on install; --immutable would hard-fail on that one line.
RUN corepack enable \
    && cd js_modules \
    && yarn install --no-immutable \
    && yarn workspace @dagster-io/app-oss build

# ---------------------------------------------------------------------------
# 2) Runtime: stock engine + GraphQL + the fork's webserver (routes + built UI).
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime
ARG DAGSTER_VERSION
ENV DAGSTER_HOME=/opt/dagster/home \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir uv \
    && uv pip install --system \
        "dagster==${DAGSTER_VERSION}" \
        "dagster-graphql==${DAGSTER_VERSION}" \
        "dagster-postgres" \
        "databricks-sdk" \
        "starlette" \
        "uvicorn[standard]" \
        "click"

# The fork webserver carries the freshly-built webapp/build (from the ui stage).
# Installed --no-deps (its pins are the in-repo 1!0+dev packages, not on PyPI) and
# editable so it serves that bundle and exposes /preview, /asset_source, /asset_builds.
COPY --from=ui /src/python_modules/dagster-webserver /opt/dagster-webserver
RUN uv pip install --system --no-deps -e /opt/dagster-webserver

EXPOSE 3000
