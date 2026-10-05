# BillsMaster — Centralized Billing & Utility Payment Center

BillsMaster is a self-hosted billing management center. It automatically logs into defined utility portals (electricity, gas, telco, etc.), parses current and historical billing information, downloads and stores original PDF invoices, and presents everything in a Progressive Web App (PWA) installable directly from your browser on desktop and mobile.

---

## Key Features

- **Automated Headless Portal Scraping:** Powered by Playwright Chromium with persistent session state/cookies to prevent repeated logins.
- **Provider Plugin Architecture:** Extensible `IBillProvider` interface. Ships with:
  - **Tauron eBOK:** Automated login, session persistence, invoice row extraction, and PDF downloads.
  - **Demo Mock Portal:** Realistic testing and development provider with dynamic PDF invoice generation.
- **Progressive Web App (PWA):** Built with React 19, Vite, and Tailwind CSS. Installable via browser "Install App" button, with offline caching and responsive mobile/desktop layouts.
- **Real-Time Live Sync Updates:** BullMQ worker pool streams step-by-step progress to the UI via WebSockets.
- **Strong Security at Rest:** External portal passwords encrypted with **AES-256-GCM** authenticated envelope encryption; user passwords hashed with bcrypt; session protected via HTTP-only JWT cookies.
- **Role-Based Access Control:**
  - **Admin Account:** First-run wizard to create the initial admin; Admin console to create and manage users.
  - **User Accounts:** Users can connect multiple provider accounts with distinct credentials.
- **Document Archive:** Downloads and archives original PDF invoices on the local filesystem with in-app preview/download.

---

## Monorepo Layout

```
BillsMaster/
├── docker-compose.yml              # Production orchestration (Postgres, Redis, Backend, Frontend)
├── .env.example                    # Environment template
│
├── apps/
│   ├── backend/                    # Node.js + Fastify + Prisma + BullMQ + Playwright
│   │   ├── Dockerfile
│   │   ├── prisma/schema.prisma    # PostgreSQL data models
│   │   └── src/
│   │       ├── security/           # AES-256-GCM CryptoService & bcrypt
│   │       ├── providers/          # TauronProvider & MockProvider
│   │       ├── queue/              # BullMQ queue & Playwright scraper worker
│   │       └── ws/                 # WebSocket progress stream
│   │
│   └── frontend/                   # React 19 + Vite + Tailwind CSS + shadcn + PWA
│       ├── Dockerfile
│       ├── nginx.conf              # SPA & reverse proxy configuration
│       └── src/
│           ├── components/         # PWA install button, Navbar, modals
│           ├── pages/              # Dashboard, Bills, Accounts, Admin, Login, Setup
│           └── hooks/              # useSyncStream WebSocket hook
│
├── packages/
│   └── shared-types/               # Shared TypeScript definitions
└── storage/                        # Persistent volumes for invoices and sessions
```

---

## Quickstart with Docker Compose

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Generate a secure 64-hex-character string for `MASTER_ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Place this key and a secure `JWT_SECRET` in `.env`.

### 2. Launch Services
Start all containers (PostgreSQL, Redis, Backend, and Frontend):
```bash
docker-compose up -d --build
```

### 3. First-Time Setup
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. The **First-Run Setup Wizard** will appear. Enter the Administrator name, email, and password.
3. Click **Install App** in the navigation header to install BillsMaster as a desktop or mobile application.
4. Go to **Connected Portals** -> **Connect New Portal** to add your Tauron or Demo credentials.
5. The backend will automatically trigger background synchronization and display bills and invoices.

---

## Local Development (Without Docker)

### Prerequisites
- Node.js 20+
- PostgreSQL running locally on port 5432
- Redis running locally on port 6379

### Run Steps
```bash
# 1. Install all dependencies across the workspace
npm install

# 2. Build shared types
npm run build:shared

# 3. Apply database migrations
cd apps/backend
npx prisma db push
npx prisma db seed
cd ../..

# 4. Start backend and frontend in development mode
npm run dev:backend
npm run dev:frontend
```

---

## Adding a New Provider Plugin

To add a new utility provider (e.g. Orange, PGNiG, PGE):
1. Create a directory in `apps/backend/src/providers/<provider_id>/`.
2. Implement the `IBillProvider` interface:
   ```typescript
   export interface IBillProvider {
     readonly id: string;
     readonly displayName: string;
     readonly loginUrl: string;

     authenticate(page: Page, creds: ProviderCredentials, context: ScrapeContext): Promise<AuthResult>;
     fetchBills(page: Page, context: ScrapeContext): Promise<ExtractedBill[]>;
   }
   ```
3. Register the provider instance in `apps/backend/src/providers/registry.ts`.
4. Seed the provider metadata in `apps/backend/src/db/seed.ts`.
