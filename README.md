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

The pair selection algorithm uses a four-tier priority system designed to ensure new images are rated quickly while still producing meaningful comparisons:

- **Tier 1** — at least one new (under-compared) image, avoids the pair shown on the previous trial (reduces carry-over bias)
- **Tier 2** — at least one new image (no repeat constraint)
- **Tier 3** — established × established pair, avoids the previous pair (~15% weight)
- **Tier 4** — established × established, last resort

Within each tier, the pair with the lowest combined comparison count (within a tolerance of 2) is preferred.

An image is classified as "new" if its comparison count is at or below the 25th percentile of all images. If the spread between the most- and least-compared image is ≤ 5, all images are treated as equal.

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
│   └── startup.js       # Preview generation on server start
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
| `PRELOAD_COUNT` | `6` | Upcoming pairs to preload. `0` = preload all at startup |
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

On server startup, `startup.js` automatically:
- Registers any new images in the database (with a default ELO of 1500).
- Generates a 300 px JPEG thumbnail in `./previews/` for each image (used in the results grid and charts).

Images already in the database are not re-registered or re-thumbnailed. To reset ratings, drop the `images` collection and restart the server.

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