# CONTRACTOR OS — Product Requirements Document

## Original Problem Statement
Build a production multi-tenant contractor SaaS ("Contractor OS") spanning: database + auth + multi-tenant security (Group 1/Phase 1), Victoria pricing engine + calculation service + CRM + quotes + jobs (Group 2/Phase 2), web + mobile field apps (Group 3/Phase 3), PDF + Stripe billing + admin portal + deployment (Group 4/Phase 4). Spec assumed Next.js + Supabase; adapted to this environment's stack.

## Stack (adapted)
- Backend: FastAPI + MongoDB (Motor), JWT auth (bcrypt + pyjwt)
- Frontend: Expo React Native (expo-router), SecureStore token storage
- UUID string primary keys, soft delete (`deleted_at`), created_at/updated_at, company_id multi-tenancy, audit_logs

## User Choices
- Build backend/API + Victoria pricing engine first, minimal mobile UI
- JWT email/password auth (default)
- Modules: Auth + multi-tenant/roles, CRM, Quote builder + pricing engine, Job management
- Stripe / PDF / Admin portal: DEFERRED
- Seed realistic Victoria pricing rates: YES (35 seeded)

## Personas
- OWNER/ADMIN: company setup, users, pricing DB, full access
- MANAGER: create jobs, convert quotes/leads, manage CRM
- EMPLOYEE: field updates, quotes, notes, photos
- VIEWER: read-only

## Implemented (2026-07-07)
- **Auth & tenancy**: register (company+OWNER+JWT), login, /auth/me, password reset request/confirm, role hierarchy OWNER>ADMIN>MANAGER>EMPLOYEE>VIEWER with `require_role` guards. Verified tenant isolation.
- **Pricing engine**: `pricing_rates` collection, 35 seeded Victoria rates (Concrete, Earthworks, Fencing, Landscaping, Retaining Walls, Materials, Labour, Equipment); global (company_id=null) + per-company custom rates; ADMIN CRUD.
- **Calculation service**: `calculate_project_quote()` → direct_cost + overheads + profit + GST(10%) = final_total. Verified exact.
- **CRM**: customers, contacts, leads (NEW/CONTACTED/QUALIFIED/CONVERTED/LOST pipeline), lead→customer convert, notes/activity_logs.
- **Quotes**: quotes + items + quote_versions (snapshot on edit), statuses DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED, breakdown auto-calc, convert ACCEPTED→job.
- **Jobs**: jobs + job_tasks + job_photos (base64) + job_notes + documents, progress %, status workflow.
- **Dashboard**: aggregated stats + pipeline value.
- **Mobile UI**: login/register, dashboard, CRM tab, Quotes tab (quote builder w/ rate picker + live breakdown), Jobs tab (progress/status/notes). Construction-orange dark theme.

## Backlog (prioritized)
- P0: none (core verified)
- P1 (Group 2/3 remainder): job scheduling/calendar, tasks UI, photo capture w/ camera + GPS, offline mode (local storage + sync queue), employees & equipment/labour rate tables UI, invoices + invoice_items + payments module
- P2 (Group 4): PDF generation (quotes/invoices w/ logo, ABN, signature), Stripe billing (Starter/Professional/Enterprise plans, customer portal, feature limits), admin portal (company/user/subscription/pricing mgmt, analytics), production deployment checklist
- Prod hardening: password reset via email (currently returns token in body for dev), modularise server.py

## Next Tasks
1. Invoices + payments module (completes Lead→Quote→Job→Invoice workflow)
2. Offline mode + camera/GPS photo capture for field app
3. PDF generation + Stripe billing (Group 4)
