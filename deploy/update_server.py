# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "fastapi",
#     "uvicorn",
# ]
# ///
"""Redeploys AlphaPump on request: git pull followed by a docker compose rebuild.

Runs directly on the deploy host, not in Docker, so it can invoke git and
docker without needing the host's docker socket mounted into a container.
Declares its own dependencies via inline script metadata (PEP 723) so `uv
run deploy/update_server.py` installs just fastapi/uvicorn into an isolated
environment instead of syncing the rest of this repo (pnpm workspace,
Turborepo, ...), which it has no need for.
"""

import logging
import os
import subprocess

import uvicorn
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UPDATE_SERVER_HOST = "0.0.0.0"
DEFAULT_UPDATE_SERVER_PORT = 40001
COMPOSE_FILE = "deploy/docker-compose.yml"

app = FastAPI()


@app.get("/health", response_class=PlainTextResponse)
def health() -> PlainTextResponse:
    return PlainTextResponse("ok")


@app.get("/update", response_class=PlainTextResponse)
def update() -> PlainTextResponse:
    logger.info("Received update request")

    pull = subprocess.run(["git", "pull"], capture_output=True, text=True)
    if pull.returncode != 0:
        return PlainTextResponse(
            f"Failed to pull latest code\n{pull.stderr}", status_code=500
        )

    up = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            COMPOSE_FILE,
            "up",
            "-d",
            "--build",
            "--force-recreate",
        ],
        capture_output=True,
        text=True,
    )
    if up.returncode != 0:
        return PlainTextResponse(
            "Failed to restart service\n"
            f"Status: {up.returncode}\n{up.stdout}\n{up.stderr}",
            status_code=500,
        )

    return PlainTextResponse(
        f"Service restarted successfully\n{pull.stdout}\n{up.stdout}"
    )


if __name__ == "__main__":
    port = int(os.environ.get("UPDATE_SERVER_PORT", DEFAULT_UPDATE_SERVER_PORT))
    uvicorn.run(app, host=UPDATE_SERVER_HOST, port=port)
