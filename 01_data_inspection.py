"""
Step 1: Data Inspection and Quality Assessment
"""
import pandas as pd
import numpy as np
import openpyxl
import json
import os

# Load workbook
wb_path = r'c:\Users\avdho\Downloads\Biofuelcircle\Platform BU data for analysis.xlsx'
wb = openpyxl.load_workbook(wb_path, data_only=True)

print("=" * 80)
print("WORKBOOK STRUCTURE")
print("=" * 80)
print(f"Sheets: {wb.sheetnames}")
for s in wb.sheetnames:
    ws = wb[s]
    print(f"  {s}: {ws.max_row} rows x {ws.max_column} cols")

# Read all sheets
all_sheets = {}
for sheet_name in wb.sheetnames:
    df = pd.read_excel(wb_path, sheet_name=sheet_name, engine='openpyxl')
    all_sheets[sheet_name] = df
    print(f"\n--- Sheet: {sheet_name} ---")
    print(f"Shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"Dtypes:\n{df.dtypes}")
    print(f"\nFirst 5 rows:")
    print(df.head().to_string())
    print(f"\nLast 5 rows:")
    print(df.tail().to_string())
    print(f"\nMissing values:\n{df.isnull().sum()}")
    print(f"\nBasic stats:")
    print(df.describe().to_string())

# Save sheet info for downstream scripts
sheet_info = {}
for name, df in all_sheets.items():
    sheet_info[name] = {
        'shape': list(df.shape),
        'columns': list(df.columns),
        'dtypes': {str(k): str(v) for k, v in df.dtypes.items()},
        'missing': {str(k): int(v) for k, v in df.isnull().sum().items()},
    }

with open(r'c:\Users\avdho\Downloads\Biofuelcircle\sheet_info.json', 'w') as f:
    json.dump(sheet_info, f, indent=2, default=str)

print("\n\nSheet info saved to sheet_info.json")
