"""Generic owned-child deadline supervisor; no historical runtime configuration.

The caller supplies its own Popen handle and explicit deadline. Importing this
module does not spawn or stop a process.
"""

import argparse
import subprocess
import time
from collections.abc import Callable
from datetime import UTC, datetime

OBSERVATION_SECONDS = 16 * 3600


def supervise_worker(
    process: subprocess.Popen,
    stop_at: datetime,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    sleep: Callable[[float], None] = time.sleep,
    deadline_notice: Callable[[], None] = lambda: None,
) -> dict:
    """Check wall time after every wait, including after machine resume.

    Termination targets only this observation's Popen handle. Interrupted
    collection can leave a run/lease unfinished; these never become a success.
    """
    if stop_at.tzinfo is None:
        raise ValueError("Observation deadline must include a timezone.")
    while True:
        current = now()
        exit_code = process.poll()
        if exit_code is not None:
            return {
                "status": "exited-before-deadline" if current < stop_at else "exited",
                "returnCode": exit_code,
                "deadlineReached": current >= stop_at,
                "terminationRequested": False,
                "killRequired": False,
            }
        remaining = (stop_at - current).total_seconds()
        if remaining <= 0:
            deadline_notice()
            process.terminate()
            killed = False
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                killed = True
                process.wait(timeout=2)
            return {
                "status": "stopped-at-deadline",
                "returnCode": process.returncode,
                "deadlineReached": True,
                "terminationRequested": True,
                "killRequired": killed,
            }
        sleep(min(0.5, remaining))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shutdown-drill", action="store_true")
    parser.add_argument("--duration-seconds", type=int, default=OBSERVATION_SECONDS)
    args = parser.parse_args()
    if args.duration_seconds < 1:
        parser.error("--duration-seconds must be positive.")
    if args.duration_seconds != OBSERVATION_SECONDS and not args.shutdown_drill:
        parser.error("Changed duration requires --shutdown-drill; acceptance stays 16 hours.")
    raise SystemExit(
        "Supply an explicitly authorized caller and owned process; historical runtime configuration is not distributed."
    )


if __name__ == "__main__":
    main()
