import { Telegraf, Context, Markup } from 'telegraf';
import { AppConfig } from '../config/Config';
import { DatabaseManager } from '../database';
import { Collections } from '../database/Collections';
import { UserManager, CounselorManager, SessionManager, ReportingSystem, StatisticsManager, CleanupManager, AuditLogManager } from '../managers';
import { Session } from '../types/Session';
import { UserState } from '../types/User';
import { logger } from '../utils/logger';

// Bot Handler Component - Central message routing and command processing
export class BotHandler {
    private config: AppConfig;
    private bot: Telegraf<Context> | null = null;
    private dbManager: DatabaseManager | null = null;
    private collections: Collections | null = null;
    private userManager: UserManager | null = null;
    private counselorManager: CounselorManager | null = null;
    private sessionManager: SessionManager | null = null;
    private reportingSystem: ReportingSystem | null = null;
    private statisticsManager: StatisticsManager | null = null;
    private cleanupManager: CleanupManager | null = null;
    private auditLogManager: AuditLogManager | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    private static readonly MENU_START_COUNSELING = '💬 Start Counseling';
    private static readonly MENU_SUBMIT_PRAYER = '🙏 Submit Prayer Request';
    private static readonly MENU_HISTORY = '📜 My History';
    private static readonly MENU_HELP = 'ℹ️ Help';
    private static readonly MENU_END_SESSION = '🛑 End Session';
    private static readonly MENU_REPORT = '⚠️ Report';
    private static readonly MENU_MAIN = '🏠 Main Menu';
    private static readonly MENU_REGISTER_COUNSELOR = '🧑‍⚕️ Register as Counselor';
    private static readonly MENU_STATUS_AVAILABLE = '✅ Set Available';
    private static readonly MENU_STATUS_BUSY = '🟡 Set Busy';
    private static readonly MENU_STATUS_AWAY = '⚪ Set Away';
    private static readonly MENU_MY_STATS = '📊 My Stats';
    private static readonly MENU_PRAYER_REQUESTS = '🙏 Prayer Requests';
    private static readonly MENU_CLOSE_PRAYER = '✅ Close Prayer';
    private static readonly MENU_ADMIN_STATS = '🛡️ Admin Stats';
    private static readonly MENU_PENDING_REPORTS = '🚩 Pending Reports';
    private static readonly MENU_PROCESS_REPORT = '⚙️ Process Report';
    private static readonly MENU_APPROVE_COUNSELOR = '✅ Approve Counselor';
    private static readonly MENU_REMOVE_COUNSELOR = '🗑️ Remove Counselor';
    private static readonly MENU_AUDIT_LOG = '📜 Audit Log';
    private static readonly CONSENT_ACTION_PREFIX = 'consent';

    constructor(config: AppConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        logger.setLevel(this.config.logLevel);

        this.dbManager = new DatabaseManager(this.config.mongodbUri, this.config.mongodbDbName);
        this.collections = await this.dbManager.initialize();

        this.userManager = new UserManager(this.collections);
        this.counselorManager = new CounselorManager(this.collections);
        this.sessionManager = new SessionManager(this.collections);
        this.reportingSystem = new ReportingSystem(
            this.collections,
            this.config.reportSuspendThreshold,
            this.config.reportRevokeThreshold
        ); 
        this.statisticsManager = new StatisticsManager(this.collections);
        this.cleanupManager = new CleanupManager(this.collections);
        this.auditLogManager = new AuditLogManager(this.collections);

        this.bot = new Telegraf(this.config.botToken);

        this.bot.catch(async (error: unknown, ctx) => {
            const err = error as Error;
            logger.error('Telegram bot error', { message: err.message, stack: err.stack });
            try {
                await ctx.reply(err.message || 'Sorry, something went wrong. Please try again later.');
            } catch {
                // ignore reply errors
            }
        });

        this.registerCommandHandlers();
        this.registerMessageHandlers();

        await this.bot.launch();

        this.scheduleCleanup();
    }

