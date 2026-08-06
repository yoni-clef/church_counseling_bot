# Database Documentation

## Database Technology
The application relies on **MongoDB** as its primary and sole data store. The interaction is managed using the native `mongodb` Node.js driver, providing high performance and direct access to database primitives.

## Data Lifecycle & Cleanup
To comply with privacy standards, the system includes a `CleanupManager` that runs periodically.
- Sessions older than the configured `SESSION_RETENTION_DAYS` (default 90 days) are permanently deleted.
- Orphaned messages associated with deleted sessions are also purged.

## Collections, Schema & Relationships

### 1. `users`
Stores all end-users who interact with the bot.
- **Fields**:
  - `uuid` (String): Unique anonymous identifier generated upon first interaction.
  - `telegramChatId` (Number): The Telegram chat ID for sending messages. (Unique)
  - `state` (String): Current conversation state (e.g., `IDLE`, `IN_SESSION`).
  - `createdAt` (Date): Registration timestamp.
  - `lastInteraction` (Date): Last time the user sent a message/command.
  - `activeSessionId` (String, Optional): Reference to the current session if active.
- **Indexes**: `uuid` (unique), `telegramChatId` (unique), `createdAt`.

### 2. `counselors`
Stores individuals who have registered as counselors.
- **Fields**:
  - `id` (String): Unique identifier.
  - `telegramChatId` (Number): The Telegram chat ID. (Unique)
  - `status` (String): Current availability (`available`, `busy`, `away`).
  - `isApproved` (Boolean): Whether an admin has approved the counselor.
  - `strikes` (Number): Number of moderation strikes received.
  - `isSuspended` (Boolean): Whether the counselor is currently suspended.
  - `sessionsHandled` (Number): Lifetime count of sessions.
  - `createdAt` (Date), `lastActive` (Date).
- **Indexes**: `id` (unique), `telegramChatId` (unique), `status`, `isApproved`, `isSuspended`.

### 3. `sessions`
Represents a counseling interaction between a user and a counselor.
- **Fields**:
  - `sessionId` (String): Unique identifier.
  - `userId` (String): Reference to the user's `uuid`.
  - `counselorId` (String): Reference to the counselor's `id`.
  - `startTime` (Date): When the session began.
  - `endTime` (Date, Optional): When the session was closed.
  - `isActive` (Boolean): True while the session is ongoing.
  - `duration` (Number, Optional): Session duration in minutes.
- **Relationships**: Connects one `User` to one `Counselor`.
- **Indexes**: `sessionId` (unique), `userId`, `counselorId`, `isActive`, `startTime`.

### 4. `messages`
Stores individual chat messages sent during an active session.
- **Fields**:
  - `messageId` (String): Unique identifier.
  - `sessionId` (String): Reference to the parent session.
  - `senderId` (String): The UUID of the user or the ID of the counselor.
  - `senderType` (String): Discriminator (`user` or `counselor`).
  - `content` (String): The text content of the message.
  - `timestamp` (Date): When the message was sent.
- **Indexes**: `messageId` (unique), `sessionId`, `senderId`, `timestamp`.

### 5. `prayers`
Stores prayer requests submitted by users.
- **Fields**:
  - `prayerId` (String): Unique identifier.
  - `userId` (String): Reference to the user's `uuid`.
  - `title` (String): The content of the prayer request.
  - `createdAt` (Date).
- **Indexes**: `prayerId` (unique), `userId`, `createdAt`.

### 6. `reports`
Stores reports submitted against users or counselors for abusive behavior.
- **Fields**:
  - `reportId` (String): Unique identifier.
  - `sessionId` (String): Reference to the session where the incident occurred.
  - `counselorId` (String): Reference to the involved counselor.
  - `reason` (String): Details provided by the reporter.
  - `timestamp` (Date).
  - `processed` (Boolean): Whether an admin has reviewed the report.
- **Indexes**: `reportId` (unique), `sessionId`, `counselorId`, `processed`, `timestamp`.

### 7. `audit_logs`
Stores administrative actions for accountability.
- **Fields**:
  - `logId` (String): Unique identifier.
  - `adminId` (String): Telegram Chat ID of the admin.
  - `action` (String): Action performed (e.g., `APPROVE_COUNSELOR`).
  - `targetId` (String, Optional): The ID of the affected entity.
  - `timestamp` (Date).
  - `details` (Object, Optional): Additional metadata.
- **Indexes**: `logId` (unique), `adminId`, `action`, `timestamp`.

### 8. `appeals`
Stores appeals from suspended counselors.
- **Fields**:
  - `appealId` (String): Unique identifier.
  - `counselorId` (String): Reference to the suspended counselor.
  - `reason` (String): Explanation provided by the counselor.
  - `timestamp` (Date).
  - `processed` (Boolean): Whether an admin has resolved the appeal.

### 9. `broadcast_logs`
Tracks bulk messages sent by admins.
- **Fields**:
  - `broadcastId` (String): Unique identifier.
  - `sentByAdminId` (String): Admin who triggered the broadcast.
  - `target` (String): The target audience (`users`, `counselors`, `everyone`).
  - `message` (String): Content of the broadcast.
  - `sentAt` (Date).
  - `recipientCount` (Number): Number of users successfully reached.

---

# API Documentation

## REST APIs
**Note**: This application does not expose a traditional REST or GraphQL API for client consumption. 

## Telegram API Integration
All external communication is performed over the Telegram Bot API using the `telegraf` wrapper.
- **Input**: The application consumes JSON payloads from Telegram servers (either via Webhook or Long Polling).
- **Output**: The application makes outgoing HTTP requests to Telegram API endpoints (e.g., `sendMessage`, `editMessageText`, `answerCallbackQuery`) to interact with end-users.
