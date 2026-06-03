# ELO Rating

A forced-choice image comparison tool for research workflows. Participants are shown pairs of images and choose which one ranks higher on a configurable criterion. Ratings are computed using a batch shuffle-replay ELO algorithm that eliminates order-dependence bias. All sessions are logged and results are available as JSON, CSV, or a ZIP export.

---

## Table of Contents

- [How it works](#how-it-works)
- [ELO algorithm](#elo-algorithm)
- [Pair selection](#pair-selection)
- [Project structure](#project-structure)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Adding images](#adding-images)
- [Results & export](#results--export)
- [Production deployment](#production-deployment)

---

## How it works

1. A participant enters their name on the intro screen.
2. Pairs of images are shown one at a time. The participant clicks the one they prefer (or the trial auto-advances after the configured timer).
3. After each decision the full comparison history is replayed to recompute ELO ratings, and the updated values are persisted to the database.
4. A session ends when the participant has seen the configured number of pairs, or all possible pairs have been exhausted.
5. Results are visible at `/results` — a sortable ranked grid plus interactive statistical charts.

---

## ELO algorithm

Ratings are **never updated incrementally**. After every comparison, all historical session comparisons are replayed `ELO_N_REPLAYS` times with independently shuffled orderings. The final rating for each image is the mean across all replays.

This approach:
- eliminates order-dependence bias (a known problem with incremental ELO)
- ensures the stored ratings and the distribution chart are derived from the **same random draws** (ratings come from `recomputeAndPersist`; the chart reads from the same cached run)

**Formula per comparison:**

$$E_w = \frac{1}{1 + 10^{(r_l - r_w)/400}}, \quad \Delta r_w = K (1 - E_w), \quad \Delta r_l = K (0 - E_l)$$

Default: K = 100, N replays = 100, starting rating = 1500.

---

## Pair selection

Coverage-first scheduling with an **anchor backbone** (`client/src/utils/pairSelection.js`):

- **Anchor** — image with at least 5 comparisons (configurable via `ANCHOR_THRESHOLD`).
- **Coverage phase** — while any image is below that threshold, prefer **cold × anchor** pairs (one under-sampled image vs one stable reference).
- **Session-unrated pairs** — pairs not yet shown in the current session are preferred; among those, lowest combined comparison count wins (tolerance of 2), with random tie-break.
- **Recalibration** — at least one **anchor × anchor** pair every 5 picks (`ANCHOR_PAIR_EVERY`) so established rankings keep receiving direct comparisons.

The previous trial’s images are avoided when possible to reduce carry-over bias.

---

## Project structure

```
.
├── client/              # React + Vite frontend
│   └── src/
│       ├── components/  # CompareView, Sidebar, LoginModal, …
│       ├── hooks/       # useAppData, useSession
│       ├── pages/       # ResultsPage (ranked grid + charts)
│       └── utils/       # pairSelection, preload
├── server/              # Express + MongoDB backend
│   ├── elo.js           # Shared batch ELO computation module
│   ├── models/          # Mongoose schemas (Image, Session)
│   ├── routes/          # API handlers (compare, images, sessions, distributions, …)
│   └── startup.js       # Image compression, DB seeding, previews on start
├── scripts/             # One-off utility scripts
│   └── migrate-legacy-sessions.js
├── images/              # Source images (mounted as a volume in production)
├── previews/            # Auto-generated 300 px thumbnails (runtime)
├── Dockerfile
├── docker-compose.yml
├── mongo-init.js        # Creates the app DB user on first container start
└── .env.example
```

---

## Local development

**Prerequisites:** Node.js 20+, pnpm, MongoDB running locally.

```bash
# 1. Clone and install
pnpm install

# 2. Copy environment file and edit as needed
cp .env.example .env

# 3. Drop images into ./images/

# 4. Start both server and client with hot reload
pnpm dev
```

The client runs at `http://localhost:5173`, the API server at `http://localhost:3001`.

---

## Configuration

All options are set via environment variables. Copy `.env.example` to `.env` and edit:

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017/elo-rating` | MongoDB connection string |
| `PORT` | `3001` | Server port |
| `APP_TITLE` | `ELO Rating` | Small-caps label on the intro screen |
| `QUESTION` | `Which image do you prefer?` | Comparison question shown to participants |
| `QUESTION_DESCRIPTION` | _(empty)_ | Optional description below the question |
| `TIME_PER_COMPARISON` | `5000` | Milliseconds before a pair auto-advances |
| `PRELOAD_COUNT` | `6` | Look-ahead pairs to preload after each trial. On login, at least 4 pairs (first trial + queue) are preloaded using the same selection algorithm |
| `ELO_K_FACTOR` | `100` | ELO K-factor — higher values mean larger rating shifts per comparison |
| `ELO_N_REPLAYS` | `100` | Number of shuffle-replays per recomputation — higher values reduce variance |
| `SESSION_PAIRS_LIMIT` | `0` | Max pairs per session. `0` = unlimited |
| `CHART_IMAGE_LIMIT` | `0` | Limit distribution chart to top N images. `0` = show all |

Additional variables used only by Docker:

| Variable | Default | Description |
|---|---|---|
| `MONGO_ROOT_USER` | — | MongoDB root admin username |
| `MONGO_ROOT_PASSWORD` | — | MongoDB root admin password |
| `MONGO_APP_USER` | — | App-level DB user (readWrite on `elo-rating` db only) |
| `MONGO_APP_PASSWORD` | — | App-level DB user password |
| `REGISTRY_IMAGE` | `ghcr.io/silencesys/dh--elo-rating` | Full image name used by `docker-compose.yml` and `.build` — override when working from a fork |
| `IMAGE_TAG` | `latest` | Image tag pulled by `docker-compose.yml` |

---

## Adding images

Place image files (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`, `.tiff`) in the `./images/` directory.

On server startup (including every Docker container start/restart), `startup.js` runs **before** the HTTP server accepts traffic:
- Resizes any image taller than 1500 px in place (same filename/format; smaller images are left unchanged).
- Registers any new files in `./images/` in the database (default ELO 1500); existing records are kept and dimensions refreshed after compression.
- Generates or refreshes a 300 px JPEG thumbnail in `./previews/` when the source file is newer than its preview (used in the results grid and login background).

To reset ratings, drop the `images` collection and restart the server.

---

## Results & export

The `/results` page is accessible by typing the URL directly — it is intentionally not linked from the participant UI.

| URL | Description |
|---|---|
| `/results` | Visual results page: ranked grid + charts |
| `/api/images` | All images as JSON, sorted by ELO descending |
| `/api/images?format=csv` | Same data as CSV (downloadable) |
| `/api/distributions?n=100` | Per-image ELO distributions (N replay values per image) |
| `/api/download` | ZIP file containing `elo-ratings.json` + all source images |

### Results page charts

- **ELO distribution (violin)** — one violin per image sorted by mean ELO. Each violin shows a Gaussian KDE of the `n` replay values, with a full-height stem (min–max), Q1/Q3 ticks, and a median line. When more images are present than can fit horizontally, the lowest and highest halves are shown with an "N omitted" marker in between.
- **ELO rating bar chart** — horizontal bar per image with the mean ELO value and min–max range. An IQR box and min–max whisker overlaid on each bar visualise uncertainty from the same replay run as the violin.
- **Comparisons per image bar chart** — horizontal bar showing how many times each image has been compared.
- **ELO vs win rate scatter** — each image plotted as a circular thumbnail at its ELO × win-rate coordinates.

---

## Production deployment

### Docker Compose

```bash
# 1. Copy and configure the environment file
cp .env.example .env
# Edit .env — set strong passwords for MONGO_ROOT_PASSWORD and MONGO_APP_PASSWORD

# 2. Start
docker compose up -d

# 3. Mount your images by editing docker-compose.yml:
#    volumes:
#      - /path/to/your/images:/app/images:ro
```

Mongo data and generated previews are stored in named Docker volumes (`mongo-data`, `previews`) and survive container restarts.

> **First start note:** `mongo-init.js` creates the app DB user only when the `mongo-data` volume is empty. If auth fails after changing credentials, run `docker compose down -v` to wipe the volume and reinitialise.

### Build and publish the Docker image

The `.build` script reads the version from `server/package.json` and pushes a versioned tag (e.g. `:1.0.0`) plus `:latest` to the container registry.

```bash
# Requires a GitHub PAT with write:packages scope
export CR_PAT=ghp_yourtoken
./.build
```

To release a new version: bump `"version"` in `server/package.json`, then run `.build`.

#### Building from a fork

Set `REGISTRY`, `OWNER`, and `REPO` (or just `REGISTRY_IMAGE`) before running the script so it pushes to your own registry instead:

```bash
# Option A — individual parts
REGISTRY=ghcr.io OWNER=your-username REPO=your-repo ./.build

# Option B — full image name
REGISTRY_IMAGE=ghcr.io/your-username/your-repo ./.build
```

Set the same `REGISTRY_IMAGE` (and optionally `IMAGE_TAG`) in your `.env` so `docker compose up` pulls from your fork's registry.

## License
MIT License. See [LICENSE](LICENSE).