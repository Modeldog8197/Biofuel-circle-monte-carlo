"""Four-month forecasts evaluated with expanding, chronological origins."""

import argparse
import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
HORIZON = 4
MIN_TRAIN = 18
BASE_MODELS = (
    "Last observation",
    "Seasonal naive",
    "Recent mean",
    "Damped trend",
    "Recent drift",
)
MODELS = (*BASE_MODELS, "Adaptive blend")
TARGETS = (
    "New Sell Trades (No)",
    "New Sell Trades (V)",
    "Manual Responses (No)",
    "Manual Responses (V)",
)
DRIVERS = (
    "Platform delivered Vol",
    "Seller Delivered Volume",
    "Open Interest",
    "Scheduled Volume",
    "Unique participants",
    "Successful Participants",
)


def read_json(path):
    raw = Path(path).read_bytes()
    return json.loads(
        raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig")
    )


def validate_data(data):
    dates = [datetime.strptime(m, "%b-%y") for m in data["months"]]
    indices = [d.year * 12 + d.month for d in dates]
    if len(dates) < 32 or any(b - a != 1 for a, b in zip(indices, indices[1:])):
        raise ValueError(
            "At least 32 consecutive, unique monthly observations are required."
        )
    for name, values in data["data"].items():
        if len(values) != len(dates):
            raise ValueError(f"{name}: length does not match the calendar.")
        for v in values:
            if v is not None and (
                not isinstance(v, (int, float))
                or isinstance(v, bool)
                or not np.isfinite(v)
            ):
                raise ValueError(f"{name}: values must be finite numbers or null.")
    for name in TARGETS:
        if name not in data["data"] or any(v is None for v in data["data"][name]):
            raise ValueError(
                f"{name}: targets must be complete; missing values are not imputed."
            )
        if any(v < 0 for v in data["data"][name]):
            raise ValueError(f"{name}: forecast targets must be nonnegative.")
        if name.endswith("(No)") and any(v != int(v) for v in data["data"][name]):
            raise ValueError(f"{name}: count observations must be whole numbers.")
    return dates


def predict(values, model, horizon=HORIZON):
    y = np.asarray(values, dtype=float)
    if not 1 <= horizon <= HORIZON or len(y) < MIN_TRAIN:
        raise ValueError(
            "Forecast horizon must be 1–4 months and history at least 18 months."
        )
    if model == "Last observation":
        result = np.repeat(y[-1], horizon)
    elif model == "Seasonal naive":
        result = y[len(y) - 12 : len(y) - 12 + horizon]
    elif model == "Recent mean":
        result = np.repeat(y[-6:].mean(), horizon)
    elif model == "Damped trend":
        recent = y[-12:]
        slope = np.polyfit(np.arange(len(recent)), recent, 1)[0]
        result = y[-1] + slope * np.cumsum(0.8 ** np.arange(1, horizon + 1))
    elif model == "Recent drift":
        result = y[-1] + np.median(np.diff(y[-7:])) * np.cumsum(
            0.8 ** np.arange(1, horizon + 1)
        )
    elif model == "Adaptive blend":
        origins = range(max(12, len(y) - 9), len(y) - HORIZON + 1)
        # Model weights see only outcomes already observed at this forecast origin.
        losses = []
        for candidate in BASE_MODELS:
            errors = [
                np.abs(y[t : t + HORIZON] - predict(y[:t], candidate))
                for t in origins
                if t >= MIN_TRAIN
            ]
            losses.append(float(np.mean(errors)) if errors else 1.0)
        floor = max(float(np.median(losses)) * 0.1, 1e-9)
        weights = 1 / (np.array(losses) + floor)
        result = np.average(
            [predict(y, m, horizon) for m in BASE_MODELS], axis=0, weights=weights
        )
    else:
        raise ValueError(f"Unknown model: {model}")
    return np.maximum(result, 0)


