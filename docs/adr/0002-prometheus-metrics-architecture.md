# Prometheus `/metrics` architecture

We expose application metrics at `/metrics` using raw `prometheus-client` (no instrumentation
framework). HTTP request count/latency are recorded inside the existing `AccessLogMiddleware`
— which already resolves the route template, method, status, and duration — rather than via a
second middleware that would re-resolve routes. Domain metrics are counter-only
(`agent_runs_started_total`, `agent_runs_finished_total{outcome}`). HTTP labels are
`handler` (route template), `method`, `status`; requests with no matched route collapse to
`handler="__unmatched__"`, and `user_name` is deliberately never a label — this app is
multi-tenant and the SPA is mounted at `/`, so either would make cardinality unbounded.

**Multiprocess.** `WORKERS` is user-tunable, so metrics must aggregate across uvicorn workers.
`server.sh` owns `PROMETHEUS_MULTIPROC_DIR` (`$VIVIAN_HOME/vivian/.prometheus-multiproc`) and
`rm -rf`s + recreates it immediately before `exec`'ing uvicorn on **every** start. This looks
like a destructive boot-time action but is required: stale per-process `.db` files from a
previous run would inflate counters forever. The app builds a fresh `CollectorRegistry` +
`MultiProcessCollector` per scrape when the env var is set, and falls back to the default
registry when it is not (dev / `WORKERS=1` / macOS). Clearing the dir from Python's lifespan
was rejected because lifespan runs once per worker and would race.

**No authentication.** `/metrics` is intentionally unauthenticated; access is controlled by
the deployment gateway / network policy / bind address. This is an accepted info-disclosure
trade-off (it leaks route inventory, traffic volume, error rates) chosen for zero-friction
scraping on internal networks. It is not an oversight — a token gate can be added later via an
optional `METRICS_TOKEN` env if a self-host target needs it.
