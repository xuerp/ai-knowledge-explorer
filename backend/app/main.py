"""Application assembly. Domain endpoints live in app.api."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import (
    account,
    admin,
    auth,
    automation,
    decision,
    ingestion,
    knowledge,
    research,
    review,
    share,
    system,
)
from .application_rules import (
    DATABASE_SCHEMA_REVISION,
    RELATION_CLAIM_PREDICATES,
    RELATION_PREDICATE_ANCHORS,
)
from .config import Settings
from .runtime import create_services

__all__ = [
    "DATABASE_SCHEMA_REVISION",
    "RELATION_CLAIM_PREDICATES",
    "RELATION_PREDICATE_ANCHORS",
    "create_app",
]


def create_app(settings: Settings | None = None, *, task_interpreter=None) -> FastAPI:
    services = create_services(settings, task_interpreter=task_interpreter)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if services.database.engine.dialect.name == "sqlite":
            services.database.create_all()
        with services.database.session() as session:
            services.repository.seed_catalog(session)
            services.repository.seed_review_jobs(session)
            services.ingestion.reconcile_historical_permanent_failures(session)
            services.ingestion.reconcile_misclassified_not_modified_failures(session)
            services.ingestion.reconcile_source_portfolio(session)
        yield
        if services.embedding_provider is not None:
            services.embedding_provider.close()
        services.database.dispose()

    app = FastAPI(
        title="AI Radar API",
        version="0.1.0",
        description="Evidence-first knowledge API with a protected human review gate.",
        lifespan=lifespan,
    )
    app.state.settings = services.app_settings
    app.state.database = services.database
    app.state.repository = services.repository
    app.state.auth = services.auth
    app.state.audit = services.audit
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(services.app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Accept", "Authorization", "Content-Type", "X-Admin-Token"],
    )

    app.state.services = services
    app.include_router(system.router)
    app.include_router(auth.router)
    app.include_router(automation.router)
    app.include_router(account.router)
    app.include_router(research.router)
    app.include_router(share.router)
    app.include_router(admin.router)
    app.include_router(decision.router)
    app.include_router(knowledge.router)
    app.include_router(ingestion.router)
    app.include_router(review.router)
    return app


app = create_app()