def error_vectors(values, model):
    y = np.asarray(values, dtype=float)
    return np.array(
        [
            (y[t : t + HORIZON] - predict(y[:t], model)) / max(y[t - 1], 1)
            for t in range(MIN_TRAIN, len(y) - HORIZON + 1)
        ]
    )


def simulate(point, errors, n=20000, seed=8197, is_count=False, scale=1):
    if not 100 <= n <= 100000 or not 0 <= seed <= 2**32 - 1:
        raise ValueError("Use 100–100,000 paths and a 32-bit unsigned seed.")
    errors = np.asarray(errors, dtype=float)
    if errors.ndim != 2 or errors.shape[1] != HORIZON or not len(errors):
        raise ValueError("Four-dimensional historical error vectors are required.")
    # Same LCG and vector-index mapping as the browser; preserves cross-horizon errors.
    state = seed
    indices = []
    for _ in range(n):
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        indices.append(min(len(errors) - 1, int(state / 2**32 * len(errors))))
    paths = np.maximum(
        np.asarray(point) + (errors[indices] - np.median(errors, axis=0)) * scale, 0
    )
    if is_count:
        paths = np.floor(paths + 0.5)
    return paths


def summarize(paths):
    return [
        {
            "p025": float(q[0]),
            "p10": float(q[1]),
            "median": float(q[2]),
            "p90": float(q[3]),
            "p975": float(q[4]),
            "mean": float(np.mean(values)),
        }
        for values in paths.T
        for q in [np.quantile(values, [0.025, 0.1, 0.5, 0.9, 0.975])]
    ]


def evaluate(values, model, start):
    y = np.asarray(values, dtype=float)
    records = []
    for origin in range(start, len(y) - HORIZON + 1):
        point = predict(y[:origin], model)
        naive = predict(y[:origin], "Last observation")
        errors = error_vectors(y[:origin], model)
        # Quantiles directly from all historical vectors; no Monte Carlo noise in evaluation.
        candidates = np.maximum(
            point + (errors - np.median(errors, axis=0)) * max(y[origin - 1], 1), 0
        )
        lower, upper = np.quantile(candidates, [0.1, 0.9], axis=0)
        for h in range(HORIZON):
            actual = y[origin + h]
            records.append(
                {
                    "origin_index": origin,
                    "horizon": h + 1,
                    "actual": float(actual),
                    "forecast": float(point[h]),
                    "naive": float(naive[h]),
                    "lower80": float(lower[h]),
                    "upper80": float(upper[h]),
                }
            )
    return records


def scores(records):
    actual = np.array([r["actual"] for r in records])
    pred = np.array([r["forecast"] for r in records])
    naive = np.array([r["naive"] for r in records])
    mae = float(np.abs(actual - pred).mean())
    naive_mae = float(np.abs(actual - naive).mean())
    return {
        "mae": mae,
        "rmse": float(np.sqrt(np.mean((actual - pred) ** 2))),
        "wape": (
            float(np.sum(np.abs(actual - pred)) / np.sum(actual))
            if np.sum(actual)
            else None
        ),
        "naive_mae": naive_mae,
        "skill": 1 - mae / naive_mae if naive_mae else None,
        "coverage80": float(
            np.mean([r["lower80"] <= r["actual"] <= r["upper80"] for r in records])
        ),
        "observations": len(records),
    }


