"""
Complete Monte Carlo Simulation, Driver Analysis, Lag Analysis, Scenario Analysis
Biofuelcircle Platform BU Data
Data is transposed: metrics as rows, months as columns
"""
import pandas as pd
import numpy as np
from scipy import stats
from scipy.stats import pearsonr, spearmanr, norm, t as t_dist
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
import warnings
import json
import os
warnings.filterwarnings('ignore')

plt.rcParams.update({
    'figure.dpi': 150,
    'savefig.dpi': 150,
    'font.size': 10,
    'axes.titlesize': 12,
    'axes.labelsize': 10,
    'figure.figsize': (14, 8),
    'savefig.bbox': 'tight',
})

OUTPUT_DIR = r'c:\Users\avdho\Downloads\Biofuelcircle\output'
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ============================================================================
# 1. LOAD AND PREPARE DATA (Transposed format)
# ============================================================================
print("=" * 80)
print("STEP 1: DATA LOADING AND PREPARATION")
print("=" * 80)

wb_path = r'c:\Users\avdho\Downloads\Biofuelcircle\Platform BU data for analysis.xlsx'
raw = pd.read_excel(wb_path, sheet_name='Trends data', engine='openpyxl')

# First column is the metric name, remaining columns are months
raw = raw.rename(columns={raw.columns[0]: 'Metric'})

# Drop rows where Metric is NaN (separator rows)
raw = raw.dropna(subset=['Metric']).reset_index(drop=True)

print(f"Metrics found: {raw['Metric'].tolist()}")
print(f"Month columns: {list(raw.columns[1:])}")

# Transpose: metrics become columns, months become rows
df = raw.set_index('Metric').T
df.index.name = 'Month'

# Parse month index to datetime
parsed_dates = []
valid_mask = []
for m in df.index:
    try:
        dt = pd.to_datetime(str(m), format='%b-%y')
        parsed_dates.append(dt)
        valid_mask.append(True)
    except Exception:
        try:
            dt = pd.to_datetime(str(m))
            parsed_dates.append(dt)
            valid_mask.append(True)
        except Exception:
            parsed_dates.append(pd.NaT)
            valid_mask.append(False)

df.index = pd.DatetimeIndex(parsed_dates, name='Month')
df = df[df.index.notna()]
df = df.sort_index()

# Convert all columns to numeric
for col in df.columns:
    df[col] = pd.to_numeric(df[col], errors='coerce')

# Strip whitespace from column names
df.columns = df.columns.str.strip()

print(f"\nTime Range: {df.index.min().strftime('%B %Y')} to {df.index.max().strftime('%B %Y')}")
print(f"Observations (months): {len(df)}")
print(f"Variables: {len(df.columns)}")
print(f"\nAll variables:\n  {chr(10).join(df.columns.tolist())}")

print(f"\nMissing Values Summary:")
missing = df.isnull().sum()
for col in df.columns:
    if missing[col] > 0:
        print(f"  {col}: {missing[col]} missing ({missing[col]/len(df)*100:.1f}%)")

print(f"\nData types:\n{df.dtypes}")
print(f"\nFirst 3 rows:")
print(df.head(3).to_string())
print(f"\nLast 3 rows:")
print(df.tail(3).to_string())

# Define variable groups
TARGET_VARS = ['New Sell Trades (No)', 'New Sell Trades (V)', 
               'Manual Responses (No)', 'Manual Responses (V)']

# Check which target vars exist
for t in TARGET_VARS:
    if t not in df.columns:
        print(f"WARNING: Target '{t}' not found in columns!")
        # Try to find similar
        matches = [c for c in df.columns if t.lower() in c.lower()]
        print(f"  Similar: {matches}")

DRIVER_CANDIDATES = [
    'Platform delivered Vol', 'Seller Delivered Volume', 'Scheduled Volume',
    'Biomass Bank deliveries', 'Pass through Volume', 'Market share',
    'Unique participants', 'Successful Participants', 'Farmer Delivery Count',
    'Open Interest', 'Deals', 'Deal Volume Industrial', 'Deal Volume Supply Chain',
    'Trades Lost',
    'No of Trades ARR (month)', 'Trade Vol ARR (month)',
    'No of Deals (ARR)..month based', 'Deal ARR (month based)',
    'Deal ARR (quarter based)', 'Deal/ New trade ratio',
    'Vol per Deal',
    'Farmer Deals', 'Total Trades (No)', 'Total Trades (V)',
    'Rural Warehouse In', 'Rural Warehouse Out',
]

# Match to actual columns
DRIVER_VARS = [v for v in DRIVER_CANDIDATES if v in df.columns]
# Also grab anything not yet listed
extra = [c for c in df.columns if c not in TARGET_VARS and c not in DRIVER_VARS]
DRIVER_VARS.extend(extra)

# Keep only drivers with enough data
DRIVER_VARS_FULL = [v for v in DRIVER_VARS if v not in TARGET_VARS and df[v].notna().sum() >= 20]

print(f"\nDriver variables with >=20 observations: {len(DRIVER_VARS_FULL)}")
print(f"  {DRIVER_VARS_FULL}")

