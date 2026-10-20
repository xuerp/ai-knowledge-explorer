"""Explicit opt-in evaluation: synthetic prompts only, no supplier business tasks.

Operator supplies DECISION_EVAL_API_URL, DECISION_EVAL_API_KEY and
DECISION_EVAL_MODEL outside chat. This script is never called by app startup.
It makes real interpretation calls only when explicitly launched with a call
budget. Passing a schema/HTTP test is not evidence of semantic quality.
"""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.decision_semantic_transport import ChatTaskInterpreter
from app.main import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-calls", type=int, required=True)
    parser.add_argument("--prior-receipt", type=Path, action="append", default=[])
    args = parser.parse_args()
    if not 1 <= args.max_calls <= 8:
        parser.error("This frozen evaluation permits at most eight interpretation calls.")
    keys = ["DECISION_EVAL_API_URL", "DECISION_EVAL_API_KEY", "DECISION_EVAL_MODEL"]
    if not all(os.getenv(key) for key in keys):
        parser.error("Configure the three DECISION_EVAL variables; values will not be printed.")
    root = Path(__file__).resolve().parents[2]
    source = root / "backend/data/decision_novel_failures_20261020.json"
    cases = json.loads(source.read_text("utf8"))["cases"]
    prior_calls = 0
    completed = set()
    for prior_path in args.prior_receipt:
        previous_path = prior_path.resolve()
        previous_path.relative_to((root / "artifacts").resolve())
        previous = json.loads(previous_path.read_text("utf8"))
        prior_calls += previous["calls"]
        if prior_calls + args.max_calls > 8:
            parser.error("The existing authorization permits eight total calls.")
        completed.update(case["id"] for case in previous["cases"])
    cases = [case for case in cases if case["id"] not in completed]
    if args.max_calls < len(cases):
        parser.error("The call budget is smaller than the remaining frozen evaluation.")
    folder = (
        root / "artifacts" / ("semantic-eval-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ"))
    )
    folder.mkdir(parents=True, exist_ok=False)
    interpreter = ChatTaskInterpreter(
        endpoint=os.environ[keys[0]],
        api_key=os.environ[keys[1]],
        model=os.environ[keys[2]],
        max_calls=args.max_calls,
        response_timeout_seconds=int(os.getenv("DECISION_EVAL_TIMEOUT_SECONDS", "30")),
    )
    settings = Settings(
        database_url="sqlite:///" + (folder / "qa.db").as_posix(),
        seed_snapshot_path=root / "backend/data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        environment="test",
        jwt_secret="semantic-evaluation-isolated-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
        auto_extraction_max_snapshots_per_cycle=0,
    )
    rows = []
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={
                "email": "semantic-qa@example.com",
                "password": "isolated local evaluation password",
            },
        )
        auth.raise_for_status()
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        for case in cases:
            response = client.post(
                "/api/v2/research",
                headers=headers,
                json={
                    "question": case["task"],
                    "language": "zh",
                    "decisionContext": {
                        "workflowVersion": 2,
                        "task": case["task"],
                        "priority": "balanced",
                        "deployment": "undecided",
                    },
                },
            )
            response.raise_for_status()
            result = response.json()
            if interpreter.last_content is not None:
                (folder / ("interpretation-" + case["id"] + ".json.txt")).write_text(
                    interpreter.last_content, encoding="utf8"
                )
            reopened = client.get("/api/v2/research/" + result["id"], headers=headers)
            reopened.raise_for_status()
            rows.append(
                {
                    "id": case["id"],
                    "criteria": case["check"],
                    "result": result,
                    "savedReopened": reopened.json()["decision"] == result["decision"],
                }
            )
            receipt = {
                "scope": "local QA; real interpretation calls; no supplier business execution",
                "calls": interpreter.calls,
                "priorCalls": prior_calls,
                "authorizedTotalCallsUsed": prior_calls + interpreter.calls,
                "totalTokens": interpreter.total_tokens,
                "cases": rows,
                "semanticQuality": "requires full-answer review",
                "lastExchange": interpreter.last_exchange,
            }
            (folder / "responses.json").write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf8"
            )
            print(case["id"], result["decisionContext"]["taskMeaning"]["status"], flush=True)
            if result["decisionContext"]["taskMeaning"]["status"] != "validated":
                if interpreter.last_content is not None:
                    (folder / "invalid-interpretation.json.txt").write_text(
                        interpreter.last_content, encoding="utf8"
                    )
                print("Stopped after interpretation failure; no retries.", flush=True)
                break
    print(str(folder / "responses.json"))


if __name__ == "__main__":
    main()
