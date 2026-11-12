# Telegram Token Manager — MongoDB + GitHub + Vercel

Dark single-admin dashboard to validate Telegram bot tokens, display bot identity, store tokens encrypted with AES-256-GCM in MongoDB Atlas, delete bots, and send test messages.

## Files
- `index.html`, `style.css`, `app.js`: frontend
- `api/index.js`: Express serverless API
- `package.json`, `vercel.json`: Vercel configuration

## Deploy
1. Create a MongoDB Atlas cluster at https://www.mongodb.com/atlas/database.
2. Create a dedicated database user with a strong password.
3. In Atlas Network Access, allow `0.0.0.0/0` for Vercel's changing serverless egress IPs. This exposes the cluster to network connection attempts; protect it with a strong database password and least-privilege user. Prefer private networking/fixed egress if available.
4. Copy the Atlas driver connection string. Include database name `telegram_token_manager` and replace credentials carefully.
5. Extract this ZIP and upload all files to a **private** GitHub repository.
6. At https://vercel.com/new, import the repository. Select Framework Preset **Other**, leave Build Command and Output Directory empty, and use `npm install` as Install Command.
7. In Vercel Project → Settings → Environment Variables, add:
   - `ADMIN_PASSWORD`: unique password, at least 14 characters
   - `SESSION_SECRET`: first output from `openssl rand -hex 32`
   - `ENCRYPTION_KEY`: second, different output from `openssl rand -hex 32`
   - `MONGODB_URI`: MongoDB Atlas connection string
   - `MONGODB_DB`: `telegram_token_manager`
8. Deploy or redeploy after setting variables.

Generate the secrets on a trusted terminal:
```bash
openssl rand -hex 32
openssl rand -hex 32
```
Both secret values are 64 hexadecimal characters. Never commit secrets, real tokens, or `.env` files.

## Use
Open the Vercel URL, sign in with `ADMIN_PASSWORD`, add a label and token from BotFather. The server validates using Telegram `getMe`, encrypts the token, and stores it in MongoDB. Select a bot, enter a chat ID, and send a test message. A user generally must start the bot first; for groups, add the bot and grant send permission.

## Security
This is a private single-admin starter, not a multi-user SaaS. Tokens are encrypted before database storage and never returned to the browser. If `ENCRYPTION_KEY` is lost, saved tokens cannot be recovered. Do not rotate it without re-encrypting existing records. Keep environment variables only in Vercel. Review Atlas network access and database-user permissions. The session cookie is HttpOnly, Secure, SameSite=Strict. Do not expose the admin URL to untrusted users.

## Troubleshooting
- MongoDB connection failure: check URI, username/password, Atlas Network Access, and `MONGODB_DB`.
- Login failure: check `ADMIN_PASSWORD` and `SESSION_SECRET`.
- Encryption failure: `ENCRYPTION_KEY` must be 64 hex characters.
- Telegram validation failure: check token from BotFather.
- Message failure: check chat ID, bot membership, and permissions.
- Inspect Vercel → Project → Logs / Functions for runtime errors.

## Local development
Create a local `.env` file (never commit it), install dependencies, then run `npx vercel dev`.