# ============================================================================
# 2. DATA QUALITY & OUTLIER DETECTION
# ============================================================================
print("\n" + "=" * 80)
print("STEP 2: DATA QUALITY & OUTLIER DETECTION")
print("=" * 80)

# Basic statistics
print("\nDescriptive Statistics:")
print(df.describe().T.to_string())

outlier_results = {}
for col in df.select_dtypes(include=[np.number]).columns:
    series = df[col].dropna()
    if len(series) < 10:
        continue
    q1, q3 = series.quantile(0.25), series.quantile(0.75)
    iqr = q3 - q1
    if iqr == 0:
        continue
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = series[(series < lower) | (series > upper)]
    if len(outliers) > 0:
        outlier_results[col] = {
            'count': len(outliers),
            'pct': len(outliers) / len(series) * 100,
            'dates': [d.strftime('%Y-%m') for d in outliers.index]
        }
        print(f"  {col}: {len(outliers)} outlier(s) ({len(outliers)/len(series)*100:.1f}%) at {outlier_results[col]['dates']}")

if not outlier_results:
    print("  No significant outliers detected (IQR method)")

# ============================================================================
# 3. MONTE CARLO FORECASTING
# ============================================================================
print("\n" + "=" * 80)
print("STEP 3: MONTE CARLO FORECASTING (10,000 simulations)")
print("=" * 80)

N_SIM = 10000
HORIZONS = [1, 3, 6, 12]
np.random.seed(42)

mc_results = {}

for target in TARGET_VARS:
    if target not in df.columns:
        print(f"  SKIP: {target} not in data")
        continue
    print(f"\n--- Forecasting: {target} ---")
    series = df[target].dropna()
    n = len(series)
    if n < 5:
        print(f"  SKIP: Only {n} observations")
        continue
    
    values = series.values.astype(float)
    returns = np.diff(values) / np.where(values[:-1] != 0, values[:-1], 1)
    abs_changes = np.diff(values)
    
    last_val = values[-1]
    mc_results[target] = {}
    
    for horizon in HORIZONS:
        results_by_method = {}
        
        # METHOD 1: Historical Bootstrap Resampling
        sims_bootstrap = np.zeros(N_SIM)
        for i in range(N_SIM):
            sim_val = last_val
            for step in range(horizon):
                sampled_return = np.random.choice(returns)
                sim_val = sim_val * (1 + sampled_return)
            sims_bootstrap[i] = max(sim_val, 0)
        results_by_method['Bootstrap'] = sims_bootstrap
        
        # METHOD 2: Parametric Distribution Fitting
        mu_r, std_r = np.mean(returns), np.std(returns, ddof=1)
        sims_parametric = np.zeros(N_SIM)
        for i in range(N_SIM):
            sim_val = last_val
            for step in range(horizon):
                r = np.random.normal(mu_r, std_r)
                sim_val = sim_val * (1 + r)
            sims_parametric[i] = max(sim_val, 0)
        results_by_method['Parametric'] = sims_parametric
        
        # METHOD 3: Trend-Adjusted Simulation
        x_trend = np.arange(n)
        coeffs = np.polyfit(x_trend, values, 1)
        residuals = values - np.polyval(coeffs, x_trend)
        resid_std = np.std(residuals, ddof=2)
        
        sims_trend = np.zeros(N_SIM)
        for i in range(N_SIM):
            projected = np.polyval(coeffs, n - 1 + horizon) + np.random.normal(0, resid_std)
            sims_trend[i] = max(projected, 0)
        results_by_method['Trend-Adjusted'] = sims_trend
        
        # METHOD 4: Seasonality-Adjusted Simulation
        monthly_means = series.groupby(series.index.month).mean()
        overall_mean = series.mean()
        seasonal_factors = monthly_means / overall_mean if overall_mean != 0 else monthly_means * 0 + 1
        
        deseason = series.copy()
        for idx in deseason.index:
            sf = seasonal_factors.get(idx.month, 1.0)
            if sf != 0:
                deseason.loc[idx] = deseason.loc[idx] / sf
            
        deseas_vals = deseason.values.astype(float)
        deseas_returns = np.diff(deseas_vals) / np.where(deseas_vals[:-1] != 0, deseas_vals[:-1], 1)
        mu_ds = np.mean(deseas_returns)
        std_ds = np.std(deseas_returns, ddof=1) if len(deseas_returns) > 1 else 0.1
        
        sims_seasonal = np.zeros(N_SIM)
        last_month = series.index[-1].month
        for i in range(N_SIM):
            sim_val = deseas_vals[-1]
            for step in range(horizon):
                r = np.random.normal(mu_ds, std_ds)
                sim_val = sim_val * (1 + r)
            target_month = ((last_month + horizon - 1) % 12) + 1
            sf = seasonal_factors.get(target_month, 1.0)
            sims_seasonal[i] = max(sim_val * sf, 0)
        results_by_method['Seasonal-Adjusted'] = sims_seasonal
        
        horizon_label = f"{horizon}M"
        mc_results[target][horizon_label] = {}
        
        for method_name, sims in results_by_method.items():
            pctiles = np.percentile(sims, [5, 25, 50, 75, 95])
            mc_results[target][horizon_label][method_name] = {
                'mean': float(np.mean(sims)),
                'median': float(np.median(sims)),
                'std': float(np.std(sims)),
                'variance': float(np.var(sims)),
                'p5': float(pctiles[0]),
                'p25': float(pctiles[1]),
                'p50': float(pctiles[2]),
                'p75': float(pctiles[3]),
                'p95': float(pctiles[4]),
                'prob_growth': float(np.mean(sims > last_val)),
                'prob_decline': float(np.mean(sims < last_val)),
                'best_case': float(np.max(sims)),
                'expected': float(np.mean(sims)),
                'worst_case': float(np.min(sims)),
                'simulations': sims
            }
            
        print(f"\n  Horizon: {horizon} month(s) | Last observed: {last_val:,.0f}")
        for method_name in results_by_method:
            r = mc_results[target][horizon_label][method_name]
            print(f"    {method_name:20s}: Mean={r['mean']:>12,.0f}  Median={r['median']:>12,.0f}  "
                  f"P5={r['p5']:>12,.0f}  P95={r['p95']:>12,.0f}  "
                  f"P(Growth)={r['prob_growth']:>6.1%}")

