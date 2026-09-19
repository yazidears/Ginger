# GingerO2

GingerO2 is an experimental fire-scenario workspace with an optional learned grass spread component. It is not a validated incident forecast and does not account for everything.

## What the controls mean

| Previously | Now | What it does |
|---|---|---|
| Changes | Compare runs | Compare two scenarios and inspect changed inputs and outcomes. |
| What if | Try a scenario | Change wind, moisture or ignition while reusing the same input snapshot. The example turns wind 45 degrees after 30 minutes. |
| Correct | Update perimeter | Import an observed fire boundary to update the scenario; this does not certify the model as correct. |
| Observe | Where to observe | Inspect disagreement between scenarios and identify potentially useful observations; this is not safe access guidance. |
| Exposure | Infrastructure exposure | Inspect which mapped assets the simulated spread reaches. |
| Thermal | Thermal history | Inspect available satellite heat observations, whose coverage and timing can be incomplete. |

The map now has a wind compass, explicit wind-from and wind-toward bearings, and an optional smoke illustration. Scrubbing the timeline updates wind and smoke. Smoke puffs follow changing wind and spread with time; they do not predict pollutant concentration, visibility, breathing safety, plume rise or building-scale airflow. Recent fire-front movement is a separate retrospective indicator, and is withheld when there is no clear signal.

## Model evidence

A constrained wind-and-moisture model was trained on 120 Australian grass fires across 14 burn-day groups. Nested validation holds complete days out. Average absolute spread-speed error is **25.15 m/min for the baseline versus 20.41 m/min for the candidate with support fallback**, an 18.9% reduction. The paired-day uncertainty interval includes no improvement. The data were previously examined during O1 work; this is not new independent validation.

Enable **Experimental GingerO2 grass spread** under Scenario setup's advanced assumptions to use the fitted component. Default remains the physics model. Runtime requires mapped grass, terrain slope at most 2%, no rain, midflame wind 2.16–25.2 km/h and dead moisture 0.7–12.1%. Unsupported cells use the existing physics. Learned speed does not calibrate heat: radiant screening is withheld when the learned component participates. Run metadata records artifact identity, selected mode and calculation/fallback counts.

Building transfer remains a hypothetical gap-and-delay model, independent of wind. Ember transport, crown-fire transitions, materials, suppression and CFD airflow are not added by this release. More compute does not replace independent validation of these processes.

See [training methodology](GINGER-O2-TRAINING.md) and [smoke implementation](GINGER-O2-SMOKE.md). Artifacts: `data/ginger-o2/grass-model.json`, `reports/ginger-o2/grass-training.json`.

## Reproduce

```sh
npm run train:ginger-o2
npm run typecheck:ginger-o2
npm run test:ginger-o2
npm run test:sage
npm run test:investigation
```

## Where Nebius could help

Token Factory's agent and retrieval examples could support explanations grounded in exported run data and documented assumptions, plus natural-language scenario setup. Its LLM fine-tuning recipes are not a replacement for training and validating a fire-spread model. Custom physical-model training and larger ensembles require confirmation of suitable compute and promo eligibility. No Nebius account, credit redemption, upload or paid execution is configured by this change.
