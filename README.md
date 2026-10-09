# QTS_Startup

> **Current production system:** Vercel web app + Vercel API + Neon database.
> The retired extension and legacy candidate/application workflows are not
> supported by the current deployment. See [the current system](docs/CURRENT-SYSTEM.md).

QTS_Startup is a web-based job tracking application deployed on Vercel with
Neon PostgreSQL.

> **Requirements & planning:** see [REQUIREMENTS.md](REQUIREMENTS.md) for full product, technical, and feature requirements.  
> **Build & deploy:** see [BUILD.md](BUILD.md) for environment setup and operations.  
> **Performance:** see [QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md](QTS-JOB-TRACKING-PERFORMANCE-GUIDE.md) for Vercel and API optimization.

## Features

- **Role-based web UI** — Super, Admin, Manager, and Caller users
- **Neon PostgreSQL** — persistent data for the Vercel API
- **Job tracking** — Manager-owned jobs with category and Account-profile assignments
- **Interview tracking** — schedules linked to bids and Caller assignments

## Requirements

- Windows 10/11, macOS, or Linux
- Node.js 20 or newer
- A modern web browser

## Quick start

**Public deployment:** follow [DEPLOY.md](DEPLOY.md) to deploy the web app and
API to Vercel and connect Neon. Once deployed, open your public Vercel URL;
your PC does not need to run the API.

After deployment, open the Vercel web app URL. `start.bat` opens the
configured public URL; it does not start a local API or database.

Available roles:

| Role    | How it is created |
|---------|-------------------|
| Super   | Seeded from `ADMIN_USERNAME` / `ADMIN_PASSWORD` |
| Admin   | Created by Super |
| Manager | Created by Admin |
| Caller  | Created by Admin |
| Account profile | Created by Manager; it is not a login |

The configured `ADMIN_USERNAME` / `ADMIN_PASSWORD` account is seeded as
**Super**. Change the initial password after signing in. Super creates Admins;
Admins create Managers and Callers; Managers create Account profiles.

## Extension status

Manager login has been connected to the current API. The extension's job,
Account, candidate, and application workflows still depend on retired
endpoints and will be refactored in later steps.

## Panels

| Role    | URL prefix              | Access |
|---------|-------------------------|--------|
| Super   | `/admin`                | Full system access; manages Admin accounts |
| Admin   | `/admin`                | Manages Managers and lower-role workflows |
| Manager | `/manager`              | Account profiles and jobs |
| Caller  | `/caller`               | Assigned interviews |

## Database

The production deployment uses Neon PostgreSQL. Configure database and API
secrets in Vercel; local commands do not change production data.

## Project structure

```text
QTS_Startup/
- start.bat           Open the public application (Windows)
- admin-web/          Next.js Vercel web app
- server/             Express Vercel API
- docs/               Deployment and system notes
```
