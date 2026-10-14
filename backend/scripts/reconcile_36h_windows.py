"""Read-only scheduled-window reconciliation; manual runs never count."""
import argparse
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def reconcile(start, runs, now, windows=32):
    def utc(value):
        parsed = datetime.fromisoformat(value)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    results = []
    for index in range(windows):
        begin = start + timedelta(minutes=30 * index)
        end = begin + timedelta(minutes=30)
        matching = [r for r in runs if r['trigger'] == 'scheduled'
                    and begin <= utc(r['started_at']) < end]
        state = 'not-yet-due' if now < end else 'missed' if not matching else 'recorded'
        if matching:
            state = 'duplicate' if len(matching) > 1 else matching[0]['status']
        results.append({'window': index + 1, 'start': begin.isoformat(), 'end': end.isoformat(),
                        'state': state, 'runs': matching})
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', required=True, help='Actual authorized observation start, with timezone')
    parser.add_argument('--database', type=Path, default=ROOT / 'backend/data/ai_radar.db')
    parser.add_argument('--worker-id', help='Reconcile only this actual worker instance; never combine restarted observations')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/SCHEDULE_WINDOWS_36H_20261006.json')
    args = parser.parse_args()
    start = datetime.fromisoformat(args.start)
    if start.tzinfo is None:
        raise SystemExit('Start must include timezone')
    db = args.database.resolve()
    with sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        query = 'select id,worker_id,trigger,status,started_at,finished_at,result_json,error from automation_runs'
        if args.worker_id:
            query += ' where worker_id=?'
        runs = [dict(r) for r in connection.execute(query, (args.worker_id,) if args.worker_id else ())]
    observed = datetime.now(timezone.utc)
    windows = reconcile(start.astimezone(timezone.utc), runs, observed)
    counts = {}
    for window in windows:
        counts[window['state']] = counts.get(window['state'], 0) + 1
    report = {'observedAt': observed.isoformat(), 'readOnly': True,
              'database': str(db.relative_to(ROOT)), 'workerId': args.worker_id,
              'actualStart': start.isoformat(), 'windows': windows, 'windowStateCounts': counts,
              'elapsed16Hours': observed >= start + timedelta(hours=16),
              'all32WindowsSucceeded': all(w['state'] == 'succeeded' for w in windows),
              'manualRunsExcluded': sum(r['trigger'] != 'scheduled' for r in runs)}
    output = args.output.resolve()
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(str(output))


if __name__ == '__main__':
    main()
