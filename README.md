# Contractor OS

Multi-tenant contractor SaaS for Victorian trades — CRM, dynamic pricing, a materials **quantity estimator**, a quote builder with contingency/overhead/profit (and auto-recommended margins), and job management.

- **Backend:** FastAPI + MongoDB (Motor), JWT auth, role-based multi-tenancy
- **Frontend:** Expo React Native (expo-router)

> `contractor_os_full_source.md` in the repo root is a single copy-paste bundle of all source files.

## Features

- **Auth & multi-tenancy** — email/password JWT, company isolation, roles OWNER > ADMIN > MANAGER > EMPLOYEE > VIEWER, password reset.
- **CRM** — customers, contacts, leads pipeline (NEW → CONTACTED → QUALIFIED → CONVERTED / LOST), notes, lead→customer convert.
- **Victoria pricing DB** — dynamic `pricing_rates` (never hard-coded); seeded rates across Concrete, Earthworks, Fencing, Landscaping, Retaining Walls, Materials, Labour, Equipment; company custom rates.
- **Quantity estimator** — dimensions → material takeoffs per trade: mesh sheets, bar chairs, fence panels/posts, retaining-wall sleepers + H-beams + end beams, turf, spoil m³ + tipper loads, plus auto cement bags, crushed rock & sand bedding tonnage, and delivery. Editable per-line rates + saveable templates.
- **Quote builder** — line items, versions, statuses (DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED), edit drafts, adjust status any direction, recommend margins, convert accepted quote → job.
- **Calculation engine** — `Direct + Contingency + Overheads + Profit + GST = Final Total`.
- **Jobs** — tasks, photos (base64), notes, progress %, status workflow.

## Project structure

```
backend/
  server.py        # all API routes, auth, multi-tenancy, calc engine
  estimator.py     # materials quantity takeoff per trade
  seed_data.py     # seeded Victoria pricing rates
  requirements.txt
  .env             # MONGO_URL, DB_NAME, JWT_SECRET
frontend/
  app/             # expo-router screens (login, tabs: dashboard/crm/quotes/jobs)
  src/             # api client, auth context, theme, components (ui, Estimator)
  package.json
  app.json
```

## Running locally

### Backend
```bash
cd backend
pip install -r requirements.txt
# .env must contain: MONGO_URL, DB_NAME, JWT_SECRET
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```
All routes are prefixed with `/api`. Victoria pricing rates seed automatically on first start.

### Frontend
```bash
cd frontend
yarn install
# .env must contain EXPO_PUBLIC_BACKEND_URL pointing at the backend
yarn start
```

## Environment variables

**backend/.env**
```
MONGO_URL="mongodb://localhost:27017"
DB_NAME="contractor_os"
JWT_SECRET="<your-secret>"
```

**frontend/.env**
```
EXPO_PUBLIC_BACKEND_URL="https://your-backend-url"
```

## Test account

```
email:    jane@acme.com.au
password: pass123   (OWNER)
```
Or register a new company from the login screen (creates a new isolated tenant + OWNER).

## Key API endpoints

- `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · password reset
- `GET/POST/PUT/DELETE /api/customers` · `/api/contacts` · `/api/leads` (+ `/status`, `/convert`, `/notes`)
- `GET/POST/PUT/DELETE /api/pricing-rates`
- `POST /api/calculate-quote` · `POST /api/recommend-margins`
- `POST /api/estimate-materials` · `GET/POST/DELETE /api/estimate-templates`
- `GET/POST/PUT /api/quotes` (+ `/calculate`, `/status`, `/convert-to-job`)
- `GET/POST /api/jobs` (+ `/progress`, `/tasks`, `/photos`, `/notes`)
- `GET /api/dashboard/stats`
