# Telegram Bot Documentation

## Bot Architecture
The bot uses the [Telegraf](https://telegraf.js.org/) library to interface with the Telegram API. The architecture centers around `BotHandler.ts`, which captures all incoming updates (messages, commands, inline query callbacks) and directs them to specific manager classes based on the user's state.

## User Flow
1. **First Interaction (`/start`)**: Users receive an anonymous UUID and are presented with the main menu keyboard. Their state is initialized to `IDLE`.
2. **Counseling Request**: The user clicks "Start chatting with counselor". They undergo a language and domain matching sequence via inline keyboards.
3. **In-Session**: The bot acts as a proxy. A message from the user is formatted and forwarded to the assigned counselor, and vice versa. Identities are completely masked.
4. **End Session**: Users or counselors can terminate the session via the "End Session" menu option.

## Counselor Flow
1. **Registration**: A user triggers the registration command (`/register_counselor` or via the menu).
2. **Onboarding**: They submit their full name, Telegram username, supported languages, expertise domains, experience, and location.
3. **Approval**: An admin receives the request and approves them.
4. **Status Management**: The counselor sets their state to `available`.
5. **Handling Requests**: When a match occurs, they are prompted to accept. During a session, all messages from the user appear in the counselor's chat.

## Admin Flow
Admins (defined in `ADMIN_CHAT_IDS`) bypass standard state checks to access advanced commands.
- They receive notifications when a counselor applies.
- They receive notifications for reports and appeals.
- They can view system statistics, manage counselors (approve, revoke), and trigger system-wide broadcasts.

## Command Handlers
The bot supports standard Telegram commands mapped within `BotHandler.ts`:
- `/start` - Register the user and show the main menu.
- `/help` - Show instructions based on role.
- `/register_counselor` - Begin counselor onboarding.
- `/available` & `/away` - Toggle counselor availability.
- `/my_stats` - (Counselor) View session statistics.
- `/admin_stats` - (Admin) View system-wide metrics.
- `/pending_reports` - (Admin) View unhandled reports.
- `/process_report` - (Admin) Act on a report.
- `/list_of_prayer_requests` - (Counselor) View prayer queue.

## Reply Keyboards (Custom Keyboards)
Reply keyboards replace the standard keyboard with persistent menu buttons based on the user's state.
- **Main Menu**: `💬 Start chatting`, `🙏 Submit Prayer Request`, `📜 My History`, `⚠️ Report`, `🧑‍⚕️ Register as Counselor`.
- **In-Session Menu**: `🛑 End Session`, `⚠️ Report`.
- **Counselor Menu**: Additions include `✅ Set Available`, `⚪ Set Away`, `🙏 Prayer Requests`, `📊 My Stats`.
- **Admin Menu**: Additions include `🛡️ Admin Stats`, `🚩 Pending Reports`, `🧑‍⚕️ Counselors List`, `📢 Broadcast Message`.

## Inline Keyboards & Callback Handlers
Inline keyboards are attached to specific messages for dynamic interactions.
- **Action Callbacks**: Used for selections like matching language (`match_lang:English`), matching domain (`match_dom:Anxiety`), and pagination.
- **Counselor Actions**: Accepting/declining transfers (`transfer_accept:<sessionId>`), closing prayers (`close_prayer:<prayerId>`).
- **Admin Actions**: Approving counselors (`approve_counselor:<counselorId>`), processing reports (`pr:<reportId>:s` for strike).

## Conversation / State Management
The bot utilizes a state machine persisted in the `User` document in MongoDB. The `state` property determines how text messages are handled:
- `IDLE`: Normal menu browsing.
- `SUBMITTING_PRAYER`: Next text message is saved as a prayer title.
- `MATCHING`: User is answering matching questions.
- `WAITING_COUNSELOR`: Waiting for a counselor to accept.
- `IN_SESSION`: All text is forwarded to the counselor.
- `REPORTING`: User is providing a reason for a report.
- `BROADCASTING`: Admin is drafting a broadcast message.

By validating `ctx.chat.id` against the saved database state, `BotHandler.ts` safely routes multi-step conversations asynchronously without relying on in-memory sessions that would be lost during a restart.
