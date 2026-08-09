FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AI_RADAR_SERVICE_ROLE=api

WORKDIR /srv/ai-radar

COPY requirements.txt ./
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY data/demo_snapshot.json ./data/demo_snapshot.json
COPY data/catalog_extension.json ./data/catalog_extension.json

RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /srv/ai-radar
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD if [ "$AI_RADAR_SERVICE_ROLE" = "worker" ]; then \
        python -m app.worker --healthcheck; \
      else \
        python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=3)"; \
      fi

CMD ["sh", "-c", "python -m alembic upgrade head && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
