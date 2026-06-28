# PocketBase Docker Deployment

## Deployment

```bash
cp .env.example .env
docker compose up -d
```

## Logs

```bash
docker compose logs -f pocketbase
```

## Admin URL

```text
https://pb.yourdomain.com/_/
```

## CORS

Set the PocketBase allowed origins to:

```text
http://localhost:5173
http://localhost:5181
https://*.vercel.app
https://your-domain.com
```

You can configure this in the PocketBase admin UI after the first boot.

## Auth Note

The current frontend keeps the existing GIS flow for Google Calendar and identity sync. Because it does not yet create a native PocketBase auth session, `scripts/pb-setup.js` seeds public collection rules so the realtime client can work immediately.

If you want strict authenticated PocketBase rules, the next step is to add a PocketBase-native auth bridge instead of relying on GIS alone.

## Backups

The compose stack mounts:

- `pb_data` as the live PocketBase volume
- `docker/backups` as `/backup`

Daily SQLite backups can be run with:

```bash
sh /app/scripts/pb-backup.sh
```

Restore with:

```bash
sh /app/scripts/pb-restore.sh /backup/command-dashboard-YYYY-MM-DD.sqlite3
```