# ============================================================================
# 4. DRIVER ANALYSIS
# ============================================================================
print("\n" + "=" * 80)
print("STEP 4: DRIVER ANALYSIS")
print("=" * 80)

driver_analysis = {}

for target in TARGET_VARS:
    if target not in df.columns:
        continue
    print(f"\n--- Driver Analysis for: {target} ---")
    driver_analysis[target] = {}
    
    valid_drivers = [v for v in DRIVER_VARS_FULL if v != target and v not in TARGET_VARS]
    
    # Pearson Correlation
    pearson_corrs = {}
    for driver in valid_drivers:
        mask = df[[target, driver]].notna().all(axis=1)
        if mask.sum() >= 10:
            corr, pval = pearsonr(df.loc[mask, target], df.loc[mask, driver])
            pearson_corrs[driver] = {'correlation': corr, 'p_value': pval, 'n': int(mask.sum())}
    
    # Spearman Rank Correlation
    spearman_corrs = {}
    for driver in valid_drivers:
        mask = df[[target, driver]].notna().all(axis=1)
        if mask.sum() >= 10:
            corr, pval = spearmanr(df.loc[mask, target], df.loc[mask, driver])
            spearman_corrs[driver] = {'correlation': corr, 'p_value': pval}
    
    sorted_pearson = sorted(pearson_corrs.items(), key=lambda x: abs(x[1]['correlation']), reverse=True)
    sorted_spearman = sorted(spearman_corrs.items(), key=lambda x: abs(x[1]['correlation']), reverse=True)
    
    print(f"\n  Top Pearson Correlations:")
    for name, vals in sorted_pearson[:10]:
        sig = "***" if vals['p_value'] < 0.001 else "**" if vals['p_value'] < 0.01 else "*" if vals['p_value'] < 0.05 else ""
        print(f"    {name:40s}: r={vals['correlation']:>7.3f}  p={vals['p_value']:.4f} {sig}")
    
    print(f"\n  Top Spearman Correlations:")
    for name, vals in sorted_spearman[:10]:
        sig = "***" if vals['p_value'] < 0.001 else "**" if vals['p_value'] < 0.01 else "*" if vals['p_value'] < 0.05 else ""
        print(f"    {name:40s}: rho={vals['correlation']:>7.3f}  p={vals['p_value']:.4f} {sig}")
    
    # Multivariate Regression & Feature Importance
    reg_drivers = [v for v in valid_drivers if v in pearson_corrs]
    analysis_df = df[[target] + reg_drivers].dropna()
    
    if len(analysis_df) >= 15:
        X = analysis_df[reg_drivers].values
        y = analysis_df[target].values
        
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        lr = LinearRegression()
        lr.fit(X_scaled, y)
        r2_lr = r2_score(y, lr.predict(X_scaled))
        
        ridge = Ridge(alpha=1.0)
        ridge.fit(X_scaled, y)
        r2_ridge = r2_score(y, ridge.predict(X_scaled))
        
        rf = RandomForestRegressor(n_estimators=500, max_depth=5, random_state=42, n_jobs=-1)
        rf.fit(X_scaled, y)
        r2_rf = r2_score(y, rf.predict(X_scaled))
        
        gb = GradientBoostingRegressor(n_estimators=300, max_depth=3, random_state=42, learning_rate=0.05)
        gb.fit(X_scaled, y)
        r2_gb = r2_score(y, gb.predict(X_scaled))
        
        print(f"\n  Regression R² Scores:")
        print(f"    Linear Regression: {r2_lr:.4f}")
        print(f"    Ridge Regression:  {r2_ridge:.4f}")
        print(f"    Random Forest:     {r2_rf:.4f}")
        print(f"    Gradient Boosting: {r2_gb:.4f}")
        
        rf_importance = dict(zip(reg_drivers, rf.feature_importances_))
        gb_importance = dict(zip(reg_drivers, gb.feature_importances_))
        ridge_importance = dict(zip(reg_drivers, np.abs(ridge.coef_)))
        
        composite_scores = {}
        rf_max = max(rf.feature_importances_) if max(rf.feature_importances_) > 0 else 1
        gb_max = max(gb.feature_importances_) if max(gb.feature_importances_) > 0 else 1
        ridge_max = max(np.abs(ridge.coef_)) if max(np.abs(ridge.coef_)) > 0 else 1
        
        for d in reg_drivers:
            rf_norm = rf_importance.get(d, 0) / rf_max
            gb_norm = gb_importance.get(d, 0) / gb_max
            ridge_norm = ridge_importance.get(d, 0) / ridge_max
            pearson_abs = abs(pearson_corrs.get(d, {}).get('correlation', 0))
            composite_scores[d] = 0.3 * rf_norm + 0.3 * gb_norm + 0.2 * ridge_norm + 0.2 * pearson_abs
        
        sorted_composite = sorted(composite_scores.items(), key=lambda x: x[1], reverse=True)
        
        print(f"\n  Composite Driver Ranking (most to least influential):")
        for rank, (name, score) in enumerate(sorted_composite, 1):
            print(f"    {rank:2d}. {name:40s}: Score={score:.4f}  "
                  f"RF={rf_importance.get(name,0):.4f}  GB={gb_importance.get(name,0):.4f}  "
                  f"Pearson={pearson_corrs.get(name,{}).get('correlation',0):.3f}")
        
        driver_analysis[target] = {
            'pearson': dict(sorted_pearson),
            'spearman': dict(sorted_spearman),
            'r2_scores': {'LR': r2_lr, 'Ridge': r2_ridge, 'RF': r2_rf, 'GB': r2_gb},
            'composite_ranking': sorted_composite,
            'rf_importance': rf_importance,
            'gb_importance': gb_importance,
        }

