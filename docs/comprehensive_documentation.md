# Church Anonymous Counseling System — Comprehensive Requirements & Specification

This document is the single-source-of-truth requirements specification for the Anonymous Counseling System. It is platform-agnostic — describing what the system does, not how it communicates with a specific chat client. Use this document to reimplement the system as a sub-module in any platform.

---

## Table of Contents

1. [System Purpose & Problem Statement](#1-system-purpose--problem-statement)
2. [Roles & Permissions](#2-roles--permissions)
3. [Data Models](#3-data-models)
4. [User Role — Detailed Requirements](#4-user-role--detailed-requirements)
5. [Counselor Role — Detailed Requirements](#5-counselor-role--detailed-requirements)
6. [Admin Role — Detailed Requirements](#6-admin-role--detailed-requirements)
7. [Suspended Counselor — Detailed Requirements](#7-suspended-counselor--detailed-requirements)
8. [Counselor Matching Algorithm](#8-counselor-matching-algorithm)
9. [Session Transfer System](#9-session-transfer-system)
10. [Moderation, Reporting & Strike System](#10-moderation-reporting--strike-system)
11. [Session Rating System](#11-session-rating-system)
12. [Prayer Request System](#12-prayer-request-system)
13. [Broadcast System](#13-broadcast-system)
14. [Statistics & Analytics](#14-statistics--analytics)
15. [Audit Logging](#15-audit-logging)
16. [Data Retention & Cleanup](#16-data-retention--cleanup)
17. [Configurable System Parameters](#17-configurable-system-parameters)
18. [User State Machine](#18-user-state-machine)
19. [Security & Privacy](#19-security--privacy)
20. [Known Technical Debt & Improvement Opportunities](#20-known-technical-debt--improvement-opportunities)

---

## 1. System Purpose & Problem Statement

Many individuals in church communities struggle with issues they feel uncomfortable sharing openly due to fear of judgment or stigma. This system provides a safe, **completely anonymous** channel for these individuals to:

- Request counseling sessions with qualified, church-approved counselors.
- Submit prayer requests without revealing their identity.
- Report inappropriate counselor behavior.

The system guarantees that **no personally identifying information** (real name, username, phone number) is ever exposed to the counselor. The user is represented only by a randomly generated UUID.

---

## 2. Roles & Permissions

The system has **four** distinct roles. A person's role is determined at runtime:

| Role | How Determined | Description |
|---|---|---|
| **User** | Default role for all registered participants | Can request counseling, submit prayers, report counselors, view own history |
| **Counselor** | A User who has completed onboarding AND been approved by an Admin | Can accept sessions, view prayers, transfer sessions, view own stats, report users |
| **Admin** | Identified by a preconfigured list of IDs (`ADMIN_CHAT_IDS`) | Full system control: approve/remove counselors, process reports, view system stats, broadcast messages, view audit logs, process appeals |
| **Suspended Counselor** | A Counselor whose `isSuspended` flag is `true` | Can only submit an Appeal. Cannot accept sessions or access counselor features |

### Role Hierarchy & Access Rules

- **Admins bypass all state checks.** They can always access admin commands regardless of their current conversation state.
- **Counselors** must be both `isApproved: true` AND `isSuspended: false` to access counselor features.
- **A Counselor is also a User.** They exist in both the `users` and `counselors` collections. When the broadcast target is `users` only, counselors are excluded from the user broadcast to avoid duplicates.

---

## 3. Data Models

### 3.1 User

| Field | Type | Required | Description |
|---|---|---|---|
| `uuid` | String (UUIDv4) | ✅ | Anonymous identifier, generated on first interaction. **This is the only identity visible to counselors.** |
| `telegramChatId` | Number | ✅ | Platform-specific ID for sending messages. Unique. |
| `state` | UserState enum | ✅ | Current conversation state (see §18). Default: `IDLE` |
| `createdAt` | Date | ✅ | Registration timestamp |
| `lastActive` | Date | ✅ | Updated on every interaction |
| `user_preferred_language` | String[] | ❌ | Languages selected during matching flow |
| `user_requested_domain` | String | ❌ | Counseling domain selected during matching flow |

**Indexes:** `uuid` (unique), `telegramChatId` (unique), `createdAt`

### 3.2 Counselor

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | String (UUIDv4) | ✅ | — | Unique counselor identifier |
| `telegramChatId` | Number | ✅ | — | Platform-specific ID. Unique. |
| `status` | CounselorStatus | ✅ | `Pending Admin Approval` | One of: `available`, `busy`, `away`, `Pending Admin Approval` |
| `isApproved` | Boolean | ✅ | `false` | Set to `true` only by Admin approval |
| `isSuspended` | Boolean | ✅ | `false` | Set to `true` when strikes ≥ suspend threshold |
| `strikes` | Number | ✅ | `0` | Accumulated moderation strikes |
| `sessionsHandled` | Number | ✅ | `0` | Lifetime count of completed sessions |
| `ratingCount` | Number | ✅ | `0` | Number of ratings received |
| `ratingTotal` | Number | ✅ | `0` | Sum of all rating scores |
| `ratingAverage` | Number | ✅ | `0` | Computed average: `ratingTotal / ratingCount` |
| `fullName` | String | ❌ | — | Collected during onboarding |
| `telegramUsername` | String | ❌ | — | Collected during onboarding |
| `languagesSpoken` | String[] | ❌ | `[]` | Languages the counselor can counsel in |
| `domainExpertise` | String[] | ❌ | `[]` | Domains the counselor specializes in |
| `yearsExperience` | Number | ❌ | — | Years of counseling experience |
| `country` | String | ❌ | — | Country of residence |
| `location` | String | ❌ | — | City/region |
| `createdAt` | Date | ✅ | — | Registration timestamp |
| `lastActive` | Date | ✅ | — | Updated on status changes and session activity |

**Indexes:** `id` (unique), `telegramChatId` (unique), `status`, `isApproved`, `isSuspended`

### 3.3 Session

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `sessionId` | String | ✅ | `session_<uuid>` | Unique session identifier |
| `userId` | String | ✅ | — | Reference to User.uuid |
| `counselorId` | String | ✅ | — | Reference to the **original** Counselor.id |
| `currentCounselorId` | String | ❌ | Same as `counselorId` | The counselor currently handling the session (changes on transfer) |
| `previousCounselorId` | String | ❌ | — | The last counselor before the most recent transfer |
| `startTime` | Date | ✅ | — | When the session began |
| `endTime` | Date | ❌ | — | When the session ended |
| `isActive` | Boolean | ✅ | `true` | `false` when session is closed |
| `duration` | Number | ❌ | — | Session length in minutes (calculated on end) |
| `consentGiven` | Boolean | ❌ | — | Whether the user agreed to the consent disclosure |
| `consentTimestamp` | Date | ❌ | — | When consent was given |
| `userPreferredLanguage` | String[] | ❌ | — | Snapshot of languages from matching |
| `userRequestedDomain` | String | ❌ | — | Snapshot of domain from matching |
| `transferReason` | String | ❌ | — | Reason for the most recent transfer |
| `transferTimestamp` | Date | ❌ | — | When the most recent transfer occurred |
| `transferCount` | Number | ❌ | `0` | Total number of transfers |
| `transferHistory` | Array | ❌ | `[]` | Full audit trail of transfers (see §9) |
| `ratingScore` | Number (1-5) | ❌ | — | User's rating of the session |
| `ratingTimestamp` | Date | ❌ | — | When the rating was submitted |

**Indexes:** `sessionId` (unique), `userId`, `counselorId`, `isActive`, `startTime`

### 3.4 Message

| Field | Type | Required | Description |
|---|---|---|---|
| `messageId` | String | ✅ | `msg_<uuid>` |
| `sessionId` | String | ✅ | Reference to Session.sessionId |
| `senderId` | String | ✅ | User UUID or Counselor ID |
| `senderType` | `user` \| `counselor` | ✅ | Discriminator |
| `content` | String | ✅ | Message text (trimmed, non-empty) |
| `timestamp` | Date | ✅ | When the message was sent |

**Indexes:** `messageId` (unique), `sessionId`, `senderId`, `timestamp`

### 3.5 Prayer Request

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `prayerId` | String (UUIDv4) | ✅ | — | Unique identifier |
| `userId` | String | ✅ | — | Reference to User.uuid |
| `title` | String | ✅ | — | The prayer topic/content |
| `createdAt` | Date | ✅ | — | Submission timestamp |
| `status` | `open` \| `closed` | ✅ | `open` | Current state |
| `closedAt` | Date | ❌ | — | When the prayer was closed |

**Indexes:** `prayerId` (unique), `userId`, `createdAt`

### 3.6 Report

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `reportId` | String | ✅ | `report_<uuid>` | Unique identifier |
| `sessionId` | String | ✅ | — | The session where the incident occurred |
| `counselorId` | String | ✅ | — | The counselor being reported |
| `reason` | String | ✅ | — | Free-text reason provided by the reporter |
| `timestamp` | Date | ✅ | — | When the report was filed |
| `processed` | Boolean | ✅ | `false` | Whether an admin has reviewed it |

**Indexes:** `reportId` (unique), `sessionId`, `counselorId`, `processed`, `timestamp`

### 3.7 Appeal

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `appealId` | String | ✅ | `AL-<random8>` | Unique identifier |
| `counselorId` | String | ✅ | — | The suspended counselor filing the appeal |
| `message` | String | ✅ | — | The counselor's explanation/plea |
| `strikes` | Number | ✅ | — | Snapshot of the counselor's strike count at time of appeal |
| `timestamp` | Date | ✅ | — | When the appeal was filed |
| `processed` | Boolean | ✅ | `false` | Whether an admin has resolved it |
| `processedAt` | Date | ❌ | — | When it was resolved |
| `processedBy` | String | ❌ | — | Admin ID who resolved it |
| `action` | `revoke` \| `approve` | ❌ | — | The admin's decision |

### 3.8 Audit Log

| Field | Type | Required | Description |
|---|---|---|---|
| `logId` | String | ✅ | `audit_<uuid>` |
| `adminId` | String | ✅ | The admin who performed the action |
| `action` | String | ✅ | Action name (e.g., `APPROVE_COUNSELOR`, `PROCESS_REPORT`) |
| `targetId` | String | ❌ | ID of the affected entity |
| `timestamp` | Date | ✅ | When the action occurred |
| `details` | Object | ❌ | Additional metadata |

### 3.9 Broadcast Log

| Field | Type | Required | Description |
|---|---|---|---|
| `broadcastId` | String | ✅ | `BC-<random10>` |
| `message` | String | ✅ | Content of the broadcast |
| `targetGroup` | `users` \| `counselors` \| `everyone` | ✅ | Who received the broadcast |
| `sentByAdminId` | String | ✅ | Admin who triggered it |
| `sentAt` | Date | ✅ | When the broadcast was sent |
| `successCount` | Number | ✅ | Messages delivered successfully |
| `failedCount` | Number | ✅ | Messages that failed to deliver |

---

## 4. User Role — Detailed Requirements

### 4.1 Registration

- On first interaction, the system generates a **UUIDv4** as the user's anonymous identifier.
- If the user already exists (looked up by their platform chat ID), their existing UUID is returned.
- The user's state is initialized to `IDLE`.
- The `lastActive` timestamp is updated on every interaction.

### 4.2 Request a Counseling Session (Matching Flow)

This is a **multi-step wizard** with the following sequential steps:

1. **Language Selection (multi-select)**
   - The user picks one or more preferred languages from a predefined list: `English`, `Amharic`, `Afaan Oromo`, `Tigrinya`, `Other`.
   - If "Other" is selected, the user types a custom language.
   - The user can toggle selections on/off and must confirm with "Done".
   - At least one language must be selected.

2. **Domain Selection (single-select)**
   - The user picks exactly one counseling domain from:
     - `Mental Health Support`, `Anxiety`, `Depression`, `Relationship Counseling`, `Marriage Counseling`, `Spiritual Guidance`, `Grief / Loss`, `Addiction Recovery`, `Youth Counseling`, `Other`
   - If "Other" is selected, the user types a custom domain.

3. **Consent Disclosure**
   - The user is shown a mandatory consent message:
     > *"Before we begin, please note: This counseling session is anonymous. Messages may be logged for safety and quality purposes. Do not share personally identifying information. By continuing, you consent to participate under these terms."*
   - The user must explicitly agree to proceed.

4. **Counselor Matching** (see §8 for the full algorithm)
   - The system searches for the best available counselor.
   - If no counselor speaks any of the user's languages → the user is told "no language match" and offered options: "Choose Another Language" or "Wait for Counselor".
   - If no counselor is available at all → the user is told to try again later.

5. **Session Creation**
   - A new Session document is created with `isActive: true`.
   - Both user and counselor states are updated.
   - The counselor is notified that a session has been assigned.

**Navigation:** At every step, the user can go "Back" to the previous step or "Cancel" the entire flow, which resets them to `IDLE`.

### 4.3 In-Session Behavior

- Every text message the user sends is **stored** in the `messages` collection and **routed** to the assigned counselor.
- The counselor only sees the user's UUID — never their real identity.
- The user can **end the session** at any time.
- When a session ends:
  - `isActive` is set to `false`.
  - `endTime` and `duration` (in minutes) are calculated and stored.
  - The counselor's `sessionsHandled` is incremented by 1.
  - The counselor's status is set back to `available`.
  - The user's state transitions to `RATING_REQUIRED`.

### 4.4 Post-Session Rating

- After a session ends, the user **must rate the session** before they can do anything else.
- This is enforced via middleware: any action other than rating is blocked while in `RATING_REQUIRED` state.
- The rating is an integer from **1 to 5**.
- The rating updates both the Session document (`ratingScore`, `ratingTimestamp`) and the Counselor's rolling average (`ratingCount`, `ratingTotal`, `ratingAverage`).
- A session can only be rated once. Duplicate ratings are silently ignored.
- Only the user who participated in the session can rate it.
- Active sessions cannot be rated.

### 4.5 Submit a Prayer Request

- The user enters `SUBMITTING_PRAYER` state and types a prayer title/topic.
- The title is trimmed. Empty titles are rejected.
- The prayer is stored with status `open`.
- The user returns to `IDLE`.

### 4.6 View Session History

- The user can view a **paginated list** of all their past sessions (page size: 10).
- Each entry shows: session ID, counselor ID, start time, end time, duration, active status.
- The user can select a session to view its **full message transcript** (paginated, page size: 25).
- Access control: a user can only view transcripts of sessions they participated in.

### 4.7 Report a Counselor

- The user enters `REPORTING` state.
- The system looks up the user's most recent session.
- The user types a free-text reason for the report.
- The report is validated (reason cannot be empty, session must exist, counselor must match the session).
- The report is stored with `processed: false`.
- An admin notification is triggered.

### 4.8 User Menu Actions (when IDLE)

| Action | Description |
|---|---|
| Start Counseling | Begins the matching wizard (§4.2) |
| Submit Prayer Request | Enters prayer submission flow (§4.5) |
| My History | View past sessions (§4.6) |
| Help | Show instructions |
| Main Menu | Reset state to IDLE |
| Register as Counselor | Begin counselor onboarding (§5.1) |

---

## 5. Counselor Role — Detailed Requirements

### 5.1 Onboarding (Registration Flow)

A multi-step onboarding wizard collects the following information in order:

| Step | Field | Input Type | Required |
|---|---|---|---|
| 1 | `fullName` | Free text | ✅ |
| 2 | `telegramUsername` | Free text | ✅ |
| 3 | `languagesSpoken` | Multi-select from predefined list + "Other" (typed) | ✅ (at least 1) |
| 4 | `domainExpertise` | Multi-select from predefined list + "Other" (typed) | ✅ (at least 1) |
| 5 | `yearsExperience` | Number (typed) | ✅ |
| 6 | `country` | Free text | ✅ |
| 7 | `location` | Free text | ✅ |
| 8 | **Confirmation** | Review summary → Confirm or Cancel | ✅ |

**Predefined Languages:** `English`, `Amharic`, `Afaan Oromo`, `Tigrinya`, `Other`

**Predefined Domains:** `Mental Health Support`, `Anxiety`, `Depression`, `Relationship Counseling`, `Marriage Counseling`, `Spiritual Guidance`, `Grief / Loss`, `Addiction Recovery`, `Youth Counseling`, `Other`

**Navigation:** Back/Cancel available at every step.

**On Confirmation:**
- A new Counselor document is created with `status: 'Pending Admin Approval'`, `isApproved: false`.
- All admins are notified with the counselor's full profile for review.
- The user's state returns to `IDLE`.

### 5.2 Approval Requirement

- A counselor **cannot** accept sessions, view prayer requests, or use any counselor feature until `isApproved: true`.
- Approval can only be granted by an Admin (see §6.2).

### 5.3 Availability Management

Counselors can toggle their status between:

| Status | Meaning |
|---|---|
| `available` | Ready to receive session assignments |
| `busy` | Currently in a session (set automatically by the system) |
| `away` | Not accepting sessions (set manually by counselor) |
| `Pending Admin Approval` | Initial state before approval |

- Only counselors with `status: 'available'`, `isApproved: true`, `isSuspended: false` are eligible for matching.
- Every status change is recorded in an in-memory audit trail (counselorId, previousStatus, newStatus, changedBy, timestamp).

### 5.4 Handling Sessions

- When matched with a user, the counselor receives a notification with the session details (user's UUID, domain, languages).
- All messages from the user are forwarded to the counselor, and vice versa.
- The counselor can **end the session** at any time (same mechanics as user-initiated end, §4.3).
- The counselor can **transfer the session** to another counselor (see §9).

### 5.5 View Prayer Requests

- Counselors can view a **paginated list** of all `open` prayer requests (page size: 10).
- Each entry shows: prayer ID, title, created date. **No user identity is shown.**
- Counselors can **close** a prayer request (marking `status: 'closed'`, recording `closedAt`).
- Already-closed prayers cannot be re-closed.

### 5.6 View Personal Statistics

Counselors can view their own statistics:
- `sessionsHandled`: Total lifetime sessions completed
- `status`: Current availability status
- `isApproved`: Approval status
- `strikes`: Number of moderation strikes
- `isSuspended`: Suspension status
- `lastActive`: Last activity timestamp

### 5.7 Report a User

- Counselors can report users using the same reporting flow as users (§4.7).

### 5.8 Counselor Menu Actions (when IDLE)

All User menu actions, PLUS:

| Action | Description |
|---|---|
| Set Available | Set status to `available` |
| Set Away | Set status to `away` |
| My Stats | View personal counselor statistics |
| Prayer Requests | View open prayer requests |
| Close Prayers | Close a prayer request |
| Transfer Session | Transfer active session to another counselor |

---

## 6. Admin Role — Detailed Requirements

### 6.1 Identification

- Admins are identified by a **preconfigured list of platform chat IDs** (`ADMIN_CHAT_IDS`).
- This list is set via environment configuration and cannot be changed at runtime.
- Admins bypass all user state checks — they can always access admin commands.

### 6.2 Approve a Counselor

- Admins see a paginated list of counselors with `isApproved: false` (pending approval).
- On approval:
  - `isApproved` is set to `true`.
  - `isSuspended` is set to `false`.
  - `lastActive` is updated.
  - An audit log entry is created.
  - The counselor is notified of their approval.

### 6.3 Remove a Counselor

- Admins can remove (revoke) any counselor.
- On removal:
  - **All active sessions** involving the counselor are **gracefully ended** (duration calculated, `isActive` set to `false`).
  - `isApproved` is set to `false`.
  - `isSuspended` is set to `true`.
  - `status` is set to `away`.
  - An audit log entry is created.

### 6.4 View Counselor List

- Admins can view a paginated list of **all counselors** showing:
  - Counselor ID, status, approval status, sessions handled, strikes, suspension status, last active date.

### 6.5 Process Reports

- Admins see a paginated list of **unprocessed reports** (`processed: false`), sorted newest first.
- For each report, the admin can:
  - **View the session's full message history** (unrestricted access — no participant check).
  - Take one of two actions:
    - **Strike**: Applies a strike to the counselor (see §10).
    - **Dismiss**: Marks the report as processed with no strike.
- After processing, `processed` is set to `true`.
- An audit log entry is created.

### 6.6 Process Appeals

- Admins see a paginated list of **unprocessed appeals** (`processed: false`).
- For each appeal, the admin can:
  - **Revoke**: Keep the suspension/revocation in place. The appeal is marked as processed with `action: 'revoke'`.
  - **Approve (Reinstate)**: Lift the suspension. The counselor's `isSuspended` is set to `false`, `isApproved` is set to `true`, `strikes` are reset to `0`. The appeal is marked as processed with `action: 'approve'`.
- An audit log entry is created.
- The counselor is notified of the decision.

### 6.7 View System Statistics

See §14 for full details. Admin statistics include system-wide metrics.

### 6.8 Broadcast Messages

See §13 for full details.

### 6.9 View Audit Log

- Admins can view a paginated log of all admin actions, sorted newest first.
- Each entry shows: log ID, admin ID, action, target ID, timestamp, details.

### 6.10 Admin Menu Actions

All User menu actions, PLUS:

| Action | Description |
|---|---|
| Admin Stats | View system-wide statistics |
| Pending Reports | View and process unresolved reports |
| Counselors List | View all counselors with status details |
| Appeals | View and process counselor appeals |
| Approve Counselor | Approve pending counselor applications |
| Remove Counselor | Revoke a counselor's access |
| Audit Log | View admin action history |
| Broadcast Message | Send a message to a group of users |

---

## 7. Suspended Counselor — Detailed Requirements

When a counselor is suspended (`isSuspended: true`):

- They **lose access** to all counselor features (no sessions, no prayer requests, no stats).
- Their only available action is **Submit an Appeal**.
- The appeal flow:
  1. The counselor enters `APPEALING` state.
  2. They type a free-text message explaining their appeal.
  3. An Appeal document is created with a snapshot of their current strike count.
  4. All admins are notified.
  5. The counselor returns to `IDLE`.

### Suspended Counselor Menu

| Action | Description |
|---|---|
| Appeal | Submit an appeal to admins |
| (Standard user actions) | Submit prayer, view history, help |

---

## 8. Counselor Matching Algorithm

When a user requests a counseling session, the system uses a **multi-factor ranking algorithm** to find the best available counselor.

### 8.1 Eligibility Filter

Only counselors matching ALL of the following criteria are candidates:
- `status === 'available'`
- `isApproved === true`
- `isSuspended === false`
- `telegramChatId !== requesterChatId` (a user cannot be matched with themselves)

### 8.2 Language Filter (Hard Requirement)

- The counselor's `languagesSpoken` must overlap with at least one of the user's `preferredLanguages`.
- Comparison is **case-insensitive**.
- If **no counselor** passes the language filter, the system returns a `no_language_match` result. The user is offered: "Choose Another Language" or "Wait for Counselor".

### 8.3 Domain Matching (Soft Preference)

- If any counselor's `domainExpertise` includes the user's `requestedDomain` (case-insensitive), those counselors are preferred.
- If no counselor matches the domain, **all language-matching counselors remain eligible** — domain is a preference, not a hard filter.

### 8.4 Ranking Criteria (Tie-Breaking Order)

Candidates are sorted by the following criteria, in priority order:

| Priority | Criterion | Direction | Rationale |
|---|---|---|---|
| 1 | Domain match | Exact match preferred | Specialist over generalist |
| 2 | Language match count | Higher is better | More shared languages = better communication |
| 3 | Active session count | Lower is better | Spread workload evenly |
| 4 | Rating average | Higher is better | Prefer higher-rated counselors |
| 5 | Sessions handled (lifetime) | Lower is better | Give less-experienced counselors more opportunities |

The **top-ranked** counselor is assigned to the session.

---

## 9. Session Transfer System

A counselor can transfer an active session to another counselor. This is a multi-step process:

### 9.1 Transfer Initiation

The counselor selects "Transfer Session" and chooses a reason from a predefined list:
- `Outside my expertise`
- `Language mismatch`
- `User needs specialized support`
- `Technical issue`
- `Other` (free text)

### 9.2 Finding a Transfer Candidate

The system searches for eligible counselors using the same matching algorithm (§8), but:
- The **current counselor** is excluded from candidates.
- Matching uses the session's original language and domain preferences.

### 9.3 Transfer Request

- A transfer request is sent to the candidate counselor.
- The candidate can **Accept** or **Decline**.
- If declined, the system moves to the **next-best candidate** (iterating through ranked candidates).
- If all candidates decline or none are available, the user is offered three options:
  - **Continue** with the current counselor.
  - **Wait** for a counselor to become available.
  - **End** the session.

### 9.4 Transfer Execution

On acceptance:
- `currentCounselorId` is updated to the new counselor's ID.
- `previousCounselorId` records the outgoing counselor.
- `transferCount` is incremented.
- A transfer entry is appended to `transferHistory`:
  ```
  { fromCounselorId, toCounselorId, reason, timestamp }
  ```
- The outgoing counselor is set to `available`.
- Both the user and the new counselor are notified.

### 9.5 Message History Access After Transfer

- **All counselors** who have ever been part of a session (original, current, previous, or any in the transfer history) retain read access to the session's message history.

---

## 10. Moderation, Reporting & Strike System

### 10.1 Report Submission

- Reports are filed against a **counselor** within the context of a specific **session**.
- Validations:
  - The session must exist.
  - The counselor must match the session's counselor.
  - The reason cannot be empty.

### 10.2 Strike Application

When an admin processes a report with action `strike`:
- The counselor's `strikes` count is incremented by 1.
- **Automatic consequences** based on thresholds:

| Strikes | Action |
|---|---|
| `< suspendThreshold` | No automatic action (strike recorded only) |
| `≥ suspendThreshold` AND `< revokeThreshold` | `isSuspended` set to `true`, `status` set to `away` — **Temporary Suspension** |
| `≥ revokeThreshold` | `isApproved` set to `false`, `isSuspended` set to `true`, `status` set to `away` — **Permanent Revocation** |

### 10.3 Configurable Thresholds

- `REPORT_SUSPEND_THRESHOLD` (default: 3): Strikes before temporary suspension.
- `REPORT_REVOKE_THRESHOLD` (default: 5): Strikes before permanent revocation.
- Constraint: `revokeThreshold >= suspendThreshold` (validated at startup).

### 10.4 Dismiss Action

When an admin processes a report with action `dismiss`:
- The report is simply marked as `processed: true`.
- No strike is applied.

---

## 11. Session Rating System

### 11.1 Rating Flow

- After every session ends, the user's state is set to `RATING_REQUIRED`.
- The user is prompted with a 1-5 star rating.
- **This is mandatory** — a middleware blocks all other actions until the rating is submitted.
- Exceptions to the block: admins, and callback actions related to rating itself.

### 11.2 Rating Rules

- Must be an integer between 1 and 5.
- Only the session's user (`session.userId`) can rate it.
- Active sessions cannot be rated.
- Each session can only be rated once.

### 11.3 Counselor Rating Aggregation

When a rating is submitted:
1. The session's `ratingScore` and `ratingTimestamp` are saved.
2. The counselor's stats are updated:
   - `ratingCount += 1`
   - `ratingTotal += ratingScore`
   - `ratingAverage = ratingTotal / ratingCount`

---

## 12. Prayer Request System

### 12.1 Submission

- Any registered user can submit a prayer request.
- The request contains a title/topic (free text, trimmed, non-empty).
- Created with `status: 'open'`.

### 12.2 Viewing (Counselors Only)

- Counselors see a paginated list of prayers where `status === 'open'` (or `status` field doesn't exist, for backwards compatibility).
- Sorted by `createdAt` descending (newest first).
- **Privacy:** Only `prayerId`, `title`, and `createdAt` are shown. The `userId` is **never** revealed to counselors.

### 12.3 Closing

- Any approved, non-suspended counselor can close any open prayer request.
- Closing sets `status: 'closed'` and records `closedAt`.
- Already-closed prayers are silently ignored.

### 12.4 User View

- Users can view their own prayer requests (all statuses).

---

## 13. Broadcast System

### 13.1 Initiation (Admin Only)

The broadcast flow is a multi-step process:

1. **Select Target Group:**
   - `users` — All registered users, **excluding** counselors.
   - `counselors` — All approved, non-suspended counselors.
   - `everyone` — All users + all approved, non-suspended counselors (deduplicated).

2. **Compose Message:** The admin types the broadcast content.

3. **Confirm or Cancel:** The admin reviews the message and target, then confirms or cancels.

### 13.2 Execution

- Messages are sent sequentially with a **50ms delay** between each to respect rate limits.
- Each send attempt is tracked: success or failure.
- A `BroadcastLog` entry is created recording: broadcastId, message, targetGroup, adminId, sentAt, successCount, failedCount.

### 13.3 Recipient Selection Logic

| Target | Recipients |
|---|---|
| `users` | All entries in the `users` collection MINUS anyone who also exists in the `counselors` collection |
| `counselors` | All entries in `counselors` where `isApproved: true` AND `isSuspended: false` |
| `everyone` | Union of `users` (full) + `counselors` (approved, non-suspended), deduplicated by chat ID |

---

## 14. Statistics & Analytics

### 14.1 System-Wide Statistics (Admin)

| Metric | Description |
|---|---|
| `totalSessionsCompleted` | Count of sessions where `isActive: false` |
| `activeSessions` | Count of sessions where `isActive: true` |
| `averageSessionDuration` | Mean duration (minutes) of completed sessions |
| `totalPrayerRequests` | Total count of prayer documents |
| `peakUsageHours` | Top 3 hours (0-23) when most sessions started |

### 14.2 Counselor Statistics (Counselor)

Scoped to the individual counselor's sessions:
- `totalSessionsCompleted`, `activeSessions`, `averageSessionDuration` — filtered by `counselorId`.
- `peakUsageHours` — filtered by `counselorId`.

### 14.3 User Statistics

Scoped to the individual user's sessions:
- `totalSessionsCompleted`, `activeSessions`, `averageSessionDuration` — filtered by `userId`.
- `totalPrayerRequests` — filtered by `userId`.
- `peakUsageHours` — filtered by `userId`.

### 14.4 Counselor Workforce Analytics (Admin)

| Metric | Description |
|---|---|
| `totalCounselors` | Total counselor records |
| `approvedCounselors` | Counselors with `isApproved: true` |
| `availableCounselors` | Counselors with `status: 'available'`, `isApproved: true`, `isSuspended: false` |
| `suspendedCounselors` | Counselors with `isSuspended: true` |
| `totalSessionsHandled` | Sum of all counselors' `sessionsHandled` |
| `averageSessionsPerCounselor` | `totalSessionsHandled / totalCounselors` |
| `workloadDistribution` | Per-counselor: `sessionsHandled` and `workloadPercentage` (their share of total sessions) |

### 14.5 Peak Usage Calculation

- Sessions are grouped by the **hour** (0-23) of their `startTime`.
- The top 3 hours by session count are returned.
- Supports optional time-window filtering (`start`, `end` dates).

---

## 15. Audit Logging

Every admin action is recorded as an `AuditLog` entry:

| Admin Action | `action` String |
|---|---|
| Approve a counselor | `APPROVE_COUNSELOR` |
| Remove a counselor | `REMOVE_COUNSELOR` |
| Process a report (strike) | `PROCESS_REPORT` with details including action |
| Process a report (dismiss) | `PROCESS_REPORT` with details including action |
| Process an appeal | `PROCESS_APPEAL` with details |
| Send a broadcast | `BROADCAST` with target and stats |

Audit logs support:
- **Recent actions**: Retrieve the last N entries (default: 25).
- **Paginated access**: Page through the full log with configurable page size.

---

## 16. Data Retention & Cleanup

A `CleanupManager` runs on a configurable interval to enforce data retention:

### Cleanup Rules

- Sessions with `startTime` older than `SESSION_RETENTION_DAYS` are deleted.
- All **messages** linked to deleted sessions (by `sessionId`) are deleted.
- All **reports** linked to deleted sessions (by `sessionId`) are deleted.
- Deletions happen in parallel for performance.

### Configurable Parameters

- `SESSION_RETENTION_DAYS` (default: 90 days)
- `CLEANUP_INTERVAL_HOURS` (default: 24 hours)

### Cleanup Result

Each run reports: `sessionsDeleted`, `messagesDeleted`, `reportsDeleted`.

---

## 17. Configurable System Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `SESSION_RETENTION_DAYS` | Integer | `90` | Days before closed sessions are purged |
| `CLEANUP_INTERVAL_HOURS` | Integer | `24` | Hours between cleanup runs |
| `REPORT_SUSPEND_THRESHOLD` | Integer | `3` | Strikes before temporary counselor suspension |
| `REPORT_REVOKE_THRESHOLD` | Integer | `5` | Strikes before permanent counselor revocation |
| `ADMIN_CHAT_IDS` | Comma-separated integers | `[]` | Platform IDs of admin users |
| `LOG_LEVEL` | String | `info` | Logging verbosity: `info`, `debug`, `warn`, `error` |
| `PAGE_SIZE` | Integer (hardcoded) | `10` | Items per page for paginated lists |
| `HISTORY_CHAT_PAGE_SIZE` | Integer (hardcoded) | `25` | Messages per page in session transcript view |

---

## 18. User State Machine

The user's `state` field determines how incoming text is interpreted. Transitions are managed by the system:

| State | Trigger | Behavior | Next State |
|---|---|---|---|
| `IDLE` | Default | Normal menu browsing. Text is ignored unless it matches a menu action | (varies by action) |
| `MATCHING` | User starts counseling flow | Text is processed as matching wizard input (custom language/domain) | `IDLE` (on cancel) or `IN_SESSION` (on match) |
| `IN_SESSION` | Session created | All text is routed to the matched counselor | `RATING_REQUIRED` (on session end) |
| `RATING_REQUIRED` | Session ends | User must rate the session. All other actions are blocked. | `IDLE` (after rating) |
| `POST_SESSION` | After rating | Transitional state allowing report | `IDLE` |
| `SUBMITTING_PRAYER` | User starts prayer flow | Next text is saved as the prayer title | `IDLE` |
| `VIEWING_HISTORY` | User opens history | Browsing paginated history | `IDLE` |
| `REPORTING` | User starts report flow | Next text is saved as the report reason | `IDLE` |
| `COUNSELOR_ONBOARDING` | User starts counselor registration | Text is processed as onboarding wizard input | `IDLE` (on completion or cancel) |
| `APPEALING` | Suspended counselor starts appeal | Next text is saved as the appeal message | `IDLE` |
| `WAITING_COUNSELOR` | Matching in progress | System is searching for a counselor | `IN_SESSION` or `IDLE` |
| `BROADCASTING` | Admin starts broadcast | Text is processed as broadcast content | `IDLE` |

---

## 19. Security & Privacy

### 19.1 Anonymity Guarantees

- Users are represented **only** by their UUID in all counselor-facing contexts.
- The system acts as a **proxy** — counselors and users never communicate directly.
- Prayer requests strip the `userId` before being shown to counselors.
- Utility functions exist to further anonymize IDs for logging: only the first 8 characters are shown in logs.

### 19.2 Authentication

- Relies on the messaging platform's inherent user authentication.
- Each user is uniquely identified by their platform chat ID.

### 19.3 Authorization

- **Admin**: Verified by checking if the chat ID exists in `ADMIN_CHAT_IDS`.
- **Counselor**: Must have `isApproved: true` AND `isSuspended: false`.
- **User**: Default role — all registered participants.

### 19.4 Access Control on Messages

- A user can only view message history for sessions where `session.userId === requesterId`.
- A counselor can view message history for sessions where they are the current, previous, or original counselor, or appear anywhere in the transfer history.
- Admins can view **any** session's message history (for report processing).

### 19.5 Session Access Control

- A user can only have **one active session** at a time.
- A counselor can only have **one active session** at a time.
- Creating a session requires the counselor to be `isApproved` and not `isSuspended`.

### 19.6 Consent

- A session cannot be created without explicit user consent (`consentGiven: true`).

### 19.7 Configuration Validation

- On startup, the system validates all required configuration (database URI, bot credentials).
- Fails fast with a clear error message if misconfigured.
- The revoke threshold must be ≥ suspend threshold (validated at startup).

---

## 20. Known Technical Debt & Improvement Opportunities

### Architecture

- **Monolithic controller**: The main handler file is ~4000 lines. It should be refactored into modular controllers per role (AdminController, CounselorController, SessionController).
- **In-memory state**: Counselor onboarding state, matching state, and transfer state are stored in in-memory Maps. These are **lost on server restart**. They should be persisted to the database or a cache (Redis).

### Missing Features

- **Media support**: Only text messages are proxied. Voice notes, images, and documents are not supported.
- **Internationalization (i18n)**: All strings are hardcoded in English. Language files should support Amharic, Afaan Oromo, Tigrinya.
- **Pagination caching**: Every page turn queries the database. A caching layer would improve performance.

### Performance

- **Compound indexes**: Complex matching queries may benefit from compound indexes optimized for the specific filter/sort patterns.
