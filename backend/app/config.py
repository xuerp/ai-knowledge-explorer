from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    seed_snapshot_path: Path
    admin_token: str | None
    cors_origins: tuple[str, ...]
    environment: str = "development"
    data_mode: Literal["demo", "live"] = "demo"
    jwt_secret: str | None = None
    access_token_minutes: int = 30
    fetch_allowed_hosts: tuple[str, ...] = ()
    fetch_max_bytes: int = 2_000_000
    extraction_api_url: str | None = None
    extraction_api_key: str | None = None
    extraction_model: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_starttls: bool = True
    digest_timezone: str = "Asia/Shanghai"

    @classmethod
    def from_env(cls) -> Settings:
        database_path = BACKEND_ROOT / "data" / "ai_radar.db"
        cors_origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "AI_RADAR_CORS_ORIGINS",
                (
                    "http://localhost:3000,http://localhost:5173,"
                    "http://localhost:4181,http://localhost:4182,"
                    "http://127.0.0.1:8080,http://127.0.0.1:4181,"
                    "http://127.0.0.1:4182"
                ),
            ).split(",")
            if origin.strip()
        )
        data_mode = os.getenv("AI_RADAR_DATA_MODE", "demo")
        if data_mode not in {"demo", "live"}:
            raise ValueError("AI_RADAR_DATA_MODE must be either 'demo' or 'live'.")
        return cls(
            database_url=os.getenv(
                "AI_RADAR_DATABASE_URL",
                f"sqlite:///{database_path.as_posix()}",
            ),
            seed_snapshot_path=Path(
                os.getenv(
                    "AI_RADAR_SEED_SNAPSHOT",
                    str(BACKEND_ROOT / "data" / "demo_snapshot.json"),
                )
            ),
            admin_token=os.getenv("AI_RADAR_ADMIN_TOKEN") or None,
            cors_origins=cors_origins,
            environment=os.getenv("AI_RADAR_ENVIRONMENT", "development"),
            data_mode=data_mode,
            jwt_secret=os.getenv("AI_RADAR_JWT_SECRET") or None,
            access_token_minutes=int(os.getenv("AI_RADAR_ACCESS_TOKEN_MINUTES", "30")),
            fetch_allowed_hosts=tuple(
                host.strip().lower()
                for host in os.getenv("AI_RADAR_FETCH_ALLOWED_HOSTS", "").split(",")
                if host.strip()
            ),
            fetch_max_bytes=int(os.getenv("AI_RADAR_FETCH_MAX_BYTES", "2000000")),
            extraction_api_url=os.getenv("AI_RADAR_EXTRACTION_API_URL") or None,
            extraction_api_key=os.getenv("AI_RADAR_EXTRACTION_API_KEY") or None,
            extraction_model=os.getenv("AI_RADAR_EXTRACTION_MODEL") or None,
            smtp_host=os.getenv("AI_RADAR_SMTP_HOST") or None,
            smtp_port=int(os.getenv("AI_RADAR_SMTP_PORT", "587")),
            smtp_username=os.getenv("AI_RADAR_SMTP_USERNAME") or None,
            smtp_password=os.getenv("AI_RADAR_SMTP_PASSWORD") or None,
            smtp_from=os.getenv("AI_RADAR_SMTP_FROM") or None,
            smtp_starttls=os.getenv("AI_RADAR_SMTP_STARTTLS", "true").lower()
            in {"1", "true", "yes"},
            digest_timezone=os.getenv("AI_RADAR_DIGEST_TIMEZONE", "Asia/Shanghai"),
        )
