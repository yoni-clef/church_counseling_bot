# Project Overview

## Project Name
Church Anonymous Counseling Bot

## Purpose
The Church Anonymous Counseling Bot is designed to provide anonymous counseling and prayer support for church communities via Telegram. It bridges the gap between individuals seeking spiritual or emotional guidance and approved church counselors.

## Problem it Solves
Many individuals in church communities struggle with issues they feel uncomfortable sharing openly due to fear of judgment or stigma. This bot provides a safe, anonymous channel for these individuals to request prayer or engage in counseling sessions, ensuring privacy while connecting them with qualified support.

## High-Level Architecture
The application is built as a monolithic Node.js backend utilizing a webhook/polling model to communicate with the Telegram API. 
- **Client**: Telegram App (Users, Counselors, Admins)
- **Controller**: BotHandler processes all incoming Telegram updates.
- **Business Logic Layer**: Specialized managers (UserManager, SessionManager, etc.) handle domain-specific operations.
- **Database**: MongoDB stores all persistent data (users, sessions, messages, logs).

## Technology Stack
- **Language**: TypeScript (Node.js)
- **Bot Framework**: Telegraf (Telegram bot API wrapper)
- **Database**: MongoDB (with native Node.js driver)
- **Testing**: Jest, MongoDB Memory Server

## Key Features
- **Anonymous Sessions**: Users can chat with counselors without revealing their Telegram profile or identity.
- **Counselor Matching**: Connects users to counselors based on language and domain expertise.
- **Prayer Requests**: A separate flow for users to submit prayer requests which can be viewed and closed by counselors.
- **Reporting & Moderation**: Users and counselors can report inappropriate behavior. The system includes automatic suspension thresholds.
- **Admin Tools**: Broadcast messages, audit logs, statistics, and counselor approval workflows.

---

# Project Structure

The project follows a modular structure to separate concerns between configuration, database interactions, business logic, and bot interactions.

```text
src/
├── components/     # Contains the BotHandler which acts as the entry point for all Telegram interactions.
├── config/         # Environment variable validation and application configuration.
├── database/       # MongoDB connection setup and collection schema initialization.
├── managers/       # Business logic layer (UserManager, CounselorManager, etc.).
├── models/         # (Legacy or Utils) Contains some utility functions like ID generation.
├── types/          # TypeScript interfaces for database documents (User, Session, Counselor, etc.).
└── utils/          # Helper functions, logging utility, and validators.
```

### Directory Purposes:
- **`components/`**: Houses `BotHandler.ts`, a massive controller that registers Telegraf commands, actions, and message listeners, routing them to the appropriate manager.
- **`config/`**: Centralizes the loading of `.env` variables into a strongly typed `Config` class.
- **`database/`**: Manages the MongoDB connection lifecycle and ensures collections and indexes exist upon startup.
- **`managers/`**: Contains classes that handle specific domains:
  - `UserManager`: User registration and state management.
  - `CounselorManager`: Counselor onboarding, approval, and status management.
  - `SessionManager`: Handling active counseling sessions and message routing.
  - `ReportingSystem`: Processing reports and handling strikes/suspensions.
  - `StatisticsManager`: Generating stats for counselors and admins.
  - `BroadcastManager`: Sending messages to subsets of users.
  - `AuditLogManager`: Tracking admin actions.
  - `CleanupManager`: Purging expired data based on retention policies.
- **`types/`**: Defines the shape of the data using TypeScript interfaces, ensuring type safety across the application.
- **`utils/`**: General-purpose utilities like the Winston-based logger (`logger.ts`).