    async shutdown(): Promise<void> {
        if (this.bot) {
            await this.bot.stop();
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        if (this.dbManager) {
            await this.dbManager.disconnect();
        }
    }

    private registerCommandHandlers(): void {
        if (!this.bot || !this.userManager || !this.counselorManager || !this.sessionManager || !this.reportingSystem || !this.statisticsManager || !this.collections) {
            throw new Error('BotHandler not initialized.');
        }

        const bot = this.bot;

        bot.start(async ctx => {
            if (!ctx.chat) return;

            const userId = await this.userManager!.registerUser(ctx.chat.id);
            await this.userManager!.updateUserState(userId, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', `Welcome! Your anonymous ID is ${userId}. Use the buttons below to get started.`);
        });

        bot.command('help', async ctx => {
            if (!ctx.chat) return;
            await this.sendHelp(ctx);
        });

        bot.hears(BotHandler.MENU_START_COUNSELING, async ctx => {
            if (!ctx.chat) return;
            await this.startCounselingFlow(ctx);
        });

        bot.hears(BotHandler.MENU_SUBMIT_PRAYER, async ctx => {
            if (!ctx.chat) return;
            await this.startPrayerSubmission(ctx);
        });

        bot.hears(BotHandler.MENU_HISTORY, async ctx => {
            if (!ctx.chat) return;
            await this.sendHistory(ctx);
        });

        bot.hears(BotHandler.MENU_HELP, async ctx => {
            if (!ctx.chat) return;
            await this.sendHelp(ctx);
        });

        bot.hears(BotHandler.MENU_END_SESSION, async ctx => {
            if (!ctx.chat) return;
            await this.endSession(ctx);
        });

        bot.hears(BotHandler.MENU_REPORT, async ctx => {
            if (!ctx.chat) return;
            await this.startReport(ctx);
        });

        bot.hears(BotHandler.MENU_MAIN, async ctx => {
            if (!ctx.chat) return;
            await this.resetToMainMenu(ctx);
        });

        bot.hears(BotHandler.MENU_REGISTER_COUNSELOR, async ctx => {
            if (!ctx.chat) return;
            await this.handleRegisterCounselor(ctx);
        });

        bot.hears(BotHandler.MENU_STATUS_AVAILABLE, async ctx => this.updateCounselorStatus(ctx, 'available'));
        bot.hears(BotHandler.MENU_STATUS_BUSY, async ctx => this.updateCounselorStatus(ctx, 'busy'));
        bot.hears(BotHandler.MENU_STATUS_AWAY, async ctx => this.updateCounselorStatus(ctx, 'away'));

        bot.hears(BotHandler.MENU_MY_STATS, async ctx => {
            if (!ctx.chat) return;
            await this.handleMyStats(ctx);
        });

        bot.hears(BotHandler.MENU_PRAYER_REQUESTS, async ctx => {
            if (!ctx.chat) return;
            await this.sendPrayerRequestsToCounselor(ctx);
        });

        bot.hears(BotHandler.MENU_CLOSE_PRAYER, async ctx => {
            if (!ctx.chat) return;
            await this.handleClosePrayer(ctx);
        });

        bot.hears(BotHandler.MENU_ADMIN_STATS, async ctx => {
            if (!ctx.chat) return;
            await this.handleAdminStats(ctx);
        });

        bot.hears(BotHandler.MENU_PENDING_REPORTS, async ctx => {
            if (!ctx.chat) return;
            await this.handlePendingReports(ctx);
        });

        bot.hears(BotHandler.MENU_PROCESS_REPORT, async ctx => {
            if (!ctx.chat) return;
            await this.handleProcessReport(ctx);
        });

        bot.hears(BotHandler.MENU_APPROVE_COUNSELOR, async ctx => {
            if (!ctx.chat) return;
            await this.handleApproveCounselor(ctx);
        });

        bot.hears(BotHandler.MENU_REMOVE_COUNSELOR, async ctx => {
            if (!ctx.chat) return;
            await this.handleRemoveCounselor(ctx);
        });

        bot.hears(BotHandler.MENU_AUDIT_LOG, async ctx => {
            if (!ctx.chat) return;
            await this.handleAuditLog(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.CONSENT_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const userId = (ctx.match as RegExpMatchArray)[1];
            await this.handleConsent(ctx, userId);
        });

        bot.command('list_of_prayer_requests', async ctx => {
            if (!ctx.chat) return;
            await this.sendPrayerRequestsToCounselor(ctx);
        });

        bot.command('close_prayer', async ctx => {
            const prayerId = this.extractCommandText(ctx.message?.text, 'close_prayer');
            await this.handleClosePrayer(ctx, prayerId);
        });

        bot.command('register_counselor', async ctx => {
            if (!ctx.chat) return;
            await this.handleRegisterCounselor(ctx);
        });

        bot.command('available', async ctx => this.updateCounselorStatus(ctx, 'available'));
        bot.command('busy', async ctx => this.updateCounselorStatus(ctx, 'busy'));
        bot.command('away', async ctx => this.updateCounselorStatus(ctx, 'away'));

        bot.command('my_stats', async ctx => {
            if (!ctx.chat) return;
            await this.handleMyStats(ctx);
        });

        bot.command('admin_stats', async ctx => {
            if (!ctx.chat) return;
            await this.handleAdminStats(ctx);
        });

        bot.command('pending_reports', async ctx => {
            if (!ctx.chat) return;
            await this.handlePendingReports(ctx);
        });

        bot.command('process_report', async ctx => {
            if (!ctx.chat) return;
            const args = this.extractCommandText(ctx.message?.text, 'process_report');
            await this.handleProcessReport(ctx, args);
        });

        bot.command('approve_counselor', async ctx => {
            if (!ctx.chat) return;
            const counselorId = this.extractCommandText(ctx.message?.text, 'approve_counselor');
            await this.handleApproveCounselor(ctx, counselorId);
        });

        bot.command('remove_counselor', async ctx => {
            if (!ctx.chat) return;
            const counselorId = this.extractCommandText(ctx.message?.text, 'remove_counselor');
            await this.handleRemoveCounselor(ctx, counselorId);
        });

        bot.command('audit_log', async ctx => {
            if (!ctx.chat) return;
            const limitArg = this.extractCommandText(ctx.message?.text, 'audit_log');
            await this.handleAuditLog(ctx, limitArg);
        });
    }

    private registerMessageHandlers(): void {
        if (!this.bot || !this.sessionManager || !this.collections) {
            throw new Error('BotHandler not initialized.');
        }

        this.bot.on('text', async ctx => {
            if (!ctx.chat || !ctx.message?.text) return;

            if (ctx.message.text.startsWith('/')) {
                return;
            }

            if (this.isMenuText(ctx.message.text)) {
                return;
            }

            const userState = await this.userManager!.getUserStateByTelegramId(ctx.chat.id);

            if (userState === 'SUBMITTING_PRAYER') {
                await this.handlePrayerTitle(ctx, ctx.message.text);
                return;
            }

            if (userState === 'REPORTING') {
                await this.handleReportReason(ctx, ctx.message.text);
                return;
            }

            const counselor = await this.collections!.counselors.findOne({ telegramChatId: ctx.chat.id });
            const isCounselor = !!counselor && counselor.isApproved && !counselor.isSuspended;

            if (isCounselor) {
                const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
                const activeSession = requesterType === 'user'
                    ? await this.sessionManager!.getActiveSessionForUser(requesterId)
                    : await this.sessionManager!.getActiveSessionForCounselor(requesterId);

                if (!activeSession) {
                    await ctx.reply('No active session found.');
                    return;
                }

                const routed = await this.sessionManager!.routeMessage(
                    activeSession.sessionId,
                    requesterId,
                    requesterType,
                    ctx.message.text
                );

                const recipientChatId = await this.resolveChatId(routed.recipientId, routed.recipientType);
                if (recipientChatId) {
                    await this.bot!.telegram.sendMessage(recipientChatId, routed.message.content);
                }

                return;
            }

            if (userState === 'IN_SESSION') {
                const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
                const activeSession = await this.sessionManager!.getActiveSessionForUser(requesterId);

                if (!activeSession) {
                    await this.resetToMainMenu(ctx, 'No active session found.');
                    return;
                }

                const routed = await this.sessionManager!.routeMessage(
                    activeSession.sessionId,
                    requesterId,
                    requesterType,
                    ctx.message.text
                );

                const recipientChatId = await this.resolveChatId(routed.recipientId, routed.recipientType);
                if (recipientChatId) {
                    await this.bot!.telegram.sendMessage(recipientChatId, routed.message.content);
                }

                return;
            }

            const userId = await this.userManager!.registerUser(ctx.chat.id);
            const activeSession = await this.sessionManager!.getActiveSessionForUser(userId);
            if (activeSession) {
                await this.userManager!.updateUserState(userId, 'IN_SESSION');
                const routed = await this.sessionManager!.routeMessage(
                    activeSession.sessionId,
                    userId,
                    'user',
                    ctx.message.text
                );

                const recipientChatId = await this.resolveChatId(routed.recipientId, routed.recipientType);
                if (recipientChatId) {
                    await this.bot!.telegram.sendMessage(recipientChatId, routed.message.content);
                }

                return;
            }

            await this.resetToMainMenu(ctx, 'Use the menu buttons below to continue.');
        });
    }

    private async startCounselingFlow(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.sessionManager) return;

        const userId = await this.userManager.registerUser(ctx.chat.id);
        const activeSession = await this.sessionManager.getActiveSessionForUser(userId);
        if (activeSession) {
            await this.userManager.updateUserState(userId, 'IN_SESSION');
            await this.replyWithMenu(ctx, 'IN_SESSION', 'You already have an active session.');
            return;
        }

        await this.userManager.updateUserState(userId, 'WAITING_COUNSELOR');
        await ctx.reply(this.sessionManager.getConsentDisclosureText());
        await ctx.reply(
            'Tap the button below to provide consent and start your session.',
            Markup.inlineKeyboard([
                Markup.button.callback('✅ I Consent', `${BotHandler.CONSENT_ACTION_PREFIX}:${userId}`)
            ])
        );
        await this.replyWithMenu(ctx, 'WAITING_COUNSELOR', 'You can return to the main menu at any time.');
    }

    private async handleConsent(ctx: Context, userId: string): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.counselorManager || !this.sessionManager || !this.collections || !this.bot) return;

        try {
            const user = await this.userManager.getUserByTelegramId(ctx.chat.id);
            if (!user || user.uuid !== userId) {
                await ctx.reply('Unable to confirm consent for this account.');
                return;
            }

            if (user.state !== 'WAITING_COUNSELOR') {
                await ctx.reply('No pending consent request. Use Start Counseling to begin.');
                return;
            }

            const maxAttempts = 3;
            let counselorId: string | null = null;
            let counselor: { telegramChatId: number } | null = null;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const candidateId = await this.counselorManager.getAvailableCounselor();
                if (!candidateId) {
                    break;
                }

                const candidate = await this.collections.counselors.findOne({ id: candidateId });
                if (!candidate || candidate.telegramChatId === ctx.chat.id) {
                    continue;
                }

                const activeSession = await this.sessionManager.getActiveSessionForCounselor(candidateId);
                if (activeSession) {
                    await this.collections.counselors.updateOne(
                        { id: candidateId },
                        { $set: { status: 'busy', lastActive: new Date() } }
                    );
                    continue;
                }

                counselorId = candidateId;
                counselor = candidate;
                break;
            }

            if (!counselorId || !counselor) {
                await this.replyWithMenu(ctx, 'WAITING_COUNSELOR', 'No counselors are available right now. Please try again later.');
                return;
            }

            let session: Session;
            try {
                session = await this.sessionManager.createSession(user.uuid, counselorId, true);
            } catch (error) {
                const err = error as Error;
                if (err.message.includes('Counselor already has an active session')) {
                    await this.collections.counselors.updateOne(
                        { id: counselorId },
                        { $set: { status: 'busy', lastActive: new Date() } }
                    );
                    await this.replyWithMenu(ctx, 'WAITING_COUNSELOR', 'No counselors are available right now. Please try again later.');
                    return;
                }
                throw error;
            }
            await this.userManager.updateUserState(user.uuid, 'IN_SESSION');

            await this.bot.telegram.sendMessage(
                counselor.telegramChatId,
                `New session started. User ID: ${session.userId}. Use normal chat to reply.`
            );

            await this.replyWithMenu(ctx, 'IN_SESSION', `Session started. Your counselor has been notified. Session ID: ${session.sessionId}`);
        } catch (error) {
            const err = error as Error;
            await ctx.reply(err.message || 'Unable to start session right now. Please try again later.');
        }
    }

    private async endSession(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager) return;

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        const session = requesterType === 'user'
            ? await this.sessionManager.getActiveSessionForUser(requesterId)
            : await this.sessionManager.getActiveSessionForCounselor(requesterId);

        if (!session) {
            await this.replyWithMenu(ctx, 'IDLE', 'No active session to end.');
            return;
        }

        await this.sessionManager.endSession(session.sessionId);

        if (requesterType === 'user') {
            await this.userManager.updateUserState(requesterId, 'POST_SESSION');
            await this.replyWithMenu(ctx, 'POST_SESSION', 'Session ended. Thank you. You can report the counselor from the menu below if needed.');
            const counselorChatId = await this.resolveChatId(session.counselorId, 'counselor');
            if (counselorChatId) {
                await this.bot!.telegram.sendMessage(counselorChatId, 'Session has ended. The user ended the session.');
            }
        } else {
            await ctx.reply('Session ended.');
            const userChatId = await this.resolveChatId(session.userId, 'user');
            if (userChatId) {
                await this.sendMenuToChatId(
                    userChatId,
                    'POST_SESSION',
                    'Your session has ended. Thank you. You can report the counselor from the menu below if needed.'
                );
            }
            await this.userManager.updateUserState(session.userId, 'POST_SESSION');
        }
    }

    private async startPrayerSubmission(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'SUBMITTING_PRAYER');
        await this.replyWithMenu(ctx, 'SUBMITTING_PRAYER', 'Please enter your prayer title/topic.');
    }

    private async handlePrayerTitle(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        const title = text.trim();
        if (!title) {
            await this.replyWithMenu(ctx, 'SUBMITTING_PRAYER', 'Please enter your prayer title/topic.');
            return;
        }

        const userId = await this.userManager.registerUser(ctx.chat.id);
        await this.userManager.submitPrayerRequest(userId, title);
        await this.userManager.updateUserState(userId, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', 'Your prayer request has been received. Counselors will pray for it.');
    }

    private async sendHistory(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager) return;

        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'VIEWING_HISTORY');
        const session = await this.findRecentSessionByChat(ctx.chat.id);
        if (!session) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'No session history available.');
            return;
        }

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        const messages = await this.sessionManager.getMessageHistory(session.sessionId, requesterId, requesterType, 20);

        if (messages.length === 0) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'No messages in session history.');
            return;
        }

        const formatted = messages.map(msg => {
            const senderLabel = msg.senderType === 'user' ? 'User' : 'Counselor';
            return `[${msg.timestamp.toISOString()}] ${senderLabel}: ${msg.content}`;
        });

        await ctx.reply(formatted.join('\n'));
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', 'Here is your recent history.');
    }

    private async startReport(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.sessionManager) return;

        const userId = await this.userManager.registerUser(ctx.chat.id);
        const activeSession = await this.sessionManager.getActiveSessionForUser(userId);
        if (activeSession) {
            await this.userManager.updateUserState(userId, 'IN_SESSION');
            await this.replyWithMenu(ctx, 'IN_SESSION', 'Please end your session before reporting.');
            return;
        }

        const user = await this.userManager.getUserByTelegramId(ctx.chat.id);
        if (user?.state !== 'POST_SESSION') {
            await this.replyWithMenu(ctx, 'IDLE', 'Report is available after a session ends.');
            return;
        }

        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'REPORTING');
        await this.replyWithMenu(ctx, 'REPORTING', 'Please provide a reason for the report.');
    }

    private async handleReportReason(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat || !this.reportingSystem || !this.sessionManager || !this.userManager) return;

        const reason = text.trim();
        if (!reason) {
            await this.replyWithMenu(ctx, 'REPORTING', 'Please provide a reason for the report.');
            return;
        }

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        if (requesterType !== 'user') {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'Only users can submit reports.');
            return;
        }

        let session = await this.sessionManager.getActiveSessionForUser(requesterId);
        if (!session) {
            session = await this.findRecentSessionByChat(ctx.chat.id);
        }

        if (!session || session.userId !== requesterId) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'No recent session found to report.');
            return;
        }

        const report = await this.reportingSystem.submitReport(session.sessionId, session.counselorId, reason);
        const counselorChatId = await this.resolveChatId(session.counselorId, 'counselor');
        if (counselorChatId) {
            await this.bot!.telegram.sendMessage(
                counselorChatId,
                [
                    '⚠️ Report Submitted',
                    'A user has submitted a report about your session.',
                    `Report ID: ${report.reportId}`,
                    `Reason: ${reason}`
                ].join('\n')
            );
        }
        const stillActive = await this.sessionManager.getActiveSessionForUser(requesterId);
        const nextState: UserState = stillActive ? 'IN_SESSION' : 'IDLE';
        await this.userManager.updateUserState(requesterId, nextState);
        await this.replyWithMenu(ctx, nextState, `Report submitted. Reference: ${report.reportId}`);
    }

    private async handleRegisterCounselor(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections || !this.counselorManager) return;

        const existing = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (existing) {
            await ctx.reply(`You are already registered. Counselor ID: ${existing.id}. Await admin approval.`);
            return;
        }

        const counselorId = await this.counselorManager.createCounselor(ctx.chat.id);
        await ctx.reply(`Counselor registration created. Your counselor ID is ${counselorId}. Await admin approval.`);
    }

    private async handleMyStats(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections || !this.statisticsManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isApproved || counselor.isSuspended) {
            await ctx.reply('You are not approved to access counselor stats.');
            return;
        }

        const stats = await this.statisticsManager.getCounselorStats(counselor.id);
        await ctx.reply(
            `Sessions completed: ${stats.totalSessionsCompleted}\nActive sessions: ${stats.activeSessions}\nAverage duration: ${stats.averageSessionDuration} minutes\nPeak hours: ${stats.peakUsageHours.join(', ') || 'N/A'}`
        );
    }

    private async handleAdminStats(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.statisticsManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized admin_stats access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to access admin stats.');
            return;
        }

        const stats = await this.statisticsManager.getAdminStats();
        await ctx.reply(
            `Total sessions completed: ${stats.totalSessionsCompleted}\nActive sessions: ${stats.activeSessions}\nAverage duration: ${stats.averageSessionDuration} minutes\nPrayer requests: ${stats.totalPrayerRequests}\nPeak hours: ${stats.peakUsageHours.join(', ') || 'N/A'}`
        );
    }

    private async handlePendingReports(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.reportingSystem) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized pending_reports access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view reports.');
            return;
        }

        const reports = await this.reportingSystem.getPendingReports();
        if (reports.length === 0) {
            await ctx.reply('No pending reports.');
            return;
        }

        const formatted = reports.map(report => {
            const submittedAt = report.timestamp instanceof Date
                ? report.timestamp.toISOString()
                : new Date(report.timestamp).toISOString();
            return [
                '🚩 Pending Report',
                `Report ID: ${report.reportId}`,
                `Counselor ID: ${report.counselorId}`,
                `Reason: ${report.reason}`,
                `Submitted: ${submittedAt}`
            ].join('\n');
        });

        await ctx.reply(`Pending reports (${reports.length}):`);
        const chunkSize = 10;
        for (let i = 0; i < formatted.length; i += chunkSize) {
            await ctx.reply(formatted.slice(i, i + chunkSize).join('\n\n'));
        }
    }

    private async handleProcessReport(ctx: Context, args?: string): Promise<void> {
        if (!ctx.chat || !this.reportingSystem || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized process_report access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to process reports.');
            return;
        }

        if (!args) {
            await ctx.reply('Usage: /process_report <reportId> <strike|dismiss>');
            return;
        }

        const [reportId, action] = args.split(' ');
        if (!reportId || (action !== 'strike' && action !== 'dismiss')) {
            await ctx.reply('Usage: /process_report <reportId> <strike|dismiss>');
            return;
        }

        const report = await this.reportingSystem.processReport(reportId, ctx.chat.id.toString(), action);
        await this.auditLogManager.recordAdminAction(
            ctx.chat.id.toString(),
            'process_report',
            reportId,
            { action, counselorId: report.counselorId }
        );
        await ctx.reply(`Report ${report.reportId} processed. Action: ${action}.`);
    }

    private async handleApproveCounselor(ctx: Context, counselorId?: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.counselorManager || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized approve_counselor access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to approve counselors.');
            return;
        }

        if (!counselorId) {
            const pending = await this.collections.counselors
                .find({ isApproved: false })
                .sort({ createdAt: -1 })
                .toArray();

            if (pending.length === 0) {
                await ctx.reply('No counselors awaiting approval.');
                return;
            }

            const formatted = pending.map(counselor => {
                return `ID: ${counselor.id} | Status: ${counselor.status} | Strikes: ${counselor.strikes}`;
            });

            await ctx.reply('Pending counselor approvals (ID | Status | Strikes):');
            const chunkSize = 25;
            for (let i = 0; i < formatted.length; i += chunkSize) {
                await ctx.reply(formatted.slice(i, i + chunkSize).join('\n'));
            }

            await ctx.reply('Usage: /approve_counselor <counselorId>');
            return;
        }

        await this.counselorManager.approveCounselor(ctx.chat.id.toString(), counselorId);
        await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'approve_counselor', counselorId);
        await ctx.reply(`Counselor ${counselorId} approved.`);

        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (counselor?.telegramChatId) {
            try {
                await this.bot!.telegram.sendMessage(
                    counselor.telegramChatId,
                    'Your counseling request has been approved. You can now set your status and receive sessions.'
                );
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to notify counselor approval', {
                    counselorId,
                    message: err.message
                });
            }
        }
    }

    private async handleRemoveCounselor(ctx: Context, counselorId?: string): Promise<void> {
        if (!ctx.chat || !this.counselorManager || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized remove_counselor access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to remove counselors.');
            return;
        }

        if (!counselorId) {
            const counselors = await this.counselorManager.listCounselors();
            if (counselors.length === 0) {
                await ctx.reply('No counselors found.');
                return;
            }

            const formatted = counselors.map(counselor => {
                return `ID: ${counselor.counselorId} | Strikes: ${counselor.strikes} | Status: ${counselor.status}`;
            });

            await ctx.reply('Counselor list (ID | Strikes | Status):');
            const chunkSize = 25;
            for (let i = 0; i < formatted.length; i += chunkSize) {
                await ctx.reply(formatted.slice(i, i + chunkSize).join('\n'));
            }

            await ctx.reply('Usage: /remove_counselor <counselorId>');
            return;
        }

        await this.counselorManager.removeCounselor(ctx.chat.id.toString(), counselorId);
        await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'remove_counselor', counselorId);
        await ctx.reply(`Counselor ${counselorId} removed.`);
    }

    private async handleAuditLog(ctx: Context, limitArg?: string): Promise<void> {
        if (!ctx.chat || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized audit_log access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view audit logs.');
            return;
        }

        const limit = limitArg ? Math.min(Math.max(parseInt(limitArg, 10) || 20, 1), 100) : 20;

        const logs = await this.auditLogManager.getRecentAdminActions(limit);
        if (logs.length === 0) {
            await ctx.reply('No audit log entries found.');
            return;
        }

        const formatted = logs.map(log => {
            const target = log.targetId ? ` | target ${log.targetId}` : '';
            return `${log.timestamp.toISOString()} | ${log.action}${target} | admin ${log.adminId}`;
        });

        await ctx.reply(formatted.join('\n'));
    }

    private async handleClosePrayer(ctx: Context, prayerId?: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.userManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isApproved || counselor.isSuspended) {
            await ctx.reply('You are not approved to close prayer requests.');
            return;
        }

        if (!prayerId) {
            await ctx.reply('Select a prayer request to close:');
            await this.sendPrayerRequestsToCounselor(ctx);
            await ctx.reply('Use /close_prayer <prayerId> to close one.');
            return;
        }

        try {
            const result = await this.userManager.closePrayerRequest(prayerId);
            if (!result.closed) {
                await ctx.reply('Prayer request already closed.');
                return;
            }

            await ctx.reply(`Prayer request ${prayerId} closed.`);

            const userChatId = await this.resolveChatId(result.prayer.userId, 'user');
            if (!userChatId) {
                logger.warn('Unable to notify prayer request submitter (missing chat ID)', { prayerId });
                return;
            }

            try {
                const submittedAt = result.prayer.createdAt.toISOString();
                const message = [
                    '🙏 Prayer Update',
                    'Your prayer request has been prayed for by a counselor.',
                    `Title: ${result.prayer.title}`,
                    `Submitted: ${submittedAt}`
                ].join('\n');

                await this.bot!.telegram.sendMessage(userChatId, message);
            } catch (notifyError) {
                const err = notifyError as Error;
                logger.warn('Failed to notify prayer request submitter', {
                    prayerId,
                    message: err.message
                });
            }
        } catch (error) {
            await ctx.reply((error as Error).message || 'Unable to close prayer request.');
        }
    }

    private async resetToMainMenu(ctx: Context, message = 'Main menu:'): Promise<void> {
        if (!ctx.chat || !this.userManager) return;

        const userId = await this.userManager.registerUser(ctx.chat.id);
        const activeSession = this.sessionManager
            ? await this.sessionManager.getActiveSessionForUser(userId)
            : null;

        if (activeSession) {
            await this.userManager.updateUserState(userId, 'IN_SESSION');
            await this.replyWithMenu(ctx, 'IN_SESSION', 'You have an active session. Use End Session to finish.');
            return;
        }

        await this.userManager.updateUserState(userId, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', message);
    }

    private async sendHelp(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections) return;

        const isAdmin = this.isAdmin(ctx.chat.id);
        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        const isCounselor = !!counselor && counselor.isApproved && !counselor.isSuspended;

        if (!isAdmin && !isCounselor) {
            await this.replyWithMenu(
                ctx,
                'IDLE',
                'Use the menu buttons to start counseling, submit a prayer request, view history, or get help.'
            );
            return;
        }

        const counselorCommands = [
            '/register_counselor - Register as counselor (requires admin approval)',
            '/available | /busy | /away - Set counselor availability',
            '/my_stats - View counselor statistics',
            '/list_of_prayer_requests - View prayer requests',
            '/close_prayer <prayerId> - Close a prayer request'
        ];

        const adminCommands = [
            '/admin_stats - View system statistics (admins)',
            '/pending_reports - List pending reports (admins)',
            '/process_report <reportId> <strike|dismiss> - Process report (admins)',
            '/approve_counselor <counselorId> - Approve counselor (admins)',
            '/remove_counselor <counselorId> - Remove counselor (admins)',
            '/audit_log [limit] - View admin audit log (admins)'
        ];

        const commands = isAdmin
            ? [...counselorCommands, ...adminCommands]
            : counselorCommands;

        await ctx.reply(['Commands:', ...commands].join('\n'));
    }

    private async updateCounselorStatus(ctx: Context, status: 'available' | 'busy' | 'away'): Promise<void> {
        if (!ctx.chat || !this.collections || !this.counselorManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor) {
            await ctx.reply('You are not registered as a counselor. Use /register_counselor first.');
            return;
        }

        if (!counselor.isApproved || counselor.isSuspended) {
            logger.warn('Unauthorized counselor status update', { chatId: ctx.chat.id, counselorId: counselor.id });
            await ctx.reply('You are not approved to change status.');
            return;
        }

        await this.counselorManager.setAvailability(counselor.id, status, ctx.chat.id.toString());
        await ctx.reply(`Status updated to ${status}.`);
    }

    private async sendPrayerRequestsToCounselor(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections || !this.userManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isApproved || counselor.isSuspended) {
            await ctx.reply('You are not approved to view prayer requests.');
            return;
        }

        const prayers = await this.userManager.getPrayerRequestsForCounselors();
        if (prayers.length === 0) {
            await ctx.reply('No prayer requests available.');
            return;
        }

        const formatted = prayers.map(prayer => {
            const submittedAt = prayer.createdAt.toISOString();
            return [
                '🙏 Prayer Request',
                `Title: ${prayer.title}`,
                `ID: ${prayer.prayerId}`,
                `Submitted: ${submittedAt}`
            ].join('\n');
        });

        await ctx.reply(`Prayer requests (${prayers.length}):`);

        const chunkSize = 25;
        for (let i = 0; i < formatted.length; i += chunkSize) {
            await ctx.reply(formatted.slice(i, i + chunkSize).join('\n'));
        }
    }

    private async resolveRequester(chatId: number): Promise<{ requesterId: string; requesterType: 'user' | 'counselor' }> {
        if (!this.collections || !this.userManager) {
            throw new Error('BotHandler not initialized.');
        }

        const counselor = await this.collections.counselors.findOne({ telegramChatId: chatId });
        if (counselor && counselor.isApproved && !counselor.isSuspended) {
            return { requesterId: counselor.id, requesterType: 'counselor' };
        }

        const userId = await this.userManager.registerUser(chatId);
        return { requesterId: userId, requesterType: 'user' };
    }

    private async resolveChatId(recipientId: string, recipientType: 'user' | 'counselor'): Promise<number | null> {
        if (!this.collections) {
            throw new Error('BotHandler not initialized.');
        }

        if (recipientType === 'user') {
            const user = await this.collections.users.findOne({ uuid: recipientId });
            return user?.telegramChatId ?? null;
        }

        const counselor = await this.collections.counselors.findOne({ id: recipientId });
        return counselor?.telegramChatId ?? null;
    }

    private async findActiveSessionByChat(chatId: number): Promise<Session | null> {
        if (!this.sessionManager) {
            throw new Error('BotHandler not initialized.');
        }

        const { requesterId, requesterType } = await this.resolveRequester(chatId);
        return requesterType === 'user'
            ? this.sessionManager.getActiveSessionForUser(requesterId)
            : this.sessionManager.getActiveSessionForCounselor(requesterId);
    }

    private async findRecentSessionByChat(chatId: number): Promise<Session | null> {
        if (!this.collections) {
            throw new Error('BotHandler not initialized.');
        }

        const counselor = await this.collections.counselors.findOne({ telegramChatId: chatId });
        if (counselor) {
            return this.collections.sessions
                .find({ counselorId: counselor.id })
                .sort({ startTime: -1 })
                .limit(1)
                .next();
        }

        const user = await this.collections.users.findOne({ telegramChatId: chatId });
        if (!user) {
            return null;
        }

        return this.collections.sessions
            .find({ userId: user.uuid })
            .sort({ startTime: -1 })
            .limit(1)
            .next();
    }

    private extractCommandText(text: string | undefined, command: string): string {
        if (!text) return '';
        const trimmed = text.replace(`/${command}`, '').trim();
        return trimmed;
    }

    private buildMenu(state: UserState, role: 'user' | 'counselor' | 'admin') {
        const baseRows = state === 'IN_SESSION'
            ? this.getSessionMenuRows()
            : state === 'REPORTING' || state === 'POST_SESSION'
                ? this.getPostSessionMenuRows()
                : this.getMainMenuRows();

        const roleRows = this.getRoleMenuRows(role);

        return Markup.keyboard([
            ...baseRows,
            ...roleRows
        ]).resize().persistent();
    }

    private getMainMenuRows(): string[][] {
        return [
            [BotHandler.MENU_START_COUNSELING],
            [BotHandler.MENU_SUBMIT_PRAYER],
            [BotHandler.MENU_HISTORY, BotHandler.MENU_HELP],
            [BotHandler.MENU_MAIN]
        ];
    }

    private getSessionMenuRows(): string[][] {
        return [
            [BotHandler.MENU_END_SESSION],
            [BotHandler.MENU_MAIN]
        ];
    }

    private getPostSessionMenuRows(): string[][] {
        return [
            [BotHandler.MENU_REPORT],
            [BotHandler.MENU_MAIN]
        ];
    }

    private getRoleMenuRows(role: 'user' | 'counselor' | 'admin'): string[][] {
        const counselorRows = [
            [BotHandler.MENU_REGISTER_COUNSELOR],
            [BotHandler.MENU_STATUS_AVAILABLE, BotHandler.MENU_STATUS_BUSY, BotHandler.MENU_STATUS_AWAY],
            [BotHandler.MENU_MY_STATS],
            [BotHandler.MENU_PRAYER_REQUESTS],
            [BotHandler.MENU_CLOSE_PRAYER]
        ];

        const adminRows = [
            [BotHandler.MENU_ADMIN_STATS],
            [BotHandler.MENU_PENDING_REPORTS],
            [BotHandler.MENU_PROCESS_REPORT],
            [BotHandler.MENU_APPROVE_COUNSELOR],
            [BotHandler.MENU_REMOVE_COUNSELOR],
            [BotHandler.MENU_AUDIT_LOG]
        ];

        if (role === 'admin') {
            return [...counselorRows, ...adminRows];
        }

        if (role === 'counselor') {
            return counselorRows;
        }

        return [[BotHandler.MENU_REGISTER_COUNSELOR]];
    }

    private async getMenuRole(chatId: number): Promise<'user' | 'counselor' | 'admin'> {
        if (this.isAdmin(chatId)) {
            return 'admin';
        }

        if (!this.collections) {
            return 'user';
        }

        const counselor = await this.collections.counselors.findOne({ telegramChatId: chatId });
        if (counselor && counselor.isApproved && !counselor.isSuspended) {
            return 'counselor';
        }

        return 'user';
    }

    private async replyWithMenu(ctx: Context, state: UserState, message: string): Promise<void> {
        if (!ctx.chat) return;
        const role = await this.getMenuRole(ctx.chat.id);
        await ctx.reply(message, this.buildMenu(state, role));
    }

    private async sendMenuToChatId(chatId: number, state: UserState, message: string): Promise<void> {
        if (!this.bot) return;
        const role = await this.getMenuRole(chatId);
        await this.bot.telegram.sendMessage(chatId, message, this.buildMenu(state, role));
    }

    private isMenuText(text: string): boolean {
        return text === BotHandler.MENU_START_COUNSELING
            || text === BotHandler.MENU_SUBMIT_PRAYER
            || text === BotHandler.MENU_HISTORY
            || text === BotHandler.MENU_HELP
            || text === BotHandler.MENU_END_SESSION
            || text === BotHandler.MENU_REPORT
            || text === BotHandler.MENU_MAIN
            || text === BotHandler.MENU_REGISTER_COUNSELOR
            || text === BotHandler.MENU_STATUS_AVAILABLE
            || text === BotHandler.MENU_STATUS_BUSY
            || text === BotHandler.MENU_STATUS_AWAY
            || text === BotHandler.MENU_MY_STATS
            || text === BotHandler.MENU_PRAYER_REQUESTS
            || text === BotHandler.MENU_CLOSE_PRAYER
            || text === BotHandler.MENU_ADMIN_STATS
            || text === BotHandler.MENU_PENDING_REPORTS
            || text === BotHandler.MENU_PROCESS_REPORT
            || text === BotHandler.MENU_APPROVE_COUNSELOR
            || text === BotHandler.MENU_REMOVE_COUNSELOR
            || text === BotHandler.MENU_AUDIT_LOG;
    }

    private isAdmin(chatId: number): boolean {
        return this.config.adminChatIds.includes(chatId);
    }

    private scheduleCleanup(): void {
        if (!this.cleanupManager) {
            return;
        }

        const intervalMs = this.config.cleanupIntervalHours * 60 * 60 * 1000;

        const runCleanup = async () => {
            try {
                await this.cleanupManager!.cleanupOldSessions(this.config.sessionRetentionDays);
            } catch (error) {
                console.error('Cleanup failed:', error);
            }
        };

        void runCleanup();
        this.cleanupInterval = setInterval(runCleanup, intervalMs);
    }
}