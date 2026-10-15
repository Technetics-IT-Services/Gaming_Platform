# Gaming Platform

> Enterprise-grade gaming platform — production-ready monorepo foundation.

An original, production-grade platform built as a **Turborepo** monorepo. This
repository contains the complete foundation: backend services, frontend
application, shared packages, infrastructure, and tooling. Individual game
modules are added later under [`games/`](./games).

---

## Tech Stack

| Layer          | Technologies                                                                 |
| -------------- | ---------------------------------------------------------------------------- |
| **Frontend**   | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion, Zustand, React Query, React Hook Form, Zod |
| **Backend**    | NestJS, TypeScript, Prisma ORM, PostgreSQL, Redis, JWT, WebSockets, Swagger, Winston |
| **Infra**      | Docker, Docker Compose, Nginx                                                |
| **Tooling**    | Turborepo, pnpm, ESLint, Prettier, Husky, lint-staged, commitlint           |

---

## Repository Layout

```
gaming-platform/
├── apps/
│   ├── frontend/          # Next.js 15 application
│   └── backend/           # NestJS API
├── packages/
│   ├── ui/                # Shared React component library (shadcn/ui based)
│   ├── auth/              # Shared auth primitives (JWT, hashing, types)
│   ├── database/          # Prisma schema + generated client
│   ├── shared/            # Framework-agnostic utilities & constants
│   ├── config/            # Shared ESLint / Prettier / TS configs
│   └── types/             # Shared TypeScript types & DTO contracts
├── games/                 # Game modules (added later)
├── docker/                # Dockerfiles, compose, nginx
├── docs/                  # Architecture & operational docs
├── scripts/               # Dev / CI helper scripts
└── .github/               # CI workflows & templates
```

---

## Quick Start (Docker — recommended)

Everything runs with a single command. No manual configuration required.

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up --build
# or: pnpm docker:up
```

| Service       | URL                                  |
| ------------- | ------------------------------------ |
| Frontend      | http://localhost:3000                |
| Backend API   | http://localhost:4000/api/v1         |
| Swagger Docs  | http://localhost:4000/docs           |
| Health        | http://localhost:4000/api/v1/health  |
| Nginx Gateway | http://localhost                     |

---

## Local Development (without Docker)

Requires **Node ≥ 20** and **pnpm ≥ 9**, plus a local PostgreSQL and Redis
(or just run those two via Docker).

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start infrastructure only (Postgres + Redis)
docker compose -f docker/docker-compose.yml up -d postgres redis

# 4. Generate the Prisma client
pnpm db:generate

# 5. Run everything in dev mode
pnpm dev
```

---

## Common Commands

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `pnpm dev`             | Run all apps in watch mode                   |
| `pnpm build`           | Build every package and app                  |
| `pnpm lint`            | Lint the entire workspace                    |
| `pnpm typecheck`       | Type-check the entire workspace              |
| `pnpm test`            | Run unit tests                               |
| `pnpm format`          | Format with Prettier                         |
| `pnpm db:generate`     | Generate the Prisma client                   |
| `pnpm db:migrate`      | Create & apply a dev migration               |
| `pnpm db:studio`       | Open Prisma Studio                           |

---

## Environment Management

Configuration is layered. The base `.env` is loaded everywhere; an
environment-specific file (`.env.development`, `.env.staging`,
`.env.production`) overrides it. All backend variables are validated at boot
with Zod — the process refuses to start on invalid config.

See [`.env.example`](./.env.example) for the full, documented variable list and
[`docs/`](./docs) for deeper architectural notes.

---

## License

UNLICENSED — proprietary.