def next_months(last, horizon=HORIZON):
    index = last.year * 12 + last.month - 1
    return [
        datetime((index + h) // 12, (index + h) % 12 + 1, 1).strftime("%Y-%m")
        for h in range(1, horizon + 1)
    ]


def associations(data, target):
    # Differences reduce shared long-term trend; these remain exploratory associations.
    dy = np.diff(np.array(data["data"][target], dtype=float))
    rows = []
    for driver in DRIVERS:
        x = np.array([np.nan if v is None else v for v in data["data"][driver]])
        dx = np.diff(x)
        for lag in (0, 1):
            a, b = (dx, dy) if lag == 0 else (dx[:-1], dy[1:])
            valid = np.isfinite(a) & np.isfinite(b)
            if valid.sum() >= 15 and np.std(a[valid]) and np.std(b[valid]):
                rows.append(
                    {
                        "metric": driver,
                        "lag": lag,
                        "n": int(valid.sum()),
                        "r": float(np.corrcoef(a[valid], b[valid])[0, 1]),
                    }
                )
    return sorted(rows, key=lambda r: abs(r["r"]), reverse=True)


def build_report(data, n=20000, seed=8197):
    dates = validate_data(data)
    development_end = len(dates) - 8
    normalized = json.dumps(
        data, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    report = {
        "version": "2.0.0",
        "horizon": HORIZON,
        "paths": n,
        "seed": seed,
        "as_of": dates[-1].strftime("%Y-%m"),
        "forecast_months": next_months(dates[-1]),
        "data_sha256": hashlib.sha256(normalized.encode()).hexdigest(),
        "history": data,
        "development_end": dates[development_end - 1].strftime("%Y-%m"),
        "holdout_start": dates[development_end].strftime("%Y-%m"),
        "quality": [
            {
                "metric": k,
                "missing": sum(v is None for v in vs),
                "negative": sum(v is not None and v < 0 for v in vs),
                "observations": len(vs),
            }
            for k, vs in data["data"].items()
        ],
        "targets": {},
    }
    for target in TARGETS:
        y = np.array(data["data"][target])
        tuning = []
        for model in MODELS:
            errors = [
                np.abs(y[t : t + HORIZON] - predict(y[:t], model))
                for t in range(MIN_TRAIN, development_end - HORIZON + 1)
            ]
            tuning.append(
                {"model": model, "mae": float(np.mean(errors)), "origins": len(errors)}
            )
        model = min(tuning, key=lambda row: row["mae"])["model"]
        records = evaluate(y, model, development_end)
        point = predict(y, model)
        errors = error_vectors(y, model)
        paths = simulate(point, errors, n, seed, target.endswith("(No)"), max(y[-1], 1))
        report["targets"][target] = {
            "unit": "count" if target.endswith("(No)") else "MT",
            "model": model,
            "last": float(y[-1]),
            "point": point.tolist(),
            "errors": errors.tolist(),
            "error_scale": float(max(y[-1], 1)),
            "forecast": summarize(paths),
            "total": summarize(paths.sum(axis=1)[:, None])[0],
            "development": tuning,
            "holdout": scores(records),
            "by_horizon": [
                scores([r for r in records if r["horizon"] == h]) for h in range(1, 5)
            ],
            "holdout_predictions": records,
            "associations": associations(data, target),
        }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "verified_data.json")
    parser.add_argument("--output", type=Path, default=ROOT / "forecast_report.json")
    parser.add_argument("--paths", type=int, default=20000)
    parser.add_argument("--seed", type=int, default=8197)
    args = parser.parse_args()
    report = build_report(read_json(args.input), args.paths, args.seed)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    with args.output.with_suffix(".csv").open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "metric",
                "unit",
                "month",
                "model",
                "p025",
                "p10",
                "median",
                "p90",
                "p975",
                "mean",
            ]
        )
        for target, result in report["targets"].items():
            for month, row in zip(report["forecast_months"], result["forecast"]):
                writer.writerow(
                    [target, result["unit"], month, result["model"], *row.values()]
                )
    print(
        f"Wrote {args.output.name}: as of {report['as_of']}, four months, {args.paths:,} paths."
    )
    for target, result in report["targets"].items():
        score = result["holdout"]
        print(
            f"{target}: {result['model']}; holdout MAE {score['mae']:.1f}, "
            f"naive {score['naive_mae']:.1f}; 80% interval coverage {score['coverage80']:.0%}"
        )


if __name__ == "__main__":
    main()
