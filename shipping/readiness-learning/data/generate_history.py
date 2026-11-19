"""Recreate teaching data, not evidence of real shipment prediction quality.

Every row is a separate fictional ship point/order decision. Features are the
snapshot available at observed_at, and independent verification arrives later.
Every generated case receives a check; real escalation-only logs would require
an explicit selection-bias analysis before this model could be reused.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import random


def timestamp(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def generate(destination: Path, rows: int = 1200) -> None:
    rng = random.Random(7142026)
    start = datetime(2025, 1, 1, 8, tzinfo=timezone.utc)
    columns = [
        "case_id", "observed_at", "portal_listing_age_days", "prior_shipments_90d",
        "days_since_scope_change", "open_setup_tasks", "registered", "verified_at",
        "report", "report_received_at", "source",
    ]
    with destination.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for index in range(rows):
            observed = start + timedelta(hours=12 * index)
            age = rng.randint(0, 60)
            previous = rng.randint(0, 30)
            scope = rng.randint(0, 180)
            tasks = rng.randint(0, 12)
            # This is deliberately learnable synthetic signal, not a domain rule.
            log_odds = -0.6 + 0.045 * age + 0.07 * previous + 0.009 * scope - 0.48 * tasks
            registered = int(rng.random() < 1 / (1 + math.exp(-log_odds)))
            useful_report = rng.random() < (0.86 if registered else 0.79)
            report = ("confirmed_registered" if registered else "confirmed_not_registered") if useful_report else "no_result"
            writer.writerow({
                "case_id": f"SYN-{index + 1:04d}", "observed_at": timestamp(observed),
                "portal_listing_age_days": age, "prior_shipments_90d": previous,
                "days_since_scope_change": scope, "open_setup_tasks": tasks,
                "registered": registered,
                "verified_at": timestamp(observed + timedelta(hours=rng.randint(4, 72))),
                "report": report,
                "report_received_at": timestamp(observed + timedelta(minutes=rng.randint(20, 150))),
                "source": "synthetic-teaching-data",
            })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("history.csv"))
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"Refusing to replace {args.output}; choose a new --output path.")
    generate(args.output)
