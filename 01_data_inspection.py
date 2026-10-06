"""Export and validate the repository's source workbook without changing its cells."""

import argparse
import json
from pathlib import Path
import pandas as pd
from forecast import ROOT, validate_data


def extract(path):
    raw = pd.read_excel(path, sheet_name="Trends data")
    data = {"months": [str(c).strip() for c in raw.columns[1:]], "data": {}}
    for _, row in raw.iterrows():
        if pd.isna(row.iloc[0]):
            continue
        name = str(row.iloc[0]).strip()
        if name in data["data"]:
            raise ValueError(f"Duplicate metric: {name}")
        values = []
        for cell in row.iloc[1:]:
            if pd.isna(cell) or (
                isinstance(cell, str) and cell.strip() in ("", "-", "–", "—")
            ):
                values.append(None)
            else:
                value = float(str(cell).replace(",", "").replace("\u00a0", "").strip())
                values.append(value)
        data["data"][name] = values
    validate_data(data)
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workbook", type=Path, default=ROOT / "Platform BU data for analysis.xlsx"
    )
    parser.add_argument("--output", type=Path, default=ROOT / "verified_data.json")
    args = parser.parse_args()
    data = extract(args.workbook)
    args.output.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    print(
        f'Exported {len(data["months"])} months and {len(data["data"])} metrics to {args.output}'
    )
