import mimetypes
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI

# Minimal Linux containers' /etc/mime.types may not register web font types.
# Register them so StaticFiles serves font files with the correct Content-Type
# (browsers refuse to apply fonts served as application/octet-stream).
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/otf", ".otf")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from scalar_fastapi import get_scalar_api_reference

from .middleware.logging import AccessLogMiddleware, configure_logging, get_app_logger, shutdown_logging
from .routers.admin import router as admin_router
from .routers.admin_files import router as admin_files_router
from .routers.user_files import router as user_files_router
from .routers.agent import router as agent_router
from .routers.auth import router as auth_router
from .routers.files import router as files_router
from .routers.hooks import router as hooks_router
from .routers.resource import router as resource_router
from .routers.channels import router as channels_router
from .routers.scheduler import router as scheduler_router
from .routers.mcp import router as mcp_router
from .routers.metrics import router as metrics_router
from .routers.pty import router as pty_router
from .routers.skill_hub import router as skill_hub_router
from .routers.skills import router as skills_router
from .routers.subagents import router as subagents_router
from .routers.user_data import router as user_data_router
from .services.config import get_settings
from .services.temp_files import cleanup_expired_files
from .services.user_store import get_user_store

logger = get_app_logger(__name__)
STATIC_DIR = Path(__file__).parent / "static"
WEB_DIST = Path(__file__).parent.parent / "web" / "dist"


def _detect_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        try:
            candidate = socket.gethostbyname(socket.gethostname())
            if candidate and not candidate.startswith("127."):
                return candidate
        except OSError:
            pass
    return "127.0.0.1"


def _public_host(configured_host: str | None) -> str:
    host = (configured_host or "").strip()
    if host in {"", "0.0.0.0", "::", "localhost", "127.0.0.1"}:
        return _detect_local_ip()
    return host


def _base_url(host: str, port: int) -> str:
    display_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{display_host}:{port}"


def _mount_static_assets(app: FastAPI) -> None:
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

def _mount_web_app(app: FastAPI) -> None:
    if WEB_DIST.exists():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


def _configure_docs(app: FastAPI) -> None:
    @app.get("/docs", include_in_schema=False)
    async def scalar_docs():
        return get_scalar_api_reference(
            openapi_url=app.openapi_url,
            title=f"{app.title} - API Reference",
            scalar_js_url="/static/scalar.js",
        )


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        import asyncio

        configure_logging(settings)

        # Seed runtime skills from the source-code seed (per-skill delete+rewrite).
        # Runtime dir ($VIVIAN_HOME/vivian/resource/skills) is the live source of
        # truth read by the Skill Hub thereafter.
        try:
            from .services.skill_hub import seed_bundled_skills
            seed_bundled_skills()
        except Exception as exc:
            logger.warning("Skill seeding skipped: {}", exc)

        store = get_user_store()
        users = store.list_users()
        user_count = len(users)
        logger.info(
            "Config loaded: {} v{}, server={}:{}, users={}",
            settings.app_name,
            settings.app_version,
            settings.server.host,
            settings.server.port,
            user_count,
        )

        # Background task: clean up expired temp files every hour
        async def _temp_cleanup_loop() -> None:
            while True:
                await asyncio.sleep(3600)
                try:
                    cleanup_expired_files()
                except Exception as exc:
                    logger.warning("Temp file cleanup error: {}", exc)

        cleanup_task = asyncio.create_task(_temp_cleanup_loop())

        # Auto-connect OpenClaw bridges for enabled users (API-process-side)
        oc_bridges: dict[str, object] = {}
        try:
            from .services.channels.config_store import get_channel_config_store
            from .services.channels.openclaw_bridge import (
                OpenClawBridge,
                register_bridge,
                unregister_bridge,
            )
            oc_configs = get_channel_config_store().list_enabled_openclaw_configs()
            for username, oc_config in oc_configs.items():
                try:
                    bridge = OpenClawBridge(oc_config, username)
                    await bridge.connect()
                    register_bridge(username, bridge)
                    oc_bridges[username] = bridge
                    logger.info("OpenClaw bridge connected (api) for user {}", username)
                except Exception as e:
                    logger.warning("OpenClaw bridge failed (api) for user {}: {}", username, e)
        except Exception as e:
            logger.warning("OpenClaw auto-connect skipped: {}", e)

        try:
            yield
        finally:
            cleanup_task.cancel()
            # Disconnect OpenClaw bridges
            try:
                from .services.channels.openclaw_bridge import unregister_bridge as _unreg
                for username, bridge in list(oc_bridges.items()):
                    try:
                        await bridge.disconnect()
                    except Exception:
                        pass
                    _unreg(username)
            except Exception:
                pass
            logger.info("Application shutdown complete")
            shutdown_logging()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(AccessLogMiddleware)
    _mount_static_assets(app)

    @app.get("/health", include_in_schema=False)
    async def health():
        host = _public_host(settings.server.host)
        port = int(settings.server.port)
        return {
            "status": "ok",
            "app": settings.app_name,
            "version": settings.app_version,
            "host": host,
            "port": port,
            "base_url": _base_url(host, port),
            "time": datetime.now(timezone.utc).isoformat(),
        }

    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(admin_files_router)
    app.include_router(agent_router)
    app.include_router(skills_router)
    app.include_router(skill_hub_router)
    app.include_router(subagents_router)
    app.include_router(mcp_router)
    app.include_router(files_router)
    app.include_router(hooks_router)
    app.include_router(user_data_router)
    app.include_router(resource_router)
    app.include_router(scheduler_router)
    app.include_router(channels_router)
    app.include_router(user_files_router)
    app.include_router(pty_router)
    app.include_router(metrics_router)
    _configure_docs(app)
    _mount_web_app(app)
    return app


app = create_app()
