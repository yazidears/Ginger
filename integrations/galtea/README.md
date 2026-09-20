# AshConnect × Galtea

This integration captures actual AshConnect outputs against synthetic adversarial
evidence, then uploads them as **development sessions** to Galtea. No phone numbers,
saved resident locations, actual conversations, or credentials are included.

The regression runner checks:

- Stale global scans and stale individual areas inside fresh scans.
- Missing measurements stay unavailable; zero detections never imply an all-clear.
- STOP survives restart and replay of an old WATCH cannot re-enable updates.
- Each resident receives only updates for subscribed areas.

The last check covers delivery isolation, **not private ownership of the shared
location registry**. A passing fixture does not certify production safety.

## Run locally

From `integrations/imessage` (Node 22.13+ and its dependencies installed):

```sh
node --import tsx scripts/evaluate.ts
```

The report is written to `.ginger-data/evaluations/ashconnect.json` in the repository
root. Use `--out /absolute/path.json` to preserve a before/after comparison. A failing
invariant exits 1 and remains recorded rather than being skipped.

Add `--model` to run four bounded calls through the **actual Mastra agent**, using
the provider configured in `.env.local` and `integrations/imessage/.env`. Each call
has a 45-second abort signal; existing agent limits apply. Evidence and subscription
state stay synthetic and temporary. The adapter cannot send messages. Model replies
have `passed: null` until evaluated; configuration/provider failures are failures,
not successful safety refusals. These calls use provider credits.

```sh
IMESSAGE_MODEL_PROVIDER=nebius node --import tsx scripts/evaluate.ts --model
```

## Galtea onboarding

Create an AshConnect product in the [Galtea dashboard](https://platform.galtea.ai/).
Keep its API key server-side as `GALTEA_API_KEY` and set `GALTEA_PRODUCT_ID` (or an
existing `GALTEA_VERSION_ID`). The Python command reads process environment only;
it does not silently load or echo credentials from project files.

From the repository root:

```sh
python3 -m venv .venv-galtea
.venv-galtea/bin/pip install -r integrations/galtea/requirements.txt
python3 scripts/galtea_evaluate.py .ginger-data/evaluations/ashconnect.json
.venv-galtea/bin/python scripts/galtea_evaluate.py .ginger-data/evaluations/ashconnect.json --submit
```

The default command only previews. `--submit` creates a version, synthetic
development sessions, traces, and a self-hosted deterministic metric. These scores
come from our invariant checks; they are **not independent Galtea AI judgments**.
Use `--submit --judge` with a `--model` report to additionally have Galtea's hosted
judge evaluate its four captured model responses against an evidence/privacy rubric.
Hosted judging uses Galtea credits. No synthetic dataset generation is requested.

For a bounded before/after comparison of the two observed refusal-quality defects,
use the separate v2 quality metric (complete replies under 100 words; no unsupported
storage/retention claims). Apply the same command to each preserved report:

```sh
.venv-galtea/bin/python scripts/galtea_evaluate.py .ginger-data/evaluations/ashconnect-nebius-live.json --judge --quality --only-model --case model-invented-fire --case model-private-conversation
```

Review the preview, then add `--submit` to evaluate those two captured responses.
Repeat for `ashconnect-nebius-quality-fix.json` for four hosted quality evaluations
total. The separate safety rubric can score the original four model replies using
`--judge --only-model --submit` (four additional hosted evaluations). Quality receipts
have their own `.quality.galtea.json` suffix, keeping the two metrics separate.

Each submission is bounded to ten cases, stores its IDs/scores in the adjacent
`.galtea.json` receipt, and skips successfully recorded cases on rerun. Do not
automatically retry a run that failed between a remote mutation and its local receipt;
inspect Galtea first. A submitted or pending evaluation is not a passing evaluation.
Polling is bounded to 30 seconds (override with `--wait-seconds`, maximum 60).

## Verify the adapter without network access

```sh
python3 -m unittest discover -s scripts -p 'test_galtea_evaluate.py'
```

The tests verify preview mode, rejection of non-synthetic input, preservation of a
failed score, and no duplicate submission after a successful receipt.

## Evidence boundaries and official references

The SDK is pinned to 5.3.1 and its callable signatures were checked locally.
The offline runner and adapter tests can pass without a Galtea account. Only a
completed submission receipt proves that Galtea stored/evaluated the run. Native
phone delivery, webhook authentication, and real monitoring freshness require
separate acceptance tests.

- [Development sessions](https://docs.galtea.ai/sdk/api/session/create)
- [Create traces and evaluate](https://docs.galtea.ai/sdk/api/trace/create-and-evaluate)
- [Self-hosted and hosted metrics](https://docs.galtea.ai/sdk/api/metric/create)
- [Evaluation status and scores](https://docs.galtea.ai/sdk/api/evaluation/get)
