# BillsMaster — AI Agents & Developer Guide

This document provides instructions for AI models and automated agents working on the **BillsMaster** codebase on this machine.

---

## 🏗️ Architecture & Deployment Overview

* **Public URL:** Configured via `PUBLIC_URL` in `.env` (default: `http://127.0.0.1:3000`, production: `https://bills.example.com:<PORT>/`)
* **Local Origin:** `http://127.0.0.1:3000`
* **Routing & Reverse Proxy Topology (Example Setup):**
  * **Gateway / VPS (`<VPS_PUBLIC_IP>`):** Tunnel (e.g. `rinetd` / WireGuard / Tinc) forwards incoming `<PUBLIC_PORT>` -> `<VPN_INTERNAL_IP>:443`.
  * **Nginx Reverse Proxy (e.g. Nginx Proxy Manager):** Routes SNI `<PUBLIC_DOMAIN>` -> `http://<LOCAL_SERVER_IP>:3000`.
  * **SSL Certificate:** Dedicated Let's Encrypt certificate for `<PUBLIC_DOMAIN>`.

### Port Allocation
| Container / Service | Host Port | Internal Port | Description |
| :--- | :--- | :--- | :--- |
| `billsmaster-frontend` | `3000` | `80` | Nginx serving React SPA + proxies `/api/` & `/ws/` to backend |
| `billsmaster-backend` | `3005` | `3005` | Fastify Node.js API + BullMQ Worker + Playwright Chromium |
| `billsmaster-postgres` | `5433` | `5432` | PostgreSQL 16 database (Host port 5433 configured to avoid local port 5432 conflict) |
| `billsmaster-redis` | `6379` | `6379` | Redis 7 queue broker for BullMQ |

---

## ⚠️ STRICT RULES & GUARDRAILS FOR AGENTS

1. **Co-hosted Production Services Guardrail:**
   * The host machine may host other applications or services (e.g., ports `8080`, `8085`, `5432`).
   * **Do not** modify, stop, or reconfigure external containers, ports, or databases.
   * If `MISTRZOSK_URL` is set in `.env`, `./redeploy.sh verify` performs automated regression health checks after redeployment to ensure external services remain 100% healthy.

2. **Docker Permissions:**
   * Run docker commands with `sg docker -c "<cmd>"` or use the `./redeploy.sh` wrapper which handles this automatically.

3. **Prisma Build Order:**
   * In `apps/backend`, `prisma generate` must run **before** `tsc`. The script `npm run build:backend` is configured as `prisma generate && tsc`.

---

## 🚀 How to Redeploy After Code Changes

The repository includes an automated script [redeploy.sh](redeploy.sh) in the root folder.

### 1. Frontend Changes Only (React / UI / Styles / Assets)
Run when modifying files in `apps/frontend/`:
```bash
./redeploy.sh frontend
```
* Builds the Vite bundle, creates the Docker image, restarts `billsmaster-frontend`, and runs verification.

### 2. Backend Changes Only (API / Providers / Scrapers / Workers)
Run when modifying files in `apps/backend/`:
```bash
./redeploy.sh backend
```
* Rebuilds backend TypeScript, generates Prisma client, restarts `billsmaster-backend`, and runs verification.

### 3. Full Stack Redeployment
Run when modifying shared types (`packages/shared-types/`) or both frontend & backend:
```bash
./redeploy.sh all
```

### 4. Database Schema Updates
Run when adding or modifying models in `apps/backend/prisma/schema.prisma`:
```bash
./redeploy.sh db
```
* Runs `npx prisma db push` inside the backend container.

### 5. Verify Health & Routing
Always run after deployment:
```bash
./redeploy.sh verify
```

### 6. View Live Logs
```bash
./redeploy.sh logs
```

---

## 🔐 Credentials & Secrets

* **Configuration File:** [.env](.env)
* **Default Administrator:**
  * **Email:** `admin@billsmaster.local`
  * **Password:** `AdminSuperPassword2026!`
  * **Role:** `ADMIN`
* **Test User Account:**
  * **Email:** `jan@kowalski.pl`
  * **Password:** `JanPassword123!`

---

## 🧪 Testing

* **Run backend unit/integration tests:**
  ```bash
  npm run test:backend
  ```
* **Run frontend lint/typecheck:**
  ```bash
  npm run typecheck --workspace=frontend
  ```
