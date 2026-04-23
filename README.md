<div align="center">
  <img src="logo.png" alt="Vitral" height="180"/>
  <br/><br/>
  <p>
    <a href="https://urbantk.org/vitral/"><strong>Website</strong></a> ·
    <a href="https://github.com/urban-toolkit/vitral/issues"><strong>Issues</strong></a>
  </p>
  <p>
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"/>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white"/>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
    <img alt="Docker" src="https://img.shields.io/badge/Docker-required-2496ED?logo=docker&logoColor=white"/>
  </p>
</div>

---

**Vitral** is a framework for reproducible design studies in visual analytics. It structures the design study process as a knowledge pipeline extracting knowledge from heterogeneous study artifacts, representing it as a relational graph, and supporting reasoning across that graph at the level of individual artifacts and across the full study ecosystem.


---

## Features

- **Shard canvas** — represent design study artifacts (papers, transcripts, sketches, screenshots, code) as typed, linked knowledge units (shards)
- **Sharding** — automatically decompose uploaded files into shard trees using LLMs
- **Provenance timeline** — record the full evolution of the knowledge graph across the study lifecycle
- **Pattern book** — match requirements to established VA system components from the literature
- **Codebase integration** — link GitHub commits and files to design decisions through an OAuth connection
- **AI assistant** — Query and ask analytical question about shards using natural language
- **Export** — generate a structured Markdown report or a portable `.vi` archive of the full study

---

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose v2
- An [OpenAI API key](https://platform.openai.com/api-keys)
- (Optional) A [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) for codebase integration

### 1. Clone the repository

```bash
git clone https://github.com/urban-toolkit/vitral.git
cd vitral
```

### 2. Configure environment variables

Create a `.env` file at the repository root. The minimal required content is:

```bash
# Required
OPENAI_API_KEY=sk-...

# GitHub OAuth (required for codebase integration)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Auth cookie secret (any random string)
COOKIE_SECRET=change-me-to-a-random-string

# Database (default values work for local Docker)
POSTGRES_USER=vitral
POSTGRES_PASSWORD=vitral
POSTGRES_DB=vitral
DATABASE_URL=postgres://vitral:vitral@postgres:5432/vitral

# MinIO object storage (default values work for local Docker)
MINIO_ROOT_USER=vitralminio
MINIO_ROOT_PASSWORD=vitralminio
S3_ACCESS_KEY_ID=vitralminio
S3_SECRET_ACCESS_KEY=vitralminio
```

### 3. Run

**Development** (hot reload on source changes):

```bash
docker compose --file docker-compose.dev.yml up --watch
```

Frontend: [http://localhost:5173](http://localhost:5173) · Backend: [http://localhost:3000](http://localhost:3000)

**Production**:

```bash
docker compose --file docker-compose.yml up
```

Frontend: [http://localhost:9898](http://localhost:9898)

---

## Public deploy

> 🕒 Coming soon, stay tuned!

---

## Architecture

Vitral is a full-stack TypeScript application composed of the following services, all orchestrated via Docker Compose:

| Service | Description |
|---|---|
| `vitral` | React + Vite frontend |
| `backend` | Node.js (Fastify) API server |
| `postgres` | PostgreSQL 18 with `pgvector` for embedding storage |
| `minio` | S3-compatible object storage for uploaded files |
| `docling-serve` | Document parsing service for PDF/Office files |

---

## Team

[Gustavo Moreira](https://gmmuller.github.io/) (UIC)  
[Luc Renambot](https://cs.uic.edu/profiles/luc-renambot/) (UIC)  
[Daniel de Oliveira](http://www2.ic.uff.br/~danielcmo/) (UFF)  
[Marcos Lage](https://mlage.github.io/) (UFF)   
[Fabio Miranda](https://fmiranda.me) (UIC)

---

## License

MIT — free for research and commercial use.