# ============================================================================
# 5. LAGGED IMPACT ANALYSIS
# ============================================================================
print("\n" + "=" * 80)
print("STEP 5: LAGGED IMPACT ANALYSIS")
print("=" * 80)

lag_results = {}
MAX_LAG = 3

for target in TARGET_VARS:
    if target not in df.columns:
        continue
    print(f"\n--- Lag Analysis for: {target} ---")
    lag_results[target] = {}
    
    valid_drivers = [v for v in DRIVER_VARS_FULL if v != target and v not in TARGET_VARS]
    
    # Lag Correlation
    lag_corr_table = {}
    for driver in valid_drivers:
        lag_corr_table[driver] = {}
        for lag in range(0, MAX_LAG + 1):
            driver_shifted = df[driver].shift(lag)
            mask = pd.notna(df[target]) & pd.notna(driver_shifted)
            if mask.sum() >= 10:
                corr, pval = pearsonr(df.loc[mask, target], driver_shifted[mask])
                sp_corr, sp_pval = spearmanr(df.loc[mask, target], driver_shifted[mask])
                lag_corr_table[driver][f'lag_{lag}'] = {
                    'pearson_r': corr, 'pearson_p': pval,
                    'spearman_r': sp_corr, 'spearman_p': sp_pval,
                    'n': int(mask.sum())
                }
    
    print(f"\n  Lag Correlation Summary (Pearson r):")
    print(f"  {'Driver':40s} {'Lag0':>8s} {'Lag1':>8s} {'Lag2':>8s} {'Lag3':>8s} {'Best Lag':>10s}")
    print(f"  {'-'*40} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*10}")
    
    best_lag_drivers = []
    for driver in valid_drivers:
        row = []
        for lag in range(MAX_LAG + 1):
            key = f'lag_{lag}'
            if key in lag_corr_table.get(driver, {}):
                row.append(lag_corr_table[driver][key]['pearson_r'])
            else:
                row.append(np.nan)
        
        if any(not np.isnan(r) for r in row):
            best_lag_idx = np.nanargmax([abs(r) if not np.isnan(r) else 0 for r in row])
            best_lag_val = row[best_lag_idx]
            best_lag_drivers.append((driver, best_lag_idx, best_lag_val))
            vals_str = '  '.join([f'{r:>7.3f}' if not np.isnan(r) else '    N/A' for r in row])
            print(f"  {driver:40s} {vals_str}  Lag{best_lag_idx} ({best_lag_val:>.3f})")
    
    lag_results[target]['correlation_table'] = lag_corr_table
    lag_results[target]['best_lag_drivers'] = best_lag_drivers
    
    # Predictive Model: Month t -> Month t+1
    print(f"\n  Predictive Model: Month t drivers -> Month t+1 {target}")
    
    lag1_features = {}
    for driver in valid_drivers:
        lag1_features[f'{driver}_lag1'] = df[driver].shift(1)
    
    lag_df = pd.DataFrame(lag1_features, index=df.index)
    lag_df[target] = df[target]
    lag_df = lag_df.dropna()
    
    if len(lag_df) >= 15:
        feature_cols = [c for c in lag_df.columns if c != target]
        X_lag = lag_df[feature_cols].values
        y_lag = lag_df[target].values
        
        scaler_lag = StandardScaler()
        X_lag_scaled = scaler_lag.fit_transform(X_lag)
        
        rf_lag = RandomForestRegressor(n_estimators=500, max_depth=4, random_state=42, n_jobs=-1)
        rf_lag.fit(X_lag_scaled, y_lag)
        r2_lag = r2_score(y_lag, rf_lag.predict(X_lag_scaled))
        
        ridge_lag = Ridge(alpha=1.0)
        ridge_lag.fit(X_lag_scaled, y_lag)
        r2_ridge_lag = r2_score(y_lag, ridge_lag.predict(X_lag_scaled))
        
        gb_lag = GradientBoostingRegressor(n_estimators=300, max_depth=3, random_state=42, learning_rate=0.05)
        gb_lag.fit(X_lag_scaled, y_lag)
        r2_gb_lag = r2_score(y_lag, gb_lag.predict(X_lag_scaled))
        
        print(f"    R² (Ridge, lagged):          {r2_ridge_lag:.4f}")
        print(f"    R² (Random Forest, lagged):  {r2_lag:.4f}")
        print(f"    R² (Gradient Boost, lagged): {r2_gb_lag:.4f}")
        
        lag_fi = dict(zip(feature_cols, rf_lag.feature_importances_))
        gb_lag_fi = dict(zip(feature_cols, gb_lag.feature_importances_))
        ridge_lag_fi = dict(zip(feature_cols, np.abs(ridge_lag.coef_)))
        
        rf_lag_max = max(rf_lag.feature_importances_) if max(rf_lag.feature_importances_) > 0 else 1
        gb_lag_max = max(gb_lag.feature_importances_) if max(gb_lag.feature_importances_) > 0 else 1
        ridge_lag_max = max(np.abs(ridge_lag.coef_)) if max(np.abs(ridge_lag.coef_)) > 0 else 1
        
        lag_composite = {}
        for feat in feature_cols:
            lag_composite[feat] = (
                0.35 * lag_fi.get(feat, 0) / rf_lag_max +
                0.35 * gb_lag_fi.get(feat, 0) / gb_lag_max +
                0.30 * ridge_lag_fi.get(feat, 0) / ridge_lag_max
            )
        
        lag_composite_sorted = sorted(lag_composite.items(), key=lambda x: x[1], reverse=True)
        
        print(f"\n    Top 10 Lagged Predictors (Month t -> Month t+1):")
        for rank, (feat, score) in enumerate(lag_composite_sorted[:10], 1):
            clean_name = feat.replace('_lag1', '')
            print(f"      {rank:2d}. {clean_name:40s}: Composite={score:.4f}  RF_imp={lag_fi.get(feat,0):.4f}")
        
        lag_results[target]['predictive_model'] = {
            'r2_ridge': r2_ridge_lag,
            'r2_rf': r2_lag,
            'r2_gb': r2_gb_lag,
            'feature_importance': sorted(lag_fi.items(), key=lambda x: x[1], reverse=True),
            'composite_ranking': lag_composite_sorted,
            'ridge_coefs': dict(zip(feature_cols, ridge_lag.coef_.tolist())),
        }

