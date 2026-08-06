# System Architecture

## Overall Architecture
The bot follows a modular, monolithic architecture typical of Node.js services. It separates concerns across multiple layers:
1. **Entry Point / Initialization**: Bootstraps the application, loads configuration, initializes the database, and starts the Telegram bot.
2. **Controller Layer (`BotHandler.ts`)**: Acts as the single point of entry for all incoming Telegram events (commands, text messages, callback queries from inline buttons). It maps Telegram inputs to business logic methods.
3. **Manager Layer (`managers/`)**: Contains all domain-specific logic. Each manager focuses on a specific entity or process.
4. **Data Access Layer (`Collections.ts`)**: Manages MongoDB collections and indexes.
5. **Data Models (`types/`)**: TypeScript interfaces that define the schema for documents stored in the database.

## Folder Structure
- `src/components/`: Houses `BotHandler.ts`.
- `src/config/`: Configuration handling (`Config.ts`, `validation.ts`).
- `src/database/`: MongoDB connection management and collections setup (`DatabaseConnection.ts`, `Collections.ts`).
- `src/managers/`: Domain logic managers.
- `src/models/`: Utility types and index exports.
- `src/types/`: Core data models.
- `src/utils/`: Shared utilities (logging, validators).

## Module Responsibilities
- **`BotHandler`**: Registers commands (e.g., `/help`, `/start`), manages interactive flows (matching, onboarding), handles inline keyboard callbacks (e.g., approving counselors), and routes user text to active sessions or onboarding state machines.
- **`UserManager`**: Registers new users, updates their state (`IDLE`, `IN_SESSION`, etc.), and tracks user activity.
- **`CounselorManager`**: Handles counselor onboarding, approval workflows, status updates (`available`, `away`), and counselor statistics.
- **`SessionManager`**: Creates sessions, routes messages between users and counselors, tracks session duration, and handles session transfers.
- **`ReportingSystem`**: Manages reports submitted against users or counselors, applies strikes automatically, and handles suspensions and appeals.
- **`StatisticsManager`**: Aggregates data for admins and individual counselors (e.g., total sessions, average duration).
- **`BroadcastManager`**: Facilitates sending broadcast messages to specific target groups (users, counselors, everyone).
- **`AuditLogManager`**: Records admin actions for accountability and tracking.
- **`CleanupManager`**: Automatically removes old sessions and data based on retention policies.

## Data Flow & Request Lifecycle
1. **Event Reception**: A user sends a message or presses a button. The Telegraf framework receives the webhook/polling event and passes it to `BotHandler`.
2. **State Resolution**: `BotHandler` determines the sender's identity and current state (e.g., Is the user in an active session? Are they answering an onboarding question?).
3. **Business Logic Execution**: `BotHandler` invokes the appropriate method in a manager class. For example, if a user sends a message during a session, `SessionManager.routeMessage()` is called.
4. **Database Operation**: The manager performs necessary CRUD operations via `Collections`.
5. **Response Generation**: The manager returns the result to `BotHandler`, which uses Telegraf's `ctx.reply()` to send a response or update the UI (e.g., editing inline keyboards).

---

# Business Logic Details

## Session Creation
1. A user selects "Start Counseling" and answers matching questions (language, domain).
2. `SessionManager` looks for an available counselor matching the criteria.
3. If found, an `IN_SESSION` state is applied to both, and a new `Session` document is created.
4. If no counselor is available, the user is notified to wait or try again later.

## Counselor Assignment & Flow
Counselors must explicitly register and go through an onboarding flow. They are not active until an Admin approves them. Once approved, they can toggle their status between `available` and `away`.

## Prayer Request Workflow
1. Users submit a prayer request containing a title.
2. The request is saved to the database.
3. Counselors can view a paginated list of active prayer requests.
4. They only see the request content (no user identity).
5. Counselors can mark requests as "Closed" once they have prayed for them.

## Chat History
Users can view a history of their past sessions. `BotHandler` provides paginated navigation for past sessions and allows users to read historical session transcripts.

## Reporting & Strike System
- **Reporting**: Users can report counselors, and counselors can report users.
- **Strikes**: A report may result in a "strike" against the offender.
- **Suspension**: If strikes exceed `reportSuspendThreshold`, the counselor is temporarily suspended.
- **Revocation**: If strikes exceed `reportRevokeThreshold`, the counselor's access is permanently revoked.
- **Appeals**: Suspended counselors can submit an appeal to admins.

## Broadcast Messages
Admins can draft messages and broadcast them asynchronously to subsets of users (`users`, `counselors`, or `everyone`).

---

# Code Walkthrough (Startup Sequence)

## 1. Entry Point (`src/index.ts`)
The script initializes the application by calling the `main()` async function.
- It loads configuration via `Config.getInstance()`.
- Validates the environment variables (e.g., ensuring `BOT_TOKEN` exists).

## 2. Bot Initialization
- A new instance of `BotHandler` is created with the loaded config.
- `BotHandler.initialize()` is called.

## 3. Database Connection
Within `BotHandler.initialize()`:
- `DatabaseManager` connects to MongoDB.
- `Collections.initializeCollections()` ensures all necessary collections and indexes exist.

## 4. Manager Instantiation
All managers are instantiated and injected with the `Collections` instance, sharing the same database context.

## 5. Telegraf Setup
- Telegraf is instantiated with the `botToken`.
- `BotHandler.registerCommandHandlers()` and `BotHandler.registerMessageHandlers()` map Telegram events to local methods.
- `bot.launch()` begins listening for Telegram updates.

## 6. Background Tasks
- `scheduleCleanup()` is triggered to periodically purge expired sessions according to `SESSION_RETENTION_DAYS`.
- Event listeners are attached to `SIGINT` and `SIGTERM` to allow graceful shutdown and disconnection from MongoDB.
