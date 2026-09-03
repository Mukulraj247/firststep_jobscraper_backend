# ML artifacts

Generated locally (not committed):

- `job_category_ml.joblib` — trained model
- `ml_meta.json` — train metrics + eval baseline
- `eval_baseline.json` — rules vs rules+ML report

Train:

```bash
python scripts/train_ml_model.py
python scripts/eval_rules_vs_ml.py
```
