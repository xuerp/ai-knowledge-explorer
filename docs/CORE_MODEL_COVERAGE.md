# Core Model Coverage

Generated from `product/core-models.v1.json` and `backend/data/demo_snapshot.json` for manifest 2026-09-05.
Counts describe the baseline composed with catalog_extension.json and frontier_catalog_v1.json; zeroes are visible gaps, not invented content targets.
A nonzero dimension does not mean every field is known. Missing prices, access channels and release dates remain explicit on each release; retired models and open weights may have no current API rate.

| Model           | Tier   | Releases | Product lines | Timeline | Capabilities | Limitations | Releases with pricing | Releases with access | Relations | Official sources |
| --------------- | ------ | -------: | ------------: | -------: | -----------: | ----------: | --------------------: | -------------------: | --------: | ---------------: |
| GPT family      | anchor |       40 |            17 |       55 |            3 |           3 |                    40 |                   16 |        51 |               67 |
| Claude family   | anchor |       23 |             4 |       34 |            3 |           3 |                    23 |                    5 |        28 |               40 |
| Gemini family   | anchor |       54 |            12 |       65 |            3 |           3 |                    33 |                   35 |        57 |               46 |
| DeepSeek family | core   |       19 |             4 |       26 |            3 |           3 |                    18 |                    4 |        22 |               29 |
| Qwen            | core   |       25 |             6 |       29 |            3 |           3 |                    25 |                    7 |        28 |               36 |
| Kimi            | core   |        8 |             2 |       13 |            3 |           3 |                     8 |                    4 |        11 |               23 |
| Doubao          | core   |       11 |             5 |       16 |            3 |           3 |                    10 |                    4 |        14 |               20 |
| ERNIE Bot       | core   |       16 |             4 |       17 |            3 |           3 |                    14 |                   12 |        18 |               21 |

## Zero-count dimensions

- None

## Product-line iteration coverage

Counts follow publicly documented releases and meaningful updates, not equal quotas. A current catalog review is excluded from the evolution timeline. Dated coverage checks every confirmed version against its linked family milestone; it does not claim an exhaustive vendor archive.

