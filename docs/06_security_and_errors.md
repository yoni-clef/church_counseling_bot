# Security

## Authentication & Authorization
Since the application operates within Telegram, it relies on Telegram's inherent authentication for validating the source of updates.
- **User Identification**: Uses `ctx.chat.id` (a unique integer per user per bot) to track state.
- **Anonymization**: Instead of exposing Telegram usernames or chat IDs to counselors, the system generates a random `UUID` for every user. Counselors only ever see this UUID during a session.
- **Admin Authorization**: Verified by checking if the incoming `ctx.chat.id` exists in the `ADMIN_CHAT_IDS` environment variable. Admins have exclusive access to moderation and broadcast commands.

## Permission Model
The system uses a simple Role-Based Access Control (RBAC) model with three roles:
1. **User**: Can submit prayers, request counseling, and report counselors.
2. **Counselor**: Must be explicitly approved by an admin. Once approved, can receive sessions, view prayers, and report users.
3. **Admin**: Bypasses standard state checks. Can approve/remove counselors, view system stats, process reports, and send broadcasts.

## Data Privacy
- **Retention Policies**: The `CleanupManager` automatically purges sessions and their associated messages after a configurable period (default 90 days), adhering to data minimization principles.
- **Masking**: The bot acts as a proxy. Direct communication between the user and counselor is impossible, protecting the phone numbers and real identities of both parties.

## Input Validation
- Environment variables are validated on startup (`config/validation.ts`) to ensure the application fails fast if misconfigured.
- Inline keyboard callback data is validated using regex patterns in `BotHandler.ts` before extracting parameters (e.g., parsing integers for pagination).

## Security Recommendations
- **Webhook Security**: If moving from long-polling to webhooks, ensure a secret token is used to verify that incoming requests actually originate from Telegram.
- **Database Access**: Restrict MongoDB access via firewall rules (VPC) and ensure strong credentials are used in `MONGODB_URI`.

---

# Error Handling

## Common Errors & Logging
The application uses the `winston` logging library (`utils/logger.ts`) to provide structured, level-based logging (`info`, `error`, `warn`, `debug`).
- **Global Error Catcher**: Telegraf's `bot.catch()` captures unhandled exceptions thrown during update processing. It logs the error stack and attempts to send a polite "Sorry, something went wrong" message to the user.
- **Database Errors**: Wrapped in try-catch blocks within the Manager classes. If a database operation fails, the error is logged and re-thrown to be caught by the bot's global error handler.
- **Invalid State**: If a user sends a command that does not match their current state in the database, the bot ignores it or prompts them with the relevant menu.

## Recovery & Failure Cases
- **Database Disconnection**: If the MongoDB connection drops, the application relies on the native MongoDB driver's auto-reconnect capabilities.
- **Message Delivery Failure**: If a counselor or user blocks the bot, `ctx.telegram.sendMessage` will throw an error. In future iterations, this should be explicitly caught to close the active session and prevent hanging states.

---

# Troubleshooting Guide

### Issue: Bot is not responding to any commands
**Possible Causes & Fixes:**
1. **Invalid Bot Token**: Check the `.env` file to ensure `BOT_TOKEN` is correct.
2. **Polling Conflict**: Ensure no other instances of the bot (e.g., on a different server or local machine) are running simultaneously using the same token.
3. **Network Issues**: Verify the server has outbound internet access to reach `api.telegram.org`.

### Issue: "Required environment variable MONGODB_URI is not set" on startup
**Fix**: Ensure your `.env` file is present in the root directory and contains the `MONGODB_URI`.

### Issue: Admin commands are not working
**Fix**: 
1. Verify your Telegram Chat ID using a bot like `@userinfobot`.
2. Ensure this exact number is included in the `ADMIN_CHAT_IDS` environment variable.
3. Restart the application so the new configuration is loaded.

### Issue: Counselors are not receiving session requests
**Fix**:
1. Ensure the counselor has completed the `/register_counselor` onboarding.
2. Ensure an Admin has approved them using the "Pending Approvals" menu.
3. Ensure the counselor has set their status to `available` (✅ Set Available).
4. Verify the language and domain selections of the user match the counselor's registered expertise.

### Issue: Database collections are empty or missing
**Fix**:
The application automatically creates collections on startup via `DatabaseManager`. Check the console logs for "Successfully initialized all collections and indexes". If this fails, verify the MongoDB user in the `MONGODB_URI` has the correct `readWrite` privileges for the specified database.