# ============================================================================
# 6. SCENARIO & SENSITIVITY ANALYSIS
# ============================================================================
print("\n" + "=" * 80)
print("STEP 6: SCENARIO & SENSITIVITY ANALYSIS")
print("=" * 80)

scenarios = {
    'A: Platform Vol +10%': {'Platform delivered Vol': 1.10},
    'B: Platform Vol +20%': {'Platform delivered Vol': 1.20},
    'C: Seller Vol +10%': {'Seller Delivered Volume': 1.10},
    'D: Seller Vol +20%': {'Seller Delivered Volume': 1.20},
    'E: Open Interest +10%': {'Open Interest': 1.10},
    'F: Open Interest +20%': {'Open Interest': 1.20},
}

scenario_results = {}

for target in TARGET_VARS:
    if target not in df.columns:
        continue
    print(f"\n--- Scenarios for: {target} ---")
    scenario_results[target] = {}
    
    valid_drivers = [v for v in DRIVER_VARS_FULL if v != target and v not in TARGET_VARS]
    
    lag1_features = {}
    for driver in valid_drivers:
        lag1_features[f'{driver}_lag1'] = df[driver].shift(1)
    
    lag_df = pd.DataFrame(lag1_features, index=df.index)
    lag_df[target] = df[target]
    lag_df = lag_df.dropna()
    
    if len(lag_df) >= 15:
        feature_cols = [c for c in lag_df.columns if c != target]
        X_lag = lag_df[feature_cols].values
        y_lag = lag_df[target].values
        
        scaler_s = StandardScaler()
        X_lag_scaled = scaler_s.fit_transform(X_lag)
        
        ridge_s = Ridge(alpha=1.0)
        ridge_s.fit(X_lag_scaled, y_lag)
        
        baseline_row = {}
        for driver in valid_drivers:
            col_name = f'{driver}_lag1'
            # Use last non-NaN value
            last_val = df[driver].dropna().iloc[-1] if df[driver].notna().any() else 0
            baseline_row[col_name] = last_val
        
        baseline_df = pd.DataFrame([baseline_row])
        # Ensure no NaN
        baseline_df = baseline_df.fillna(0)
        baseline_scaled = scaler_s.transform(baseline_df[feature_cols].values)
        baseline_pred = ridge_s.predict(baseline_scaled)[0]
        
        print(f"  Baseline Prediction (using {df.index[-1].strftime('%b %Y')} values): {baseline_pred:,.0f}")
        
        for scenario_name, changes in scenarios.items():
            modified_row = baseline_row.copy()
            for var, multiplier in changes.items():
                col = f'{var}_lag1'
                if col in modified_row:
                    modified_row[col] = modified_row[col] * multiplier
            
            modified_df = pd.DataFrame([modified_row])
            modified_df = modified_df.fillna(0)
            modified_scaled = scaler_s.transform(modified_df[feature_cols].values)
            modified_pred = ridge_s.predict(modified_scaled)[0]
            
            change_abs = modified_pred - baseline_pred
            change_pct = (modified_pred - baseline_pred) / abs(baseline_pred) * 100 if baseline_pred != 0 else 0
            
            scenario_results[target][scenario_name] = {
                'baseline': float(baseline_pred),
                'predicted': float(modified_pred),
                'change_absolute': float(change_abs),
                'change_percent': float(change_pct),
            }
            
            print(f"    {scenario_name:30s}: Predicted={modified_pred:>12,.0f}  "
                  f"Change={change_abs:>+10,.0f} ({change_pct:>+6.1f}%)")

