"""Render the completed benchmark reports with matplotlib (no live model calls)."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[1] / "reports/ginger-o1"
field = json.loads((root / "field-backtest.json").read_text())
grid = json.loads((root / "grid-benchmark.json").read_text())
if grid.get("status") != "passed":
    raise ValueError("Numerical benchmark has not passed")

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, axes = plt.subplots(1, 2, figsize=(12, 5.4), layout="constrained")
fig.suptitle("GingerO1 0.1.0 · first evaluation", fontsize=18, fontweight="bold")
ax = axes[0]
for split, color, label in [("train", "#9aa4aa", "Training: 54 fires"), ("validation", "#287c79", "Validation: 31 fires"), ("test", "#cb5d35", "Held-out: 35 fires")]:
    rows = [r for r in field["rows"] if r["split"] == split]
    ax.scatter([r["observed"] for r in rows], [r["baselineMMin"] for r in rows], c=color, label=label, s=28, alpha=.8, edgecolors="white", linewidth=.4)
limit = max(max(r["observed"], r["baselineMMin"]) for r in field["rows"]) * 1.05
ax.plot([0, limit], [0, limit], "--", color="#667078", linewidth=1, label="Exact agreement")
ax.set(xlim=(0, limit), ylim=(0, limit), xlabel="Observed head-fire spread (m/min)", ylabel="Modelled head-fire spread (m/min)", title="Historical grass-fire component test")
ax.legend(frameon=False, fontsize=8, loc="upper left")
ax.text(0, -.24, f"Held-out MAE: {field['test']['baseline']['mae']:.2f} m/min\nTraining-fitted calibration rejected on validation.", transform=ax.transAxes, fontsize=10)

ax = axes[1]
labels = [("1", "Grass"), ("6", "Scrub"), ("9", "Forest litter")]
for offset, key, color, label in [(-.18, "legacy", "#9aa4aa", "Previous 8 directions"), (.18, "ginger", "#287c79", "GingerO1: 16 directions")]:
    values = []
    for fuel, _ in labels:
        rows = [r for r in grid["details"] if r["fuel"] == fuel and r["status"] == "scored"]
        values.append(100 * sum(r[key]["meanRelativeError"] for r in rows) / len(rows))
    bars = ax.bar([i + offset for i in range(3)], values, .34, color=color, label=label)
    ax.bar_label(bars, labels=[f"{v:.1f}%" for v in values], padding=4, fontsize=9)
ax.set_xticks(range(3), [label for _, label in labels])
ax.set(ylabel="Mean relative timing error (%)", title="Analytical grid verification · synthetic")
ax.legend(frameon=False, fontsize=8)
ax.set_ylim(0, max(ax.get_ylim()[1], 23))
ax.text(0, -.24, f"{grid['scoredCases']} scored cases; {grid['unscoredCases']} lack distant reach within 4 h.\nNumerical improvement is not measured field improvement.", transform=ax.transAxes, fontsize=10)
for ax in axes:
    ax.grid(axis="y", alpha=.12)
    ax.set_axisbelow(True)
fig.savefig(root / "evaluation.png", dpi=180, facecolor="white")
fig.savefig(root / "evaluation.pdf", facecolor="white")
print(root / "evaluation.png")
