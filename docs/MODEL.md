# Demo model and assumptions

The 12:00–12:45 Catalonia scenario is deterministic and replayable. The initial screen opens at 12:30 to provide an immediately useful operational overview; Reset starts the complete detection journey.

The synthetic ignition center is 1.86°E, 41.30°N. A wind-oriented, irregular ellipse expands at a nominal head rate of 0.040 km/min (2.4 km/h). Seven wind/fuel perturbations per rank produce nested convex-hull envelopes. “50/75/90” are illustrative scenario ranks, **not calibrated probabilities or statistical coverage**. Confidence is a heuristic score, not measurement precision.

Demo assets are placed along the modeled front to yield initial arrivals of 31, 48, 61 and 84 minutes. These are fictional scenario-site inventories; names do not establish the location of a real school or settlement. Arrival is computed by point/perimeter intersection at one-minute increments. Evacuation time is preparation + population/(exit capacity × exit count) × congestion + route travel at an assumed 30 km/h × congestion, rounded up. Safety margin is fire arrival minus this estimate. Zero exits yield an intentionally infeasible estimate. Vulnerability, warning dissemination, compliance and traffic dynamics are not modeled.

At 12:40 wind shifts and strengthens; at 12:42 a new synthetic observation lands beyond the previous 75-rank envelope. The demonstration applies a 1.29 front stretch with fuel-aligned heading change and recalculates arrivals. Les Colines has 640 modeled people, two exits at 22 people/min each, a 4 km route, 1.2× congestion and 12 minutes preparation. Its modeled 40-minute evacuation estimate gives a +21 minute initial margin and +6 minute updated margin. This is a calibrated narrative, not a validated forecast.

Observed perimeter snapshots are fixed between observation updates; the timeline horizon controls projected growth. The route polyline is a schematic potential corridor, not a routing-service result. A road asset intersection alone cannot certify corridor traversability. Camera confidence and thermal maps are synthetic. The briefing composes validated scenario values with source references and never predicts physics itself.

Run `npm test` for deterministic state, temporal milestones, geometry, exact narrative values, exit capacity, source parsing and false-positive thermal checks.