| Family          | Product line                  | Records | Confirmed dates | Linked milestones | Date range              |
| --------------- | ----------------------------- | ------: | --------------: | ----------------: | ----------------------- |
| GPT family      | GPT-4o                        |       2 |               2 |                 2 | 2024-05-13 → 2024-07-18 |
| GPT family      | GPT-4.5                       |       1 |               1 |                 1 | 2025-02-27 → 2025-02-27 |
| GPT family      | GPT-5                         |       3 |               3 |                 3 | 2025-08-07 → 2025-08-07 |
| GPT family      | GPT-6                         |       3 |               3 |                 3 | 2026-09-03 → 2026-09-22 |
| GPT family      | GPT-6.1                       |       1 |               1 |                 1 | 2026-09-29 → 2026-09-29 |
| GPT family      | GPT Image                     |       4 |               4 |                 4 | 2025-04-23 → 2026-09-08 |
| GPT family      | GPT Live                      |       1 |               1 |                 1 | 2026-09-10 → 2026-09-10 |
| GPT family      | GPT Realtime                  |       3 |               3 |                 3 | 2025-08-28 → 2026-07-06 |
| GPT family      | GPT TTS                       |       1 |               1 |                 1 | 2025-03-20 → 2025-03-20 |
| GPT family      | GPT Transcribe                |       2 |               2 |                 2 | 2025-03-20 → 2026-07-28 |
| GPT family      | GPT-5.6                       |       3 |               3 |                 3 | 2026-07-09 → 2026-07-09 |
| GPT family      | GPT-5.5                       |       2 |               2 |                 2 | 2026-04-24 → 2026-04-24 |
| GPT family      | GPT-4.1                       |       3 |               3 |                 3 | 2025-04-14 → 2025-04-14 |
| GPT family      | GPT-5.1                       |       2 |               2 |                 2 | 2025-11-13 → 2025-11-13 |
| GPT family      | GPT-5.2                       |       3 |               3 |                 3 | 2025-12-11 → 2025-12-11 |
| GPT family      | GPT-5.3                       |       2 |               2 |                 2 | 2026-02-05 → 2026-03-03 |
| GPT family      | GPT-5.4                       |       4 |               4 |                 4 | 2026-03-05 → 2026-03-17 |
| Claude family   | Claude Sonnet                 |       9 |               9 |                 9 | 2024-03-04 → 2026-09-28 |
| Claude family   | Claude Fable                  |       2 |               2 |                 2 | 2026-06-09 → 2026-09-01 |
| Claude family   | Claude Opus                   |       9 |               9 |                 9 | 2024-03-04 → 2026-09-22 |
| Claude family   | Claude Haiku                  |       3 |               3 |                 3 | 2024-03-13 → 2025-10-15 |
| Gemini family   | Gemini Pro                    |       9 |               9 |                 9 | 2023-12-13 → 2026-02-19 |
| Gemini family   | Gemini Flash                  |       9 |               9 |                 9 | 2024-05-23 → 2026-09-02 |
| Gemini family   | Gemini Flash-Lite             |       5 |               5 |                 5 | 2025-02-25 → 2026-07-21 |
| Gemini family   | Gemini Live                   |       8 |               6 |                 6 | 2025-04-09 → 2026-09-15 |
| Gemini family   | Gemini TTS                    |       5 |               4 |                 4 | 2025-05-20 → 2026-09-22 |
| Gemini family   | Gemini Transcribe             |       1 |               1 |                 1 | 2026-08-26 → 2026-08-26 |
| Gemini family   | Gemini Image                  |       8 |               8 |                 8 | 2025-08-26 → 2026-10-06 |
| Gemini family   | Gemini Video                  |       1 |               1 |                 1 | 2026-08-27 → 2026-08-27 |
| Gemini family   | Gemini Deep Research          |       2 |               2 |                 2 | 2026-04-21 → 2026-04-21 |
| Gemini family   | Gemini Embedding              |       2 |               2 |                 2 | 2025-07-14 → 2026-04-22 |
| Gemini family   | Gemini Robotics ER            |       3 |               3 |                 3 | 2025-09-25 → 2026-07-30 |
| Gemini family   | Gemini Argon                  |       1 |               1 |                 1 | 2026-10-13 → 2026-10-13 |
| DeepSeek family | DeepSeek V general            |       9 |               9 |                 9 | 2024-05-17 → 2025-12-01 |
| DeepSeek family | DeepSeek R                    |       4 |               3 |                 3 | 2025-01-20 → 2025-12-01 |
| DeepSeek family | DeepSeek Pro                  |       2 |               2 |                 2 | 2026-04-24 → 2026-08-13 |
| DeepSeek family | DeepSeek Flash                |       4 |               4 |                 4 | 2026-04-24 → 2026-09-10 |
| Qwen            | Qwen Max                      |       5 |               5 |                 5 | 2025-01-28 → 2026-09-02 |
| Qwen            | Qwen Plus                     |       4 |               4 |                 4 | 2025-04-29 → 2026-05-26 |
| Qwen            | Qwen Flash                    |       3 |               3 |                 3 | 2025-08-01 → 2026-08-26 |
| Qwen            | Qwen Coder                    |       3 |               3 |                 3 | 2024-11-12 → 2026-02-02 |
| Qwen            | Qwen Omni                     |       3 |               3 |                 3 | 2025-03-27 → 2026-09-17 |
| Qwen            | Qwen 开放模型 / Open models   |       7 |               7 |                 7 | 2024-09-19 → 2026-08-17 |
| Kimi            | Kimi K general flagship       |       6 |               6 |                 6 | 2025-07-11 → 2026-07-16 |
| Kimi            | Kimi Code                     |       2 |               1 |                 1 | 2026-06-12 → 2026-06-12 |
| Doubao          | Doubao Seed 通用 / General    |       2 |               2 |                 2 | 2025-06-25 → 2025-12-18 |
| Doubao          | Doubao Seed Pro               |       3 |               3 |                 3 | 2025-01-22 → 2026-06-23 |
| Doubao          | Doubao Seed Lite              |       3 |               2 |                 2 | 2026-02-14 → 2026-04-28 |
| Doubao          | Doubao Seed Code / Turbo      |       2 |               2 |                 2 | 2026-02-14 → 2026-06-23 |
| Doubao          | Doubao Seed Mini              |       1 |               1 |                 1 | 2026-02-14 → 2026-02-14 |
| ERNIE Bot       | ERNIE 开放权重 / Open weights |       4 |               4 |                 4 | 2025-06-30 → 2025-06-30 |
| ERNIE Bot       | ERNIE 旗舰 / Flagship         |       4 |               4 |                 4 | 2023-10-17 → 2026-05-09 |
| ERNIE Bot       | ERNIE X                       |       4 |               3 |                 3 | 2025-03-16 → 2025-09-09 |
| ERNIE Bot       | ERNIE Turbo                   |       4 |               2 |                 2 | 2024-06-28 → 2025-04-25 |
