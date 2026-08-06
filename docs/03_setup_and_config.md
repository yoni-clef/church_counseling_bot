# Installation & Setup

## Prerequisites
- Node.js (v18 or higher recommended)
- MongoDB instance (local or Atlas)
- A Telegram Bot Token (obtainable via [@BotFather](https://t.me/botfather) on Telegram)

## Installation Steps
1. Clone the repository to your local machine.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create an environment configuration file (see the Configuration section below).
4. Run the TypeScript compiler:
   ```bash
   npm run build
   ```

## Running Locally
During development, you can run the bot utilizing `ts-node` which does not require a pre-build step:
```bash
npm run dev
```

## Running in Production
For production deployment, first build the project, then start the Node process:
```bash
npm run build
npm start
```

## Docker (Optional)
While a specific `Dockerfile` is not currently provided in the repository, you can easily containerize this application by using a standard `node:18-alpine` base image, copying `package.json`, running `npm install`, copying the source code, building, and running `npm start`.

---

# Configuration

The bot uses environment variables for all configuration. Create a `.env` file in the root directory based on `.env.example`.

### Core Variables (Required)
- `BOT_TOKEN`: Your Telegram Bot API token.
- `MONGODB_URI`: The connection string for your MongoDB instance.

### Optional Variables
- `MONGODB_DB_NAME`: The name of the database to use (defaults to `telegram-counseling-bot` or extracts from URI).
- `NODE_ENV`: Application environment (e.g., `development`, `production`).
- `PORT`: Not strictly used for the webhook in the current setup, but reserved for future HTTP health checks or webhook integration (defaults to `3000`).
- `SESSION_RETENTION_DAYS`: The number of days before closed counseling sessions are purged from the database (defaults to `90`).
- `CLEANUP_INTERVAL_HOURS`: How frequently the cleanup job runs (defaults to `24`).
- `REPORT_SUSPEND_THRESHOLD`: The number of strikes before a counselor is temporarily suspended (defaults to `3`).
- `REPORT_REVOKE_THRESHOLD`: The number of strikes before a counselor's access is permanently revoked (defaults to `5`).
- `ADMIN_CHAT_IDS`: A comma-separated list of Telegram Chat IDs that have administrative privileges.
- `LOG_LEVEL`: Determines the verbosity of the Winston logger (e.g., `info`, `debug`, `error`). Defaults to `info`.

### Secrets Management
- Never commit your `.env` file.
- Ensure `ADMIN_CHAT_IDS` is correctly populated so that at least one user can approve counselors and manage reports.

---

# Deployment

## Production Deployment
The application is a standard stateful Node.js application (stateful in its active database connections and ongoing timers, though bot state resides mostly in MongoDB). 
1. Provision a server (AWS EC2, Heroku, DigitalOcean, etc.).
2. Set up the environment variables securely in your deployment platform's configuration settings.
3. Use a process manager like `pm2` or a container orchestration tool like Docker/Kubernetes to run `npm start` and ensure the bot restarts upon crashes.

## Environment Configuration
Ensure that your production MongoDB instance is secured, preferably running in the same VPC as the bot server to minimize latency.

## Scaling Considerations
- **Stateless Handlers**: The bot's logic is mostly stateless, relying on MongoDB for persistence. This allows horizontal scaling.
- **Webhooks**: If scaling to multiple instances, Telegraf should be configured to use webhooks instead of the default long-polling, backed by a load balancer.

## Backup Strategy
- Enable automated daily backups for your MongoDB instance.
- Since chat histories and session transcripts are stored in MongoDB, ensuring DB redundancy is crucial for data integrity.
