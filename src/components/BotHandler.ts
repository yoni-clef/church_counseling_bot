import { Telegraf, Context } from 'telegraf';
import { AppConfig } from '../config/Config';
import { DatabaseManager } from '../database';
import { Collections } from '../database/Collections';
import { UserManager, CounselorManager, SessionManager, ReportingSystem, StatisticsManager, CleanupManager, AuditLogManager } from '../managers';
import { Session } from '../types/Session';
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
    private pendingConsentUserIds: Set<string> = new Set();
    private pendingPrayerChatIds: Set<number> = new Set();
    private cleanupInterval: NodeJS.Timeout | null = null;

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
                await ctx.reply('Sorry, something went wrong. Please try again later.');
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
            await ctx.reply(
                `Welcome! Your anonymous ID is ${userId}. Use /start_session to request a counselor or /request_prayer <title> for prayer support. Type /help for a list of commands.`
            );
        });

        bot.command('help', async ctx => {
            if (!ctx.chat || !this.collections) return;

            const isAdmin = this.isAdmin(ctx.chat.id);
            const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
            const isCounselor = !!counselor && counselor.isApproved && !counselor.isSuspended;

            const userCommands = [
                '/start_session - Request a counseling session',
                '/consent - Accept consent and begin session',
                '/end_session - End your active session',
                '/request_prayer <title> - Submit a prayer request',
                '/history [limit] - View recent session messages',
                '/report <reason> - Report a counselor after a session'
            ];

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
                ? [...userCommands, ...counselorCommands, ...adminCommands]
                : isCounselor
                    ? [...userCommands, ...counselorCommands]
                    : userCommands;

            await ctx.reply(['Commands:', ...commands].join('\n'));
        });

        bot.command('start_session', async ctx => {
            if (!ctx.chat) return;

            const userId = await this.userManager!.registerUser(ctx.chat.id);
            this.pendingConsentUserIds.add(userId);
            await ctx.reply(this.sessionManager!.getConsentDisclosureText());
            await ctx.reply('Reply with /consent to begin your session.');
        });

        bot.command('consent', async ctx => {
            if (!ctx.chat) return;

            const user = await this.userManager!.getUserByTelegramId(ctx.chat.id);
            if (!user) {
                await ctx.reply('Please use /start first.');
                return;
            }

            if (!this.pendingConsentUserIds.has(user.uuid)) {
                await ctx.reply('No pending consent request. Use /start_session first.');
                return;
            }

            const counselorId = await this.counselorManager!.getAvailableCounselor();
            if (!counselorId) {
                await ctx.reply('No counselors are available right now. Please try again later.');
                return;
            }

            const session = await this.sessionManager!.createSession(user.uuid, counselorId, true);
            this.pendingConsentUserIds.delete(user.uuid);

            const counselor = await this.collections!.counselors.findOne({ id: counselorId });
            if (counselor) {
                await this.bot!.telegram.sendMessage(
                    counselor.telegramChatId,
                    `New session started. User ID: ${session.userId}. Use normal chat to reply.`
                );
            }

            await ctx.reply(`Session started. Your counselor has been notified. Session ID: ${session.sessionId}`);
        });

        bot.command('end_session', async ctx => {
            if (!ctx.chat) return;

            const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
            const session = requesterType === 'user'
                ? await this.sessionManager!.getActiveSessionForUser(requesterId)
                : await this.sessionManager!.getActiveSessionForCounselor(requesterId);

            if (!session) {
                await ctx.reply('No active session to end.');
                return;
            }

            await this.sessionManager!.endSession(session.sessionId);

            if (requesterType === 'user') {
                await ctx.reply('Session ended. Thank you. If the conversation was inappropriate, report the counselor now with /report <reason>.');
                const counselorChatId = await this.resolveChatId(session.counselorId, 'counselor');
                if (counselorChatId) {
                    await this.bot!.telegram.sendMessage(counselorChatId, 'Session has ended.');
                }
            } else {
                await ctx.reply('Session ended.');
                const userChatId = await this.resolveChatId(session.userId, 'user');
                if (userChatId) {
                    await this.bot!.telegram.sendMessage(
                        userChatId,
                        'Your session has ended. Thank you. If the conversation was inappropriate, report the counselor now with /report <reason>.'
                    );
                }
            }
        });

        bot.command('request_prayer', async ctx => {
            if (!ctx.chat) return;

            const title = this.extractCommandText(ctx.message?.text, 'request_prayer');
            if (!title) {
                this.pendingPrayerChatIds.add(ctx.chat.id);
                await ctx.reply('Please enter your prayer title/topic.');
                return;
            }

            const userId = await this.userManager!.registerUser(ctx.chat.id);
            await this.userManager!.submitPrayerRequest(userId, title);
            this.pendingPrayerChatIds.delete(ctx.chat.id);
            await ctx.reply('Your prayer request has been received. Counselors will pray for it.');
        });

        bot.command('list_of_prayer_requests', async ctx => {
            if (!ctx.chat) return;
            await this.sendPrayerRequestsToCounselor(ctx);
        });

        bot.command('close_prayer', async ctx => {
            if (!ctx.chat) return;
            if (!this.collections || !this.userManager) return;

            const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
            if (!counselor || !counselor.isApproved || counselor.isSuspended) {
                await ctx.reply('You are not approved to close prayer requests.');
                return;
            }

            const prayerId = this.extractCommandText(ctx.message?.text, 'close_prayer');
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
        });

        bot.command('history', async ctx => {
            if (!ctx.chat) return;

            const limitArg = this.extractCommandText(ctx.message?.text, 'history');
            const limit = limitArg ? Math.min(Math.max(parseInt(limitArg, 10) || 20, 1), 100) : 20;

            const session = await this.findRecentSessionByChat(ctx.chat.id);
            if (!session) {
                await ctx.reply('No session history available.');
                return;
            }

            const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
            const messages = await this.sessionManager!.getMessageHistory(session.sessionId, requesterId, requesterType, limit);

            if (messages.length === 0) {
                await ctx.reply('No messages in session history.');
                return;
            }

            const formatted = messages.map(msg => {
                const senderLabel = msg.senderType === 'user' ? 'User' : 'Counselor';
                return `[${msg.timestamp.toISOString()}] ${senderLabel}: ${msg.content}`;
            });

            await ctx.reply(formatted.join('\n'));
        });

        bot.command('report', async ctx => {
            if (!ctx.chat) return;

            const reason = this.extractCommandText(ctx.message?.text, 'report');
            if (!reason) {
                await ctx.reply('Please provide a reason for the report.');
                return;
            }

            const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
            if (requesterType !== 'user') {
                await ctx.reply('Only users can submit reports.');
                return;
            }

            let session = await this.sessionManager!.getActiveSessionForUser(requesterId);
            if (!session) {
                session = await this.findRecentSessionByChat(ctx.chat.id);
            }

            if (!session || session.userId !== requesterId) {
                await ctx.reply('No recent session found to report.');
                return;
            }

            const report = await this.reportingSystem!.submitReport(session.sessionId, session.counselorId, reason);
            await ctx.reply(`Report submitted. Reference: ${report.reportId}`);
        });

        bot.command('register_counselor', async ctx => {
            if (!ctx.chat) return;

            const existing = await this.collections!.counselors.findOne({ telegramChatId: ctx.chat.id });
            if (existing) {
                await ctx.reply(`You are already registered. Counselor ID: ${existing.id}. Await admin approval.`);
                return;
            }

            const counselorId = await this.counselorManager!.createCounselor(ctx.chat.id);
            await ctx.reply(`Counselor registration created. Your counselor ID is ${counselorId}. Await admin approval.`);
        });

        bot.command('available', async ctx => this.updateCounselorStatus(ctx, 'available'));
        bot.command('busy', async ctx => this.updateCounselorStatus(ctx, 'busy'));
        bot.command('away', async ctx => this.updateCounselorStatus(ctx, 'away'));

        bot.command('my_stats', async ctx => {
            if (!ctx.chat) return;

            const counselor = await this.collections!.counselors.findOne({ telegramChatId: ctx.chat.id });
            if (!counselor || !counselor.isApproved || counselor.isSuspended) {
                await ctx.reply('You are not approved to access counselor stats.');
                return;
            }

            const stats = await this.statisticsManager!.getCounselorStats(counselor.id);
            await ctx.reply(
                `Sessions completed: ${stats.totalSessionsCompleted}\nActive sessions: ${stats.activeSessions}\nAverage duration: ${stats.averageSessionDuration} minutes\nPeak hours: ${stats.peakUsageHours.join(', ') || 'N/A'}`
            );
        });

        bot.command('admin_stats', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized admin_stats access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to access admin stats.');
                return;
            }

            const stats = await this.statisticsManager!.getAdminStats();
            await ctx.reply(
                `Total sessions completed: ${stats.totalSessionsCompleted}\nActive sessions: ${stats.activeSessions}\nAverage duration: ${stats.averageSessionDuration} minutes\nPrayer requests: ${stats.totalPrayerRequests}\nPeak hours: ${stats.peakUsageHours.join(', ') || 'N/A'}`
            );
        });

        bot.command('pending_reports', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized pending_reports access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to view reports.');
                return;
            }

            const reports = await this.reportingSystem!.getPendingReports();
            if (reports.length === 0) {
                await ctx.reply('No pending reports.');
                return;
            }

            const formatted = reports.map(report => `${report.reportId} | counselor ${report.counselorId} | ${report.reason}`);
            await ctx.reply(formatted.join('\n'));
        });

        bot.command('process_report', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized process_report access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to process reports.');
                return;
            }

            const args = this.extractCommandText(ctx.message?.text, 'process_report');
            if (!args) {
                await ctx.reply('Usage: /process_report <reportId> <strike|dismiss>');
                return;
            }

            const [reportId, action] = args.split(' ');
            if (!reportId || (action !== 'strike' && action !== 'dismiss')) {
                await ctx.reply('Usage: /process_report <reportId> <strike|dismiss>');
                return;
            }

            const report = await this.reportingSystem!.processReport(reportId, ctx.chat.id.toString(), action);
            await this.auditLogManager!.recordAdminAction(
                ctx.chat.id.toString(),
                'process_report',
                reportId,
                { action, counselorId: report.counselorId }
            );
            await ctx.reply(`Report ${report.reportId} processed. Action: ${action}.`);
        });

        bot.command('approve_counselor', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized approve_counselor access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to approve counselors.');
                return;
            }

            const counselorId = this.extractCommandText(ctx.message?.text, 'approve_counselor');
            if (!counselorId) {
                const pending = await this.collections!.counselors
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

            await this.counselorManager!.approveCounselor(ctx.chat.id.toString(), counselorId);
            await this.auditLogManager!.recordAdminAction(ctx.chat.id.toString(), 'approve_counselor', counselorId);
            await ctx.reply(`Counselor ${counselorId} approved.`);

            const counselor = await this.collections!.counselors.findOne({ id: counselorId });
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
        });

        bot.command('remove_counselor', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized remove_counselor access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to remove counselors.');
                return;
            }

            const counselorId = this.extractCommandText(ctx.message?.text, 'remove_counselor');
            if (!counselorId) {
                const counselors = await this.counselorManager!.listCounselors();
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

            await this.counselorManager!.removeCounselor(ctx.chat.id.toString(), counselorId);
            await this.auditLogManager!.recordAdminAction(ctx.chat.id.toString(), 'remove_counselor', counselorId);
            await ctx.reply(`Counselor ${counselorId} removed.`);
        });

        bot.command('audit_log', async ctx => {
            if (!ctx.chat) return;
            if (!this.isAdmin(ctx.chat.id)) {
                logger.warn('Unauthorized audit_log access', { chatId: ctx.chat.id });
                await ctx.reply('You are not authorized to view audit logs.');
                return;
            }

            const limitArg = this.extractCommandText(ctx.message?.text, 'audit_log');
            const limit = limitArg ? Math.min(Math.max(parseInt(limitArg, 10) || 20, 1), 100) : 20;

            const logs = await this.auditLogManager!.getRecentAdminActions(limit);
            if (logs.length === 0) {
                await ctx.reply('No audit log entries found.');
                return;
            }

            const formatted = logs.map(log => {
                const target = log.targetId ? ` | target ${log.targetId}` : '';
                return `${log.timestamp.toISOString()} | ${log.action}${target} | admin ${log.adminId}`;
            });

            await ctx.reply(formatted.join('\n'));
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

            if (this.pendingPrayerChatIds.has(ctx.chat.id)) {
                const title = ctx.message.text.trim();
                if (!title) {
                    await ctx.reply('Please enter your prayer title/topic.');
                    return;
                }

                const userId = await this.userManager!.registerUser(ctx.chat.id);
                await this.userManager!.submitPrayerRequest(userId, title);
                this.pendingPrayerChatIds.delete(ctx.chat.id);
                await ctx.reply('Your prayer request has been received. Counselors will pray for it.');
                return;
            }

            const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
            const activeSession = requesterType === 'user'
                ? await this.sessionManager!.getActiveSessionForUser(requesterId)
                : await this.sessionManager!.getActiveSessionForCounselor(requesterId);

            if (!activeSession) {
                await ctx.reply('No active session found. Use /start_session to begin.');
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
        });
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
                `ID: ${prayer.prayerId}`,
                `Title: ${prayer.title}`,
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