# ============================================================================
# 7. VISUALIZATIONS
# ============================================================================
print("\n" + "=" * 80)
print("STEP 7: GENERATING VISUALIZATIONS")
print("=" * 80)

# 7a. Time-series trends for targets
fig, axes = plt.subplots(2, 2, figsize=(16, 10))
fig.suptitle('Target Variables: Time-Series Trends (Oct 2022 – Apr 2026)', fontsize=14, fontweight='bold')
colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728']

for idx, (target, ax) in enumerate(zip(TARGET_VARS, axes.flat)):
    if target not in df.columns:
        ax.set_visible(False)
        continue
    series = df[target].dropna()
    ax.plot(series.index, series.values, color=colors[idx], linewidth=2, marker='o', markersize=3)
    ax.fill_between(series.index, series.values, alpha=0.1, color=colors[idx])
    
    x_num = np.arange(len(series))
    z = np.polyfit(x_num, series.values, 1)
    trend = np.polyval(z, x_num)
    ax.plot(series.index, trend, '--', color='gray', linewidth=1, alpha=0.7, label=f'Trend (slope={z[0]:,.0f}/mo)')
    
    ax.set_title(target, fontweight='bold')
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)
    ax.tick_params(axis='x', rotation=45)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x:,.0f}'))

plt.tight_layout()
plt.savefig(os.path.join(OUTPUT_DIR, '01_time_series_trends.png'))
plt.close()
print("  Saved: 01_time_series_trends.png")

# 7b. Correlation Heatmap
numeric_cols = [c for c in df.select_dtypes(include=[np.number]).columns if df[c].notna().sum() >= 20]
corr_matrix = df[numeric_cols].corr()

fig, ax = plt.subplots(figsize=(20, 16))
mask = np.triu(np.ones_like(corr_matrix, dtype=bool))
sns.heatmap(corr_matrix, mask=mask, annot=True, fmt='.2f', cmap='RdBu_r', center=0,
            square=True, linewidths=0.5, ax=ax, annot_kws={'size': 6},
            vmin=-1, vmax=1)
ax.set_title('Correlation Heatmap (All Variables with >=20 observations)', fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig(os.path.join(OUTPUT_DIR, '02_correlation_heatmap.png'))
plt.close()
print("  Saved: 02_correlation_heatmap.png")

# 7c. Monte Carlo Forecast Distributions
for target in TARGET_VARS:
    if target not in mc_results:
        continue
    fig, axes = plt.subplots(2, 2, figsize=(16, 10))
    fig.suptitle(f'Monte Carlo Forecast Distributions: {target}', fontsize=14, fontweight='bold')
    
    for h_idx, horizon in enumerate(['1M', '3M', '6M', '12M']):
        ax = axes.flat[h_idx]
        methods = mc_results[target][horizon]
        
        for method_name, r in methods.items():
            sims = r['simulations']
            ax.hist(sims, bins=80, alpha=0.4, label=f"{method_name} (μ={r['mean']:,.0f})", density=True)
        
        last_val = df[target].dropna().iloc[-1]
        ax.axvline(last_val, color='black', linewidth=2, linestyle='--', label=f'Last Observed ({last_val:,.0f})')
        
        ax.set_title(f'{horizon} Horizon', fontweight='bold')
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x:,.0f}'))
    
    plt.tight_layout()
    safe_name = target.replace(' ', '_').replace('(', '').replace(')', '')
    plt.savefig(os.path.join(OUTPUT_DIR, f'03_mc_dist_{safe_name}.png'))
    plt.close()
    print(f"  Saved: 03_mc_dist_{safe_name}.png")

