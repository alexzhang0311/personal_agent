"""Prometheus scrape endpoint.

No app-layer auth by design — access is controlled at the gateway/network
layer (see docs/adr/0002-prometheus-metrics-architecture.md). Excluded from
the OpenAPI schema and from the access log / HTTP metrics.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from ..metrics import render

router = APIRouter()


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    body, content_type = render()
    return Response(content=body, media_type=content_type)
