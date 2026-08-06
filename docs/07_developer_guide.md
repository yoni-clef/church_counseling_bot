# Developer Guide

## Coding Conventions
- **TypeScript**: Use strict typing. Avoid `any` whenever possible. Use interfaces defined in the `src/types` folder for database schemas.
- **Asynchronous Logic**: Use `async/await` exclusively instead of `.then()` promises.
- **Error Handling**: Wrap business logic in `try/catch` blocks within the manager classes. Let `BotHandler` handle user-facing error messages.
- **Dependency Injection**: Pass the MongoDB `Collections` object into Manager constructors rather than initializing separate database connections.

## Recommended Architecture
The project adheres to the **Controller-Service-Repository** pattern:
1. **Controller (`BotHandler`)**: Handles Telegram-specific logic (parsing contexts, routing menus, editing inline keyboards).
2. **Service (`Managers`)**: Handles business logic (matching algorithms, session state, reporting logic).
3. **Repository (`Collections`)**: Defines the data schema and wraps native MongoDB queries.

**Do not bleed Telegram logic into the Managers.** Managers should ideally return standard JavaScript objects or throw errors, which `BotHandler` then translates into Telegram responses.

## How to Add a New Command
1. **Define the Command**: Open `src/components/BotHandler.ts`.
2. **Register the Handler**: In the `registerCommandHandlers` method, add your listener:
   ```typescript
   bot.command('my_new_command', async ctx => {
       if (!ctx.chat) return;
       // Optional: Check permissions (e.g., this.isAdmin(ctx.chat.id))
       await this.handleMyNewCommand(ctx);
   });
   ```
3. **Implement the Logic**: Create the private method `handleMyNewCommand(ctx: Context)` within `BotHandler.ts`. Use the appropriate manager to fetch or modify data.

## How to Add a New Feature
1. **State Definition**: If the feature requires a multi-step conversation, add a new state to the `UserState` type in `src/models/index.ts` (e.g., `WAITING_FOR_FEEDBACK`).
2. **Business Logic**: Create a new manager in `src/managers/` or add methods to an existing manager.
3. **Text Routing**: Update `registerMessageHandlers` in `BotHandler.ts` to capture text messages when the user is in your new state.
4. **UI**: Update the reply keyboards (e.g., `getMainMenuKeyboard`) to include an entry point for your feature.

## How to Add a New Database Model
1. **Interface**: Create a new TypeScript interface in `src/types/` (e.g., `src/types/Feedback.ts`).
2. **Export**: Export the interface in `src/models/index.ts`.
3. **Collections Update**:
   - Open `src/database/Collections.ts`.
   - Add a public property for the new collection (e.g., `public feedback: Collection<Feedback>;`).
   - Initialize it in the constructor.
   - Add index creation logic in `initializeCollections()`.
   - Add the collection name to the array in `ensureCollectionsExist()`.

---

# Future Improvements

This section identifies areas where the application can be enhanced, refactored, or optimized.

## Technical Debt & Refactoring Opportunities
- **`BotHandler.ts` Size**: The `BotHandler.ts` file is currently monolithic, handling all Telegram commands, actions, and text routing. It should be refactored into smaller, modular handlers (e.g., `AdminController`, `CounselorController`, `SessionController`) that are orchestrated by a central router.
- **In-Memory State**: `counselorOnboardingState`, `matchingState`, and `transferState` are currently stored in `Map` objects within memory. If the server restarts, this state is lost. These should be moved to MongoDB or Redis for persistence.

## Missing Features
- **Pagination Caching**: Pagination queries currently hit the database on every page turn. Implementing a caching layer (like Redis) for frequently accessed lists (e.g., prayer requests) would improve performance.
- **Media Support**: The bot currently only proxies text messages. Supporting voice notes, images, or documents during counseling sessions could be beneficial.
- **I18n (Internationalization)**: Hardcoded strings in `BotHandler.ts` should be extracted into language files to easily support users who prefer languages other than English (Amharic, Afaan Oromo, Tigrinya).

## Performance Improvements
- **Webhook Integration**: Replace Telegraf's default long-polling with webhooks for better scalability in production.
- **Index Optimization**: Analyze query patterns in production and ensure all heavily used queries (especially complex matching queries in `SessionManager`) are fully covered by compound indexes.
