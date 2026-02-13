# Deployment

AIDE RAP can be deployed directly with Node.js or as a Docker container.

## Packaging

The `pack.sh` script creates a deployment-ready ZIP archive:

```bash
./pack.sh                           # → aide-rap-20260212.zip (date-stamped)
./pack.sh /path/to/output.zip       # → custom output path
```

The ZIP contains the complete `aide-rap/` directory with all symlinks resolved (aide-frame and system data become real directories). It excludes `.git`, `node_modules`, and log files.

## Option 1: Direct Deployment (Node.js)

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm

### Setup

```bash
unzip aide-rap-20260212.zip
cd aide-rap
npm ci --omit=dev
cd aide-frame/js/aide_frame && npm ci --omit=dev && cd ../../..
```

### Run

```bash
./run -s irma                    # Start with default port (config.json)
./run -s irma -p 8080            # Custom port
```

For production, use a process manager like pm2:

```bash
npm install -g pm2
pm2 start app/rap.js -- -s irma
pm2 save                         # Persist across reboots
pm2 startup                      # Enable auto-start on boot
```

### Update

```bash
pm2 stop rap                     # Stop server (important: SQLite WAL needs clean shutdown)
cd ..
unzip -o aide-rap-20260213.zip   # Overwrite with new version
cd aide-rap
npm ci --omit=dev                # Reinstall deps (if package.json changed)
pm2 start rap
```

**Important:** Always stop the server before overwriting files. SQLite uses WAL (Write-Ahead Logging) — overwriting database files while the server runs can cause corruption.

### Push-Button Update (deploy.sh + Re-Install)

For automated deployments, use the two-step process:

**Step 1 — Local: Pack and upload**

```bash
./deploy.sh    # Packs ZIP, uploads via sftp to server (password prompted)
```

This creates `aide-rap-latest.zip` and uploads it to the server's parent directory via sftp.

**Step 2 — Server: Re-Install via Admin UI**

Open the Seed Manager in the web UI (admin role required) and click **⚠ Re-Install**. This:

1. Checks that `aide-rap-latest.zip` exists on the server
2. Spawns `reinstall.sh` as a detached process
3. Stops PM2 (clean SQLite shutdown)
4. Unzips with full overwrite (code + database)
5. Runs `npm ci` for dependencies
6. Restarts PM2

The page auto-reloads after 15 seconds.

**Files involved:**

| File | Location | Purpose |
|------|----------|---------|
| `deploy.sh` | Local dev machine | Pack + sftp upload |
| `reinstall.sh` | Server (aide-rap root) | PM2 stop → unzip → npm → PM2 start |
| `reinstall.log` | Server (aide-rap root) | Log of last reinstall |

**Configuration:** Edit `deploy.sh` to set `REMOTE_HOST` and `REMOTE_DIR` for your target server.

## Option 2: Docker Deployment

### Prerequisites

- Docker Engine with Docker Compose

### Initial Setup

```bash
unzip aide-rap-20260212.zip
cd aide-rap
docker compose up -d --build
```

The application is now accessible at `http://server` (port 80).

### What the Docker Setup Does

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds the image: Node.js 24, native dependencies (python3, make, g++), npm install, copies app code |
| `docker-compose.yml` | Runs the container: maps port 80 → 18354, auto-restart on failure |
| `.dockerignore` | Excludes node_modules, .git, logs, database from build context |

The image contains everything: application code, dependencies, system data, and SQLite database. No external volumes or network dependencies at runtime.

### Update

```bash
docker compose down              # Stop container
cd ..
unzip -o aide-rap-20260213.zip   # Overwrite with new version
cd aide-rap
docker compose up -d --build     # Rebuild and start
```

### Port Configuration

By default, the container maps port **80** (host) to **18354** (app). To change the host port, edit `docker-compose.yml`:

```yaml
ports:
  - "8080:18354"    # Access via http://server:8080
```

### Using External Data Volume

By default, all data (SQLite database, seed files, media) is baked into the image. To persist data independently of the image (so updates only replace code, not data):

1. Copy the initial data out of the container:
   ```bash
   docker compose up -d --build
   docker compose cp irma:/app/app/systems/irma/data ./data
   docker compose down
   ```

2. Uncomment the volume mount in `docker-compose.yml`:
   ```yaml
   volumes:
     - ./data:/app/app/systems/irma/data
   ```

3. Start with the volume:
   ```bash
   docker compose up -d
   ```

Now updates (`unzip -o` + `docker compose up --build`) only replace code. The database and uploads persist in the `./data` directory on the host.

### Container Management

```bash
docker compose up -d --build     # Build and start (detached)
docker compose down              # Stop and remove container
docker compose logs -f           # Follow log output
docker compose restart           # Restart without rebuild
docker compose ps                # Show container status
```

## Local Docker Testing

For development machines where aide-frame and system data are symlinked, use `docker-test.sh` to simulate the exact deployment workflow:

```bash
./docker-test.sh                 # Pack → unzip to /tmp → docker build & run
./docker-test.sh -d              # Pass flags to docker compose (e.g. detached)
```

This resolves symlinks via `pack.sh`, unpacks to `/tmp/aide-docker-test/`, and builds from there — exactly as it would work on the target machine.

## Exporting a Pre-Built Image

If the target machine has no internet access (for `npm install` during build), export the built image:

```bash
# Build locally
./docker-test.sh -d
# or: docker compose up -d --build  (on a machine with resolved symlinks)

# Export image
docker save aide-rap-irma -o irma-image.tar

# Transfer to target: irma-image.tar + docker-compose.yml
```

On the target machine:

```bash
docker load -i irma-image.tar
docker compose up -d
```

No build step needed — the image is ready to run.