# 7d. Confidence Interval Charts
for target in TARGET_VARS:
    if target not in mc_results:
        continue
    fig, ax = plt.subplots(figsize=(14, 7))
    
    series = df[target].dropna()
    ax.plot(series.index, series.values, 'b-o', markersize=4, linewidth=1.5, label='Historical')
    
    last_date = series.index[-1]
    
    future_dates = [last_date + pd.DateOffset(months=h) for h in HORIZONS]
    means = [mc_results[target][f'{h}M']['Parametric']['mean'] for h in HORIZONS]
    p5s = [mc_results[target][f'{h}M']['Parametric']['p5'] for h in HORIZONS]
    p25s = [mc_results[target][f'{h}M']['Parametric']['p25'] for h in HORIZONS]
    p75s = [mc_results[target][f'{h}M']['Parametric']['p75'] for h in HORIZONS]
    p95s = [mc_results[target][f'{h}M']['Parametric']['p95'] for h in HORIZONS]
    
    ax.plot(future_dates, means, 'r-s', markersize=6, linewidth=2, label='Forecast Mean')
    ax.fill_between(future_dates, p5s, p95s, alpha=0.15, color='red', label='90% CI (P5-P95)')
    ax.fill_between(future_dates, p25s, p75s, alpha=0.3, color='red', label='50% CI (P25-P75)')
    
    ax.set_title(f'Forecast with Confidence Intervals: {target}', fontsize=13, fontweight='bold')
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.3)
    ax.tick_params(axis='x', rotation=45)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{x:,.0f}'))
    
    plt.tight_layout()
    safe_name = target.replace(' ', '_').replace('(', '').replace(')', '')
    plt.savefig(os.path.join(OUTPUT_DIR, f'04_ci_chart_{safe_name}.png'))
    plt.close()
    print(f"  Saved: 04_ci_chart_{safe_name}.png")

# 7e. Lag-Correlation Heatmap
for target in TARGET_VARS:
    if target not in lag_results or 'correlation_table' not in lag_results[target]:
        continue
    lag_table = lag_results[target]['correlation_table']
    
    drivers_list = [d for d in lag_table.keys() if any(f'lag_{l}' in lag_table[d] for l in range(MAX_LAG+1))]
    lag_matrix = np.full((len(drivers_list), MAX_LAG + 1), np.nan)
    
    for i, driver in enumerate(drivers_list):
        for lag in range(MAX_LAG + 1):
            key = f'lag_{lag}'
            if key in lag_table[driver]:
                lag_matrix[i, lag] = lag_table[driver][key]['pearson_r']
    
    fig, ax = plt.subplots(figsize=(10, max(8, len(drivers_list) * 0.45)))
    sns.heatmap(lag_matrix, annot=True, fmt='.2f', cmap='RdBu_r', center=0,
                xticklabels=[f'Lag {l}' for l in range(MAX_LAG + 1)],
                yticklabels=drivers_list, ax=ax, vmin=-1, vmax=1,
                linewidths=0.5)
    ax.set_title(f'Lag Correlation Heatmap: Drivers -> {target}', fontsize=13, fontweight='bold')
    plt.tight_layout()
    safe_name = target.replace(' ', '_').replace('(', '').replace(')', '')
    plt.savefig(os.path.join(OUTPUT_DIR, f'05_lag_heatmap_{safe_name}.png'))
    plt.close()
    print(f"  Saved: 05_lag_heatmap_{safe_name}.png")

# 7f. Feature Importance Charts (concurrent)
for target in TARGET_VARS:
    if target not in driver_analysis or 'composite_ranking' not in driver_analysis[target]:
        continue
    ranking = driver_analysis[target]['composite_ranking']
    names = [r[0] for r in ranking[:15]]
    scores = [r[1] for r in ranking[:15]]
    
    fig, ax = plt.subplots(figsize=(12, 7))
    bars = ax.barh(range(len(names)), scores, color=plt.cm.viridis(np.linspace(0.2, 0.9, len(names))))
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel('Composite Importance Score', fontsize=11)
    ax.set_title(f'Feature Importance Ranking: {target}', fontsize=13, fontweight='bold')
    
    for bar, score in zip(bars, scores):
        ax.text(bar.get_width() + 0.005, bar.get_y() + bar.get_height()/2,
                f'{score:.3f}', va='center', fontsize=8)
    
    ax.grid(True, alpha=0.3, axis='x')
    plt.tight_layout()
    safe_name = target.replace(' ', '_').replace('(', '').replace(')', '')
    plt.savefig(os.path.join(OUTPUT_DIR, f'06_feature_importance_{safe_name}.png'))
    plt.close()
    print(f"  Saved: 06_feature_importance_{safe_name}.png")

