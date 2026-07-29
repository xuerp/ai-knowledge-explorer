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

    @classmethod
    def from_env(cls) -> Settings:
        database_path = BACKEND_ROOT / "data" / "ai_radar.db"
        cors_origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "AI_RADAR_CORS_ORIGINS",
                "http://localhost:3000,http://localhost:5173,http://127.0.0.1:8080",
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
        )
