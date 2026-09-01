# Cross-link inference: what each gate contributes

Captured 2026-09-01T22:27:03.420Z over 26 shards from `C:\Users\gugum\code\vitral\vitral\eval\runs\2026-09-01T22-23-07-744Z.json`, with candidates and cohort statistics from the product's own similarity route.

**This measures selectivity, not accuracy.** Whether an admitted link is *correct* needs labels the study does not have; the one project with inferred links had all of them deleted as cascades when their cards were deleted, so no link was ever judged. What is answerable, and what the ablation below answers, is what each gate admits and refuses.

## Gate ablation

Each row is the shipped decision rule with one threshold neutralised, run over the same corpus. *Max degree* is the hub the separation gate exists to prevent.

| Configuration | Links | Distinct pairs | Cards linked | Max degree | Mean cosine |
| --- | --- | --- | --- | --- | --- |
| shipped rule | 10 | 6 | 12 | 2 | 0.876 |
| no level floor | 11 | 7 | 14 | 2 | 0.853 |
| no separation gate | 16 | 9 | 16 | 3 | 0.859 |
| no degree cap | 10 | 6 | 12 | 2 | 0.876 |
| no twin rule | 17 | 11 | 16 | 3 | 0.843 |
| no gates at all | 38 | 26 | 19 | 9 | 0.686 |

## Threshold sensitivity

The shipped values were set from eight hand-checked pairs on one project. These curves say whether they sit on a plateau, where being slightly wrong costs little, or on a cliff.

**`ABSOLUTE_FLOOR`** (shipped: 0.7)

| Value | Links | Distinct pairs | Max degree |
| --- | --- | --- | --- |
| 0.5 | 11 | 7 | 2 |
| 0.6 | 11 | 7 | 2 |
| 0.65 | 10 | 6 | 2 |
| **0.7** | 10 | 6 | 2 |
| 0.75 | 10 | 6 | 2 |
| 0.8 | 10 | 6 | 2 |
| 0.85 | 7 | 4 | 2 |
| 0.9 | 3 | 2 | 2 |

**`SEPARATION_MARGIN`** (shipped: 0.15)

| Value | Links | Distinct pairs | Max degree |
| --- | --- | --- | --- |
| 0 | 16 | 9 | 3 |
| 0.05 | 15 | 8 | 3 |
| 0.1 | 13 | 7 | 2 |
| **0.15** | 10 | 6 | 2 |
| 0.2 | 9 | 5 | 2 |
| 0.25 | 4 | 3 | 2 |
| 0.3 | 1 | 1 | 1 |

## Links the shipped rule admits

| Kind | Cosine | Margin | From | To |
| --- | --- | --- | --- | --- |
| referenced_by | 0.855 | 0.300 | Temporal data potential for time-series analysis | Temporal data enables time-series potential |
| referenced_by | 0.873 | 0.224 | Coordinate validation for mapping | Validate coordinate data for mapping |
| iteration_of | 0.855 | 0.285 | Temporal data enables time-series potential | Temporal data potential for time-series analysis |
| referenced_by | 0.835 | 0.378 | Identify key attributes for visualization focus | Visualization preparation & focus attribute identification |
| referenced_by | 0.843 | 0.222 | Curb Ramp Information System (CRIS) data source | San Francisco curb ramps dataset (CRIS) |
| iteration_of | 0.933 | 0.273 | Prepare dataset for visualization tool | Prepare dataset for visualization tool development |
| referenced_by | 0.843 | 0.249 | San Francisco curb ramps dataset (CRIS) | Curb Ramp Information System (CRIS) data source |
| referenced_by | 0.873 | 0.225 | Validate coordinate data for mapping | Coordinate validation for mapping |
| iteration_of | 0.916 | 0.157 | Data dictionary usage | Data dictionary |
| referenced_by | 0.933 | 0.238 | Prepare dataset for visualization tool development | Prepare dataset for visualization tool |