# 7g. Lagged Feature Importance
for target in TARGET_VARS:
    if target not in lag_results or 'predictive_model' not in lag_results[target]:
        continue
    ranking = lag_results[target]['predictive_model']['composite_ranking'][:15]
    names = [r[0].replace('_lag1', '') for r in ranking]
    scores = [r[1] for r in ranking]
    
    fig, ax = plt.subplots(figsize=(12, 7))
    bars = ax.barh(range(len(names)), scores, color=plt.cm.plasma(np.linspace(0.2, 0.9, len(names))))
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel('Composite Importance Score (Lagged)', fontsize=11)
    ax.set_title(f'Leading Indicators: Month t -> Month t+1 {target}', fontsize=13, fontweight='bold')
    
    for bar, score in zip(bars, scores):
        ax.text(bar.get_width() + 0.005, bar.get_y() + bar.get_height()/2,
                f'{score:.3f}', va='center', fontsize=8)
    
    ax.grid(True, alpha=0.3, axis='x')
    plt.tight_layout()
    safe_name = target.replace(' ', '_').replace('(', '').replace(')', '')
    plt.savefig(os.path.join(OUTPUT_DIR, f'07_lag_importance_{safe_name}.png'))
    plt.close()
    print(f"  Saved: 07_lag_importance_{safe_name}.png")

# 7h. Scenario Analysis Charts
fig, axes = plt.subplots(2, 2, figsize=(16, 10))
fig.suptitle('Scenario Analysis: Impact on Target Variables (Next Month)', fontsize=14, fontweight='bold')

for idx, (target, ax) in enumerate(zip(TARGET_VARS, axes.flat)):
    if target not in scenario_results or not scenario_results[target]:
        ax.set_visible(False)
        continue
    
    sc_names = list(scenario_results[target].keys())
    changes_pct = [scenario_results[target][s]['change_percent'] for s in sc_names]
    
    x_pos = np.arange(len(sc_names))
    colors_sc = ['#2ecc71' if c > 0 else '#e74c3c' for c in changes_pct]
    
    bars = ax.bar(x_pos, changes_pct, color=colors_sc, alpha=0.8, edgecolor='black', linewidth=0.5)
    ax.set_xticks(x_pos)
    ax.set_xticklabels([s.split(':')[0] for s in sc_names], fontsize=8, rotation=45)
    ax.set_ylabel('% Change from Baseline')
    ax.set_title(target, fontweight='bold')
    ax.axhline(0, color='black', linewidth=0.8)
    ax.grid(True, alpha=0.3, axis='y')
    
    for bar, pct in zip(bars, changes_pct):
        offset = 0.1 if pct >= 0 else -0.5
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + offset,
                f'{pct:+.1f}%', ha='center', va='bottom' if pct >= 0 else 'top', fontsize=8, fontweight='bold')

plt.tight_layout()
plt.savefig(os.path.join(OUTPUT_DIR, '08_scenario_analysis.png'))
plt.close()
print("  Saved: 08_scenario_analysis.png")

# 7i. Driver-Target correlation heatmap
target_driver_corr = pd.DataFrame()
for target in TARGET_VARS:
    if target not in df.columns:
        continue
    for driver in DRIVER_VARS_FULL:
        if driver not in TARGET_VARS:
            mask = df[[target, driver]].notna().all(axis=1)
            if mask.sum() >= 10:
                corr, _ = pearsonr(df.loc[mask, target], df.loc[mask, driver])
                target_driver_corr.loc[driver, target] = corr

if not target_driver_corr.empty:
    fig, ax = plt.subplots(figsize=(12, max(8, len(target_driver_corr) * 0.4)))
    sns.heatmap(target_driver_corr, annot=True, fmt='.2f', cmap='RdBu_r', center=0,
                linewidths=0.5, ax=ax, vmin=-1, vmax=1)
    ax.set_title('Driver-Target Correlation Matrix', fontsize=13, fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '09_driver_target_corr.png'))
    plt.close()
    print("  Saved: 09_driver_target_corr.png")

# ============================================================================
# 8. SAVE RESULTS
# ============================================================================
print("\n" + "=" * 80)
print("STEP 8: SAVING RESULTS")
print("=" * 80)

mc_results_json = {}
for target in mc_results:
    mc_results_json[target] = {}
    for horizon in mc_results[target]:
        mc_results_json[target][horizon] = {}
        for method in mc_results[target][horizon]:
            r = mc_results[target][horizon][method].copy()
            del r['simulations']
            mc_results_json[target][horizon][method] = r

with open(os.path.join(OUTPUT_DIR, 'analysis_results.json'), 'w') as f:
    json.dump({
        'data_summary': {
            'time_range': f"{df.index.min().strftime('%B %Y')} to {df.index.max().strftime('%B %Y')}",
            'observations': len(df),
            'variables': len(df.columns),
        },
        'monte_carlo': mc_results_json,
        'scenario_analysis': scenario_results,
    }, f, indent=2, default=str)

print("  Results saved to output/analysis_results.json")
print("\n" + "=" * 80)
print("ANALYSIS COMPLETE")
print("=" * 80)
