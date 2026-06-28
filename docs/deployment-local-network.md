# Local Network Deployment Guide

## Overview

One computer on the local network runs the app. Other devices open it in a browser using that computer's local IP address.

## Setup

1. Copy `.env.example` to `.env`.
2. Set both `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID`.
3. Install dependencies in the root project and in `server/`.
4. Start the app with `start-app.bat` on Windows or `./start-app.sh` on Linux/macOS.

## LAN access

The server listens on `0.0.0.0` and prints URLs like:

`http://192.168.1.100:3000`

Use that address from other devices on the same network.

## Data

- Shared database: `server/taskmanager.db`
- Daily backups: `server/backup/*.db.gz`

## Restore

- Windows: `restore-app.bat "server\\backup\\<file>.db.gz"`
- Linux/macOS: `./restore-app.sh server/backup/<file>.db.gz`
