import { Telegraf, Context, Markup } from 'telegraf';
import { AppConfig } from '../config/Config';
import { DatabaseManager } from '../database';
import { Collections } from '../database/Collections';
import { UserManager, CounselorManager, SessionManager, ReportingSystem, StatisticsManager, CleanupManager, AuditLogManager, BroadcastManager } from '../managers';
import type { BroadcastTarget } from '../managers/BroadcastManager';
import { Session } from '../types/Session';
import { AuditLog } from '../types/AuditLog';
import { UserState } from '../types/User';
import { generateAppealId } from '../models/utils';
import { logger } from '../utils/logger';

type CounselorOnboardingStep =
    | 'full_name'
    | 'telegram_username'
    | 'languages'
    | 'languages_other'
    | 'domains'
    | 'domains_other'
    | 'experience'
    | 'country'
    | 'location'
    | 'confirm';

interface CounselorOnboardingData {
    fullName?: string;
    telegramUsername?: string;
    languages: string[];
    domains: string[];
    yearsExperience?: number;
    country?: string;
    location?: string;
}

interface CounselorOnboardingState {
    step: CounselorOnboardingStep;
    data: CounselorOnboardingData;
}

type MatchingStep = 'language' | 'language_other' | 'domain' | 'domain_other' | 'consent';

interface MatchingState {
    step: MatchingStep;
    languages: string[];
    domain?: string;
}

type TransferStep = 'reason' | 'reason_other' | 'request_sent';

interface TransferState {
    step: TransferStep;
    sessionId: string;
    counselorId: string;
    userId: string;
    languages: string[];
    domain: string;
    reason?: string;
}

interface PendingTransfer {
    sessionId: string;
    fromCounselorId: string;
    userId: string;
    domain: string;
    languages: string[];
    reason: string;
    candidateIds: string[];
    candidateIndex: number;
}

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
    private broadcastManager: BroadcastManager | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    private broadcastState = new Map<number, { step: 'target' | 'message'; target?: BroadcastTarget; message?: string }>();
    private counselorOnboardingState = new Map<number, CounselorOnboardingState>();
    private matchingState = new Map<number, MatchingState>();
    private transferState = new Map<number, TransferState>();
    private pendingTransfers = new Map<string, PendingTransfer>();

    private static readonly MENU_START_COUNSELING = '💬 Start chatting with counselor';
    private static readonly MENU_SUBMIT_PRAYER = '🙏 Submit Prayer Request';
    private static readonly MENU_HISTORY = '📜 My History';
    private static readonly MENU_HELP = 'ℹ️ Help';
    private static readonly MENU_END_SESSION = '🛑 End Session';
    private static readonly MENU_REPORT = '⚠️ Report';
    private static readonly MENU_MAIN = '🏠 Main Menu';
    private static readonly MENU_REGISTER_COUNSELOR = '🧑‍⚕️ Register as Counselor';
    private static readonly MENU_STATUS_AVAILABLE = '✅ Set Available';
    private static readonly MENU_STATUS_AWAY = '⚪ Set Away';
    private static readonly MENU_MY_STATS = '📊 My Stats';
    private static readonly MENU_PRAYER_REQUESTS = '🙏 Prayer Requests';
    private static readonly MENU_CLOSE_PRAYER = '✅ Close Prayers';
    private static readonly MENU_TRANSFER_SESSION = '🔁 Transfer Session to Expert';
    private static readonly MENU_ADMIN_STATS = '🛡️ Admin Stats';
    private static readonly MENU_PENDING_REPORTS = '🚩 Pending Reports';
    private static readonly MENU_PROCESS_REPORT = '⚙️ Process Report';
    private static readonly MENU_COUNSELOR_LIST = '🧑‍⚕️ Counselors List';
    private static readonly MENU_APPEAL = '📝 Appeal';
    private static readonly MENU_APPEALS = '🧾 Appeals';
    private static readonly MENU_APPROVE_COUNSELOR = '✅ Approve Counselor';
    private static readonly MENU_REMOVE_COUNSELOR = '🗑️ Remove Counselor';
    private static readonly MENU_AUDIT_LOG = '📜 Audit Log';
    private static readonly MENU_BROADCAST = '📢 Broadcast Message';
    private static readonly BROADCAST_TARGET_USERS = '👤 Users';
    private static readonly BROADCAST_TARGET_COUNSELORS = '🧑‍⚕️ Counselors';
    private static readonly BROADCAST_TARGET_EVERYONE = '🌍 Everyone';
    private static readonly BROADCAST_CANCEL = '❌ Cancel';
    private static readonly BROADCAST_ACTION_CONFIRM = 'broadcast_confirm';
    private static readonly BROADCAST_ACTION_CANCEL = 'broadcast_cancel';
    private static readonly RATE_SESSION_ACTION_PREFIX = 'rate_session';
    private static readonly MATCHING_LANG_ACTION_PREFIX = 'match_lang';
    private static readonly MATCHING_LANG_DONE = 'match_lang_done';
    private static readonly MATCHING_DOMAIN_ACTION_PREFIX = 'match_dom';
    private static readonly MATCHING_BACK = 'match_back';
    private static readonly MATCHING_CANCEL = 'match_cancel';
    private static readonly MATCHING_RETRY_LANG = 'match_retry_lang';
    private static readonly MATCHING_WAIT = 'match_wait';
    private static readonly TRANSFER_REASON_ACTION_PREFIX = 'transfer_reason';
    private static readonly TRANSFER_ACCEPT_ACTION_PREFIX = 'transfer_accept';
    private static readonly TRANSFER_DECLINE_ACTION_PREFIX = 'transfer_decline';
    private static readonly TRANSFER_OPTION_CONTINUE = 'transfer_continue';
    private static readonly TRANSFER_OPTION_WAIT = 'transfer_wait';
    private static readonly TRANSFER_OPTION_END = 'transfer_end';
    private static readonly TRANSFER_CANCEL = 'transfer_cancel';
    private static readonly COUNSELOR_ONBOARDING_LANG_ACTION_PREFIX = 'co_lang';
    private static readonly COUNSELOR_ONBOARDING_DOMAIN_ACTION_PREFIX = 'co_dom';
    private static readonly COUNSELOR_ONBOARDING_LANG_DONE = 'co_lang_done';
    private static readonly COUNSELOR_ONBOARDING_DOMAIN_DONE = 'co_dom_done';
    private static readonly COUNSELOR_ONBOARDING_BACK = 'co_back';
    private static readonly COUNSELOR_ONBOARDING_CANCEL = 'co_cancel';
    private static readonly COUNSELOR_ONBOARDING_CONFIRM = 'co_confirm';
    private static readonly CONSENT_ACTION_PREFIX = 'consent';
    private static readonly CLOSE_PRAYER_ACTION_PREFIX = 'close_prayer';
    private static readonly REMOVE_COUNSELOR_ACTION_PREFIX = 'remove_counselor';
    private static readonly APPROVE_COUNSELOR_ACTION_PREFIX = 'approve_counselor';
    private static readonly PROCESS_REPORT_ACTION_PREFIX = 'pr';
    private static readonly VIEW_REPORT_CHAT_ACTION_PREFIX = 'vrc';
    private static readonly REVOKE_SUSPENSION_ACTION_PREFIX = 'rs';
    private static readonly REAPPROVE_ACTION_PREFIX = 'ap';
    private static readonly APPEAL_ACTION_PREFIX = 'al';
    private static readonly PAGINATE_REPORTS_ACTION_PREFIX = 'pgr';
    private static readonly PAGINATE_COUNSELORS_ACTION_PREFIX = 'pgc';
    private static readonly PAGINATE_APPEALS_ACTION_PREFIX = 'pga';
    private static readonly PAGINATE_APPROVALS_ACTION_PREFIX = 'pgap';
    private static readonly PAGINATE_REMOVALS_ACTION_PREFIX = 'pgrm';
    private static readonly PAGINATE_PRAYERS_ACTION_PREFIX = 'pgp';
    private static readonly PAGINATE_HISTORY_LIST_ACTION_PREFIX = 'pghl';
    private static readonly PAGINATE_HISTORY_CHAT_ACTION_PREFIX = 'pghc';
    private static readonly VIEW_HISTORY_CHAT_ACTION_PREFIX = 'vhc';
    private static readonly PAGINATE_AUDIT_ACTION_PREFIX = 'pgal';
    private static readonly PAGE_SIZE = 10;
    private static readonly HISTORY_CHAT_PAGE_SIZE = 25;
    private static readonly COUNSELOR_LANGUAGES = ['English', 'Amharic', 'Afaan Oromo', 'Tigrinya', 'Other'];
    private static readonly COUNSELOR_DOMAINS = [
        'Mental Health Support',
        'Anxiety',
        'Depression',
        'Relationship Counseling',
        'Marriage Counseling',
        'Spiritual Guidance',
        'Grief / Loss',
        'Addiction Recovery',
        'Youth Counseling',
        'Other'
    ];
    private static readonly TRANSFER_REASONS = [
        'Outside my expertise',
        'Language mismatch',
        'User needs specialized support',
        'Technical issue',
        'Other'
    ];

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
        this.broadcastManager = new BroadcastManager(
            this.bot,
            this.collections.users,
            this.collections.counselors,
            this.collections.broadcastLogs
        );

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

        bot.use(async (ctx, next) => {
            if (!ctx.chat || !this.userManager) {
                return next();
            }

            if (this.isAdmin(ctx.chat.id)) {
                return next();
            }

            const userState = await this.userManager.getUserStateByTelegramId(ctx.chat.id);
            if (userState !== 'RATING_REQUIRED') {
                return next();
            }

            const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery
                ? ctx.callbackQuery.data
                : undefined;
            if (callbackData && callbackData.startsWith(BotHandler.RATE_SESSION_ACTION_PREFIX)) {
                return next();
            }
            if (callbackData && callbackData.startsWith(BotHandler.CONSENT_ACTION_PREFIX)) {
                return next();
            }

            const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
            if (requesterType !== 'user') {
                return next();
            }

            const pendingSession = await this.findPendingRatingSession(requesterId);
            if (!pendingSession) {
                await this.userManager.updateUserState(requesterId, 'IDLE');
                return next();
            }

            await this.sendRatingPrompt(ctx, pendingSession.sessionId);
            return undefined;
        });

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

        bot.hears(BotHandler.MENU_TRANSFER_SESSION, async ctx => {
            if (!ctx.chat) return;
            await this.handleTransferStart(ctx);
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

        bot.hears(BotHandler.MENU_COUNSELOR_LIST, async ctx => {
            if (!ctx.chat) return;
            await this.handleCounselorList(ctx);
        });

        bot.hears(BotHandler.MENU_APPEAL, async ctx => {
            if (!ctx.chat) return;
            await this.handleAppealStart(ctx);
        });

        bot.hears(BotHandler.MENU_APPEALS, async ctx => {
            if (!ctx.chat) return;
            await this.handleAppeals(ctx);
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

        bot.hears(BotHandler.MENU_BROADCAST, async ctx => {
            if (!ctx.chat) return;
            await this.handleBroadcastStart(ctx);
        });

        bot.action(BotHandler.BROADCAST_ACTION_CONFIRM, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleBroadcastConfirm(ctx);
        });

        bot.action(BotHandler.BROADCAST_ACTION_CANCEL, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleBroadcastCancelAction(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.RATE_SESSION_ACTION_PREFIX}:(.+):(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const match = ctx.match as RegExpMatchArray;
            const sessionId = match[1];
            const rating = Number.parseInt(match[2], 10);
            await ctx.answerCbQuery();
            await this.handleSessionRating(ctx, sessionId, rating);
        });

        bot.action(new RegExp(`^${BotHandler.MATCHING_LANG_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const language = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleMatchingLanguageSelect(ctx, language);
        });

        bot.action(BotHandler.MATCHING_LANG_DONE, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleMatchingLanguageDone(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.MATCHING_DOMAIN_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const domain = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleMatchingDomainSelect(ctx, domain);
        });

        bot.action(BotHandler.MATCHING_BACK, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleMatchingBack(ctx);
        });

        bot.action(BotHandler.MATCHING_CANCEL, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleMatchingCancel(ctx);
        });

        bot.action(BotHandler.MATCHING_RETRY_LANG, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleMatchingRetryLanguage(ctx);
        });

        bot.action(BotHandler.MATCHING_WAIT, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleMatchingWait(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_REASON_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const reason = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferReasonSelect(ctx, reason);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_ACCEPT_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferAccept(ctx, sessionId);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_DECLINE_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferDecline(ctx, sessionId);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_OPTION_CONTINUE}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferContinue(ctx, sessionId);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_OPTION_WAIT}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferWait(ctx, sessionId);
        });

        bot.action(new RegExp(`^${BotHandler.TRANSFER_OPTION_END}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleTransferEnd(ctx, sessionId);
        });

        bot.action(BotHandler.TRANSFER_CANCEL, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleTransferCancel(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.COUNSELOR_ONBOARDING_LANG_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const language = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingLanguageSelect(ctx, language);
        });

        bot.action(new RegExp(`^${BotHandler.COUNSELOR_ONBOARDING_DOMAIN_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const domain = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingDomainSelect(ctx, domain);
        });

        bot.action(BotHandler.COUNSELOR_ONBOARDING_LANG_DONE, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingLanguagesDone(ctx);
        });

        bot.action(BotHandler.COUNSELOR_ONBOARDING_DOMAIN_DONE, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingDomainsDone(ctx);
        });

        bot.action(BotHandler.COUNSELOR_ONBOARDING_BACK, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingBack(ctx);
        });

        bot.action(BotHandler.COUNSELOR_ONBOARDING_CANCEL, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingCancel(ctx);
        });

        bot.action(BotHandler.COUNSELOR_ONBOARDING_CONFIRM, async ctx => {
            if (!ctx.chat) return;
            await ctx.answerCbQuery();
            await this.handleCounselorOnboardingConfirm(ctx);
        });

        bot.action(new RegExp(`^${BotHandler.CONSENT_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const userId = (ctx.match as RegExpMatchArray)[1];
            await this.handleConsent(ctx, userId);
        });

        bot.action(new RegExp(`^${BotHandler.CLOSE_PRAYER_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const prayerId = (ctx.match as RegExpMatchArray)[1];
            await this.handleClosePrayer(ctx, prayerId);
        });

        bot.action(new RegExp(`^${BotHandler.REMOVE_COUNSELOR_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const counselorId = (ctx.match as RegExpMatchArray)[1];
            await this.handleRemoveCounselor(ctx, counselorId);
        });

        bot.action(new RegExp(`^${BotHandler.APPROVE_COUNSELOR_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const counselorId = (ctx.match as RegExpMatchArray)[1];
            await this.handleApproveCounselor(ctx, counselorId);
        });

        bot.action(new RegExp(`^${BotHandler.REVOKE_SUSPENSION_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const counselorId = (ctx.match as RegExpMatchArray)[1];
            await this.handleRevokeSuspension(ctx, counselorId);
        });

        bot.action(new RegExp(`^${BotHandler.REAPPROVE_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const counselorId = (ctx.match as RegExpMatchArray)[1];
            await this.handleReapproveCounselor(ctx, counselorId);
        });

        bot.action(new RegExp(`^${BotHandler.PROCESS_REPORT_ACTION_PREFIX}:(.+):(s|d)$`), async ctx => {
            if (!ctx.chat) return;
            const match = ctx.match as RegExpMatchArray;
            const reportId = match[1];
            const actionToken = match[2];
            const action = actionToken === 's' ? 'strike' : 'dismiss';
            await this.processReportAction(ctx, reportId, action);
        });

        bot.action(new RegExp(`^${BotHandler.VIEW_REPORT_CHAT_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const reportId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.handleViewReportChat(ctx, reportId);
        });

        bot.action(new RegExp(`^${BotHandler.APPEAL_ACTION_PREFIX}:(.+):(r|a)$`), async ctx => {
            if (!ctx.chat) return;
            const match = ctx.match as RegExpMatchArray;
            const appealId = match[1];
            const actionToken = match[2];
            const action = actionToken === 'r' ? 'revoke' : 'approve';
            await this.processAppealAction(ctx, appealId, action);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_REPORTS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handlePendingReports(ctx, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_COUNSELORS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handleCounselorList(ctx, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_APPEALS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handleAppeals(ctx, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_APPROVALS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handleApproveCounselor(ctx, undefined, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_REMOVALS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handleRemoveCounselor(ctx, undefined, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_PRAYERS_ACTION_PREFIX}:(\\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.sendPrayerRequestsToCounselor(ctx, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_HISTORY_LIST_ACTION_PREFIX}:(\d+)$`), async ctx => {
            if (!ctx.chat) return;
            const page = parseInt((ctx.match as RegExpMatchArray)[1], 10);
            await ctx.answerCbQuery();
            await this.handleHistoryList(ctx, page);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_HISTORY_CHAT_ACTION_PREFIX}:(\d+):(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const match = ctx.match as RegExpMatchArray;
            const page = parseInt(match[1], 10);
            const sessionId = match[2];
            await ctx.answerCbQuery();
            await this.sendHistoryChat(ctx, sessionId, page);
        });

        bot.action(new RegExp(`^${BotHandler.VIEW_HISTORY_CHAT_ACTION_PREFIX}:(.+)$`), async ctx => {
            if (!ctx.chat) return;
            const sessionId = (ctx.match as RegExpMatchArray)[1];
            await ctx.answerCbQuery();
            await this.sendHistoryChat(ctx, sessionId, 1);
        });

        bot.action(new RegExp(`^${BotHandler.PAGINATE_AUDIT_ACTION_PREFIX}:(\\d+)(?::(\\d+))?$`), async ctx => {
            if (!ctx.chat) return;
            const match = ctx.match as RegExpMatchArray;
            const page = parseInt(match[1], 10);
            const limitArg = match[2];
            await ctx.answerCbQuery();
            await this.handleAuditLog(ctx, limitArg, page);
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

            const broadcastHandled = await this.handleBroadcastFlowText(ctx);
            if (broadcastHandled) return;

            if (this.isMenuText(ctx.message.text)) {
                return;
            }

            const userState = await this.userManager!.getUserStateByTelegramId(ctx.chat.id);

            if (userState === 'MATCHING') {
                await this.handleMatchingText(ctx, ctx.message.text);
                return;
            }

            const transferState = this.transferState.get(ctx.chat.id);
            if (transferState && transferState.step === 'reason_other') {
                await this.handleTransferReasonText(ctx, ctx.message.text);
                return;
            }

            if (userState === 'COUNSELOR_ONBOARDING') {
                await this.handleCounselorOnboardingText(ctx, ctx.message.text);
                return;
            }

            if (userState === 'SUBMITTING_PRAYER') {
                await this.handlePrayerTitle(ctx, ctx.message.text);
                return;
            }

            if (userState === 'REPORTING') {
                await this.handleReportReason(ctx, ctx.message.text);
                return;
            }

            if (userState === 'APPEALING') {
                await this.handleAppealMessage(ctx, ctx.message.text);
                return;
            }

            const counselor = await this.collections!.counselors.findOne({ telegramChatId: ctx.chat.id });
            const isCounselor = !!counselor && counselor.isApproved && !counselor.isSuspended;

            if (isCounselor) {
                if (counselor.status !== 'busy' && this.counselorManager) {
                    try {
                        await this.counselorManager.setAvailability(counselor.id, 'busy', 'system');
                    } catch (error) {
                        const err = error as Error;
                        logger.warn('Failed to update counselor availability on first reply', {
                            counselorId: counselor.id,
                            message: err.message
                        });
                    }
                }

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

        if (this.isAdmin(ctx.chat.id)) {
            await this.replyWithMenu(ctx, 'IDLE', 'Admins cannot start counseling sessions.');
            return;
        }

        const userId = await this.userManager.registerUser(ctx.chat.id);
        const activeSession = await this.sessionManager.getActiveSessionForUser(userId);
        if (activeSession) {
            await this.userManager.updateUserState(userId, 'IN_SESSION');
            await this.replyWithMenu(ctx, 'IN_SESSION', 'You already have an active session.');
            return;
        }

        await this.startMatchingFlow(ctx);
    }

    private async handleConsent(ctx: Context, userId: string): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.counselorManager || !this.sessionManager || !this.collections || !this.bot) return;

        try {
            const user = await this.userManager.getUserByTelegramId(ctx.chat.id);
            if (!user || user.uuid !== userId) {
                await ctx.reply('Unable to confirm consent for this account.');
                return;
            }

            if (user.state !== 'MATCHING' && user.state !== 'WAITING_COUNSELOR') {
                await ctx.reply('No pending consent request. Use Start Counseling to begin.');
                return;
            }

            const matching = this.matchingState.get(ctx.chat.id);
            const preferredLanguages = matching?.languages ?? user.user_preferred_language ?? [];
            const requestedDomain = matching?.domain ?? user.user_requested_domain;
            if (!requestedDomain || preferredLanguages.length === 0) {
                await ctx.reply('Missing matching preferences. Please select your language and domain again.');
                await this.startMatchingFlow(ctx);
                return;
            }

            if (matching && matching.step !== 'consent') {
                await ctx.reply('Please complete the matching steps before giving consent.');
                return;
            }

            await ctx.reply('Finding a suitable counselor...');

            const matchResult = await this.findBestCounselorMatch(preferredLanguages, requestedDomain, ctx.chat.id);
            if (!matchResult) {
                await this.replyWithMenu(ctx, 'IDLE', 'No counselors are available right now. Please try again later.');
                this.matchingState.delete(ctx.chat.id);
                await this.userManager.updateUserState(userId, 'IDLE');
                return;
            }

            if ('reason' in matchResult) {
                if (matchResult.reason === 'no_language_match') {
                    await ctx.reply(
                        'No counselors match your language right now. You can choose another language or wait.',
                        this.buildMatchingNoLanguageKeyboard()
                    );
                    return;
                }

                await this.replyWithMenu(ctx, 'IDLE', 'No counselors are available right now. Please try again later.');
                this.matchingState.delete(ctx.chat.id);
                await this.userManager.updateUserState(userId, 'IDLE');
                return;
            }

            const counselorId = matchResult.counselorId;
            const counselor = matchResult.counselor;

            let session: Session;
            try {
                session = await this.sessionManager.createSession(user.uuid, counselorId, true);
            } catch (error) {
                const err = error as Error;
                if (err.message.includes('Counselor already has an active session')) {
                    await this.replyWithMenu(ctx, 'IDLE', 'No counselors are available right now. Please try again later.');
                    return;
                }
                throw error;
            }
            await this.bot.telegram.sendMessage(
                counselor.telegramChatId,
                `New session started. User ID: ${session.userId}. Use normal chat to reply.`
            );

            await this.userManager.updateUserState(user.uuid, 'IN_SESSION');
            this.matchingState.delete(ctx.chat.id);

            await this.replyWithMenu(ctx, 'IN_SESSION', `Session started. Your counselor has been notified. Session ID: ${session.sessionId}`);
        } catch (error) {
            const err = error as Error;
            await ctx.reply(err.message || 'Unable to start session right now. Please try again later.');
        }
    }

    private async endSession(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager) return;

        if (this.isAdmin(ctx.chat.id)) {
            await this.replyWithMenu(ctx, 'IDLE', 'Admins do not have active sessions to end.');
            return;
        }

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
            await this.userManager.updateUserState(requesterId, 'RATING_REQUIRED');
            await this.sendRatingPrompt(ctx, session.sessionId);
            const counselorChatId = await this.resolveChatId(this.getSessionCounselorId(session), 'counselor');
            if (counselorChatId) {
                await this.bot!.telegram.sendMessage(counselorChatId, 'Session has ended. The user ended the session.');
            }
        } else {
            await ctx.reply('Session ended.');
            const userChatId = await this.resolveChatId(session.userId, 'user');
            if (userChatId) {
                await this.bot!.telegram.sendMessage(
                    userChatId,
                    'Your session has ended. Please rate your counselor (1-5). Rating is required to continue.',
                    this.buildRatingKeyboard(session.sessionId)
                );
            }
            await this.userManager.updateUserState(session.userId, 'RATING_REQUIRED');
        }

        if (this.counselorManager) {
            try {
                await this.counselorManager.setAvailability(this.getSessionCounselorId(session), 'available', 'system');
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to update counselor availability after session end', {
                    counselorId: this.getSessionCounselorId(session),
                    message: err.message
                });
            }
        }
    }

    private async handleSessionRating(ctx: Context, sessionId: string, rating: number): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.sessionManager) return;

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        if (requesterType !== 'user') {
            await ctx.reply('Only users can rate sessions.');
            return;
        }

        try {
            await this.sessionManager.rateSession(sessionId, requesterId, rating);
        } catch (error) {
            const err = error as Error;
            await ctx.reply(err.message || 'Unable to record rating.');
            return;
        }

        await this.userManager.updateUserState(requesterId, 'POST_SESSION');
        await this.replyWithMenu(
            ctx,
            'POST_SESSION',
            `Thanks for rating. You rated this session ${rating}/5. You can report the counselor from the menu below if needed.`
        );
    }

    private buildRatingKeyboard(sessionId: string) {
        const buttons = [1, 2, 3, 4, 5].map(score =>
            Markup.button.callback(`${score}`, `${BotHandler.RATE_SESSION_ACTION_PREFIX}:${sessionId}:${score}`)
        );

        return Markup.inlineKeyboard([
            [buttons[0], buttons[1], buttons[2], buttons[3], buttons[4]]
        ]);
    }

    private async sendRatingPrompt(ctx: Context, sessionId: string): Promise<void> {
        await ctx.reply(
            'Session ended. Please rate your counselor (1-5). Rating is required to continue.',
            this.buildRatingKeyboard(sessionId)
        );
    }

    private async handleTransferStart(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections || !this.sessionManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isApproved || counselor.isSuspended) {
            await ctx.reply('You are not approved to transfer sessions.');
            return;
        }

        const session = await this.sessionManager.getActiveSessionForCounselor(counselor.id);
        if (!session) {
            await ctx.reply('No active session to transfer.');
            return;
        }

        const { languages, domain } = await this.getSessionPreferences(session);
        if (!domain || languages.length === 0) {
            await ctx.reply('Unable to determine session preferences. Please continue or end the session.');
            return;
        }

        const state: TransferState = {
            sessionId: session.sessionId,
            counselorId: counselor.id,
            userId: session.userId,
            languages,
            domain,
            step: 'reason'
        };

        this.transferState.set(ctx.chat.id, state);
        await ctx.reply('Select the transfer reason:', this.buildTransferReasonKeyboard());
    }

    private async handleTransferReasonSelect(ctx: Context, reason: string): Promise<void> {
        if (!ctx.chat) return;
        const state = this.transferState.get(ctx.chat.id);
        if (!state) return;

        if (reason === 'Other') {
            state.step = 'reason_other';
            await ctx.reply('Please enter the transfer reason.', Markup.inlineKeyboard([[
                Markup.button.callback('❌ Cancel', BotHandler.TRANSFER_CANCEL)
            ]]));
            return;
        }

        state.reason = reason;
        state.step = 'request_sent';
        await this.initiateTransferSearch(ctx, state);
    }

    private async handleTransferReasonText(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat) return;
        const state = this.transferState.get(ctx.chat.id);
        if (!state) return;

        const reason = text.trim();
        if (!reason) {
            await ctx.reply('Please enter a reason for the transfer.');
            return;
        }

        state.reason = reason;
        state.step = 'request_sent';
        await this.initiateTransferSearch(ctx, state);
    }

    private async initiateTransferSearch(ctx: Context, state: TransferState): Promise<void> {
        if (!ctx.chat || !this.collections || !this.sessionManager) return;

        if (!state.reason) {
            await ctx.reply('Transfer reason is required.');
            return;
        }

        const candidates = await this.findTransferCandidates(state.languages, state.domain, state.counselorId);
        if (candidates.length === 0) {
            await ctx.reply(
                'No matching expert counselors are available. Choose an option below.',
                this.buildTransferFallbackKeyboard(state.sessionId)
            );
            this.transferState.delete(ctx.chat.id);
            return;
        }

        const pending: PendingTransfer = {
            sessionId: state.sessionId,
            fromCounselorId: state.counselorId,
            userId: state.userId,
            domain: state.domain,
            languages: state.languages,
            reason: state.reason,
            candidateIds: candidates,
            candidateIndex: 0
        };

        this.pendingTransfers.set(state.sessionId, pending);
        await ctx.reply('Transfer request sent. Waiting for counselor response...');
        await this.sendTransferRequestToCandidate(pending);
    }

    private async handleTransferAccept(ctx: Context, sessionId: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.sessionManager || !this.counselorManager) return;

        const pending = this.pendingTransfers.get(sessionId);
        if (!pending) {
            await ctx.reply('This transfer request is no longer active.');
            return;
        }

        const candidate = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!candidate) {
            await ctx.reply('Unable to accept transfer.');
            return;
        }

        const expectedId = pending.candidateIds[pending.candidateIndex];
        if (candidate.id !== expectedId) {
            await ctx.reply('This transfer request has expired.');
            return;
        }

        await this.sessionManager.transferSession(sessionId, pending.fromCounselorId, candidate.id, pending.reason);

        try {
            await this.counselorManager.setAvailability(pending.fromCounselorId, 'available', 'system');
            await this.counselorManager.setAvailability(candidate.id, 'busy', 'system');
        } catch (error) {
            const err = error as Error;
            logger.warn('Failed to update counselor status after transfer', { message: err.message });
        }

        const oldCounselorChatId = await this.resolveChatId(pending.fromCounselorId, 'counselor');
        if (oldCounselorChatId) {
            await this.bot!.telegram.sendMessage(oldCounselorChatId, 'Session successfully transferred.');
        }

        const userChatId = await this.resolveChatId(pending.userId, 'user');
        if (userChatId) {
            await this.bot!.telegram.sendMessage(
                userChatId,
                'Your session has been transferred to another counselor with appropriate expertise to better support you.'
            );
        }

        await this.bot!.telegram.sendMessage(
            ctx.chat.id,
            'You are now connected to the user. Chat history is available.'
        );
        await this.sendSessionHistoryToCounselor(sessionId, candidate.id, ctx.chat.id);

        this.pendingTransfers.delete(sessionId);
        this.transferState.forEach((value, key) => {
            if (value.sessionId === sessionId) {
                this.transferState.delete(key);
            }
        });
    }

    private async handleTransferDecline(ctx: Context, sessionId: string): Promise<void> {
        if (!ctx.chat || !this.collections) return;

        const pending = this.pendingTransfers.get(sessionId);
        if (!pending) {
            await ctx.reply('This transfer request is no longer active.');
            return;
        }

        const candidate = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!candidate) {
            await ctx.reply('Unable to decline transfer.');
            return;
        }

        const expectedId = pending.candidateIds[pending.candidateIndex];
        if (candidate.id !== expectedId) {
            await ctx.reply('This transfer request has expired.');
            return;
        }

        pending.candidateIndex += 1;
        if (pending.candidateIndex >= pending.candidateIds.length) {
            this.pendingTransfers.delete(sessionId);
            const oldCounselorChatId = await this.resolveChatId(pending.fromCounselorId, 'counselor');
            if (oldCounselorChatId) {
                await this.bot!.telegram.sendMessage(
                    oldCounselorChatId,
                    'No available expert counselor accepted the transfer request.',
                    this.buildTransferFallbackKeyboard(sessionId)
                );
            }
            return;
        }

        await this.sendTransferRequestToCandidate(pending);
        await ctx.reply('Declined. The request has been forwarded to another counselor.');
    }

    private async handleTransferContinue(ctx: Context, sessionId: string): Promise<void> {
        if (!ctx.chat) return;
        this.pendingTransfers.delete(sessionId);
        this.transferState.delete(ctx.chat.id);
        await ctx.reply('Continuing the current session.');
    }

    private async handleTransferWait(ctx: Context, sessionId: string): Promise<void> {
        if (!ctx.chat) return;
        this.pendingTransfers.delete(sessionId);
        this.transferState.delete(ctx.chat.id);
        await ctx.reply('We will wait for an expert to become available. Try transfer again later.');
    }

    private async handleTransferEnd(ctx: Context, sessionId: string): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager) return;

        const session = await this.collections?.sessions.findOne({ sessionId });
        if (!session) {
            await ctx.reply('Session not found.');
            return;
        }

        await this.sessionManager.endSession(sessionId);
        await ctx.reply('Session ended.');

        const userChatId = await this.resolveChatId(session.userId, 'user');
        if (userChatId) {
            await this.bot!.telegram.sendMessage(
                userChatId,
                'Your session has ended. Please rate your counselor (1-5). Rating is required to continue.',
                this.buildRatingKeyboard(sessionId)
            );
        }
        await this.userManager.updateUserState(session.userId, 'RATING_REQUIRED');

        if (this.counselorManager) {
            try {
                await this.counselorManager.setAvailability(this.getSessionCounselorId(session), 'available', 'system');
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to update counselor availability after transfer end', { message: err.message });
            }
        }

        this.pendingTransfers.delete(sessionId);
        this.transferState.delete(ctx.chat.id);
    }

    private async handleTransferCancel(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        this.transferState.delete(ctx.chat.id);
        await ctx.reply('Transfer canceled.');
    }

    private buildTransferReasonKeyboard() {
        const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
        for (let i = 0; i < BotHandler.TRANSFER_REASONS.length; i += 2) {
            const left = BotHandler.TRANSFER_REASONS[i];
            const right = BotHandler.TRANSFER_REASONS[i + 1];
            const row: ReturnType<typeof Markup.button.callback>[] = [];
            row.push(Markup.button.callback(left, `${BotHandler.TRANSFER_REASON_ACTION_PREFIX}:${left}`));
            if (right) {
                row.push(Markup.button.callback(right, `${BotHandler.TRANSFER_REASON_ACTION_PREFIX}:${right}`));
            }
            rows.push(row);
        }
        rows.push([Markup.button.callback('❌ Cancel', BotHandler.TRANSFER_CANCEL)]);
        return Markup.inlineKeyboard(rows);
    }

    private buildTransferFallbackKeyboard(sessionId: string) {
        return Markup.inlineKeyboard([
            [Markup.button.callback('✅ Continue Session', `${BotHandler.TRANSFER_OPTION_CONTINUE}:${sessionId}`)],
            [Markup.button.callback('⏳ Wait for Expert', `${BotHandler.TRANSFER_OPTION_WAIT}:${sessionId}`)],
            [Markup.button.callback('🛑 End Session', `${BotHandler.TRANSFER_OPTION_END}:${sessionId}`)]
        ]);
    }

    private async findTransferCandidates(
        languages: string[],
        domain: string,
        excludedCounselorId: string
    ): Promise<string[]> {
        if (!this.collections) return [];

        const candidates = await this.collections.counselors.find({
            status: 'available',
            isApproved: true,
            isSuspended: false
        }).toArray();

        const normalizedLanguages = languages.map(lang => lang.toLowerCase());
        const normalizedDomain = domain.toLowerCase();

        const filtered = candidates
            .filter(counselor => counselor.id !== excludedCounselorId)
            .map(counselor => {
                const counselorLanguages = (counselor.languagesSpoken ?? []).map((lang: string) => lang.toLowerCase());
                const counselorDomains = (counselor.domainExpertise ?? []).map((item: string) => item.toLowerCase());
                const languageMatch = counselorLanguages.some(lang => normalizedLanguages.includes(lang));
                const domainMatch = counselorDomains.includes(normalizedDomain);
                return { counselor, languageMatch, domainMatch };
            })
            .filter(candidate => candidate.languageMatch && candidate.domainMatch);

        if (filtered.length === 0) {
            return [];
        }

        const activeCounts = await Promise.all(
            filtered.map(candidate =>
                this.collections!.sessions.countDocuments({
                    isActive: true,
                    $or: [
                        { counselorId: candidate.counselor.id },
                        { currentCounselorId: candidate.counselor.id }
                    ]
                } as unknown as Record<string, unknown>)
            )
        );

        const ranked = filtered.map((candidate, index) => ({
            counselor: candidate.counselor,
            activeCount: activeCounts[index] ?? 0,
            ratingAverage: candidate.counselor.ratingAverage ?? 0,
            lastActive: candidate.counselor.lastActive ?? new Date(0)
        }));

        ranked.sort((a, b) => {
            if (a.activeCount !== b.activeCount) {
                return a.activeCount - b.activeCount;
            }
            if (a.ratingAverage !== b.ratingAverage) {
                return b.ratingAverage - a.ratingAverage;
            }
            return b.lastActive.getTime() - a.lastActive.getTime();
        });

        return ranked.map(item => item.counselor.id);
    }

    private async sendTransferRequestToCandidate(pending: PendingTransfer): Promise<void> {
        if (!this.collections || !this.bot) return;

        const candidateId = pending.candidateIds[pending.candidateIndex];
        const counselor = await this.collections.counselors.findOne({ id: candidateId });
        if (!counselor?.telegramChatId) {
            pending.candidateIndex += 1;
            if (pending.candidateIndex >= pending.candidateIds.length) {
                this.pendingTransfers.delete(pending.sessionId);
                const oldCounselorChatId = await this.resolveChatId(pending.fromCounselorId, 'counselor');
                if (oldCounselorChatId) {
                    await this.bot.telegram.sendMessage(
                        oldCounselorChatId,
                        'No available expert counselor accepted the transfer request.',
                        this.buildTransferFallbackKeyboard(pending.sessionId)
                    );
                }
                return;
            }
            await this.sendTransferRequestToCandidate(pending);
            return;
        }

        const message = [
            'You have a session transfer request.',
            `Domain: ${pending.domain}`,
            `Language: ${pending.languages.join(', ')}`,
            `Reason: ${pending.reason}`
        ].join('\n');

        await this.bot.telegram.sendMessage(
            counselor.telegramChatId,
            message,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ Accept Transfer', `${BotHandler.TRANSFER_ACCEPT_ACTION_PREFIX}:${pending.sessionId}`)],
                [Markup.button.callback('❌ Decline', `${BotHandler.TRANSFER_DECLINE_ACTION_PREFIX}:${pending.sessionId}`)]
            ])
        );
    }

    private async sendSessionHistoryToCounselor(sessionId: string, counselorId: string, chatId: number): Promise<void> {
        if (!this.sessionManager || !this.bot) return;

        try {
            const messages = await this.sessionManager.getMessageHistory(sessionId, counselorId, 'counselor', 50);
            if (messages.length === 0) {
                return;
            }

            const formatted = messages.map(msg => {
                const senderLabel = msg.senderType === 'user' ? 'User' : 'Counselor';
                const ts = msg.timestamp instanceof Date
                    ? msg.timestamp.toISOString()
                    : new Date(msg.timestamp).toISOString();
                return `[${ts}] ${senderLabel}: ${msg.content}`;
            });

            const header = 'Recent chat history (last 50 messages):\n';
            const TELEGRAM_MAX_LENGTH = 4096;
            let currentChunk = header;

            for (const line of formatted) {
                if (currentChunk.length + line.length + 1 > TELEGRAM_MAX_LENGTH) {
                    await this.bot.telegram.sendMessage(chatId, currentChunk);
                    currentChunk = '';
                }
                currentChunk += (currentChunk ? '\n' : '') + line;
            }

            if (currentChunk) {
                await this.bot.telegram.sendMessage(chatId, currentChunk);
            }
        } catch (error) {
            const err = error as Error;
            logger.warn('Failed to send transfer history', { sessionId, message: err.message });
        }
    }

    private async getSessionPreferences(session: Session): Promise<{ languages: string[]; domain?: string }> {
        if (session.userPreferredLanguage && session.userRequestedDomain) {
            return { languages: session.userPreferredLanguage, domain: session.userRequestedDomain };
        }

        if (!this.collections) {
            return { languages: [] };
        }

        const user = await this.collections.users.findOne({ uuid: session.userId });
        const languages = user?.user_preferred_language ?? [];
        const domain = user?.user_requested_domain;
        if (domain) {
            return { languages, domain };
        }
        return { languages };
    }

    private async startMatchingFlow(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;

        const state: MatchingState = {
            step: 'language',
            languages: []
        };

        this.matchingState.set(ctx.chat.id, state);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'MATCHING');
        await this.promptMatchingStep(ctx, state);
    }

    private async handleMatchingText(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat || !this.userManager) return;

        const state = this.matchingState.get(ctx.chat.id);
        if (!state) {
            await this.startMatchingFlow(ctx);
            return;
        }

        const trimmed = text.trim();
        if (!trimmed) {
            await this.promptMatchingStep(ctx, state, 'Please enter a valid response.');
            return;
        }

        if (state.step === 'language_other') {
            this.addUniqueSelection(state.languages, trimmed);
            state.step = 'language';
            await this.promptMatchingStep(ctx, state, `Added language: ${trimmed}. Select more or tap Done.`);
            return;
        }

        if (state.step === 'domain_other') {
            state.domain = trimmed;
            state.step = 'consent';
            await this.userManager.updateUserMatchingPreferences(ctx.chat.id, state.languages, trimmed);
            await this.promptMatchingStep(ctx, state);
            return;
        }

        await ctx.reply('Please use the buttons provided to continue.');
    }

    private async handleMatchingLanguageSelect(ctx: Context, language: string): Promise<void> {
        if (!ctx.chat) return;
        const state = this.matchingState.get(ctx.chat.id);
        if (!state) return;

        if (language === 'Other') {
            state.step = 'language_other';
            await this.promptMatchingStep(ctx, state);
            return;
        }

        this.toggleSelection(state.languages, language);
        state.step = 'language';
        await this.promptMatchingStep(ctx, state);
    }

    private async handleMatchingLanguageDone(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        const state = this.matchingState.get(ctx.chat.id);
        if (!state) return;

        if (state.languages.length === 0) {
            await this.promptMatchingStep(ctx, state, 'Please select at least one language.');
            return;
        }

        state.step = 'domain';
        await this.promptMatchingStep(ctx, state);
    }

    private async handleMatchingDomainSelect(ctx: Context, domain: string): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        const state = this.matchingState.get(ctx.chat.id);
        if (!state) return;

        if (domain === 'Other') {
            state.step = 'domain_other';
            await this.promptMatchingStep(ctx, state);
            return;
        }

        state.domain = domain;
        state.step = 'consent';
        await this.userManager.updateUserMatchingPreferences(ctx.chat.id, state.languages, domain);
        await this.promptMatchingStep(ctx, state);
    }

    private async handleMatchingBack(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        const state = this.matchingState.get(ctx.chat.id);
        if (!state) return;

        switch (state.step) {
            case 'language_other':
                state.step = 'language';
                break;
            case 'domain_other':
                state.step = 'domain';
                break;
            case 'domain':
                state.step = 'language';
                break;
            case 'consent':
                state.step = 'domain';
                break;
            case 'language':
            default:
                await this.promptMatchingStep(ctx, state, 'You are already at the first step.');
                return;
        }

        await this.promptMatchingStep(ctx, state);
    }

    private async handleMatchingCancel(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        this.matchingState.delete(ctx.chat.id);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', 'Matching canceled.');
    }

    private async handleMatchingRetryLanguage(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        const state: MatchingState = {
            step: 'language',
            languages: []
        };
        this.matchingState.set(ctx.chat.id, state);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'MATCHING');
        await this.promptMatchingStep(ctx, state, 'Select your preferred language(s).');
    }

    private async handleMatchingWait(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        this.matchingState.delete(ctx.chat.id);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', 'No matching counselors are available right now. Please try again later.');
    }

    private async promptMatchingStep(ctx: Context, state: MatchingState, message?: string): Promise<void> {
        if (!ctx.chat || !this.sessionManager) return;

        switch (state.step) {
            case 'language': {
                const text = message ?? 'Select your preferred language(s) (multi-select). Tap Done when finished.';
                await ctx.reply(text, this.buildMatchingLanguageKeyboard(state.languages));
                return;
            }
            case 'language_other': {
                const text = message ?? 'Please type the language you prefer.';
                await ctx.reply(text, this.buildMatchingNavKeyboard());
                return;
            }
            case 'domain': {
                const text = message ?? 'Select your counseling domain (single selection).';
                await ctx.reply(text, this.buildMatchingDomainKeyboard());
                return;
            }
            case 'domain_other': {
                const text = message ?? 'Please type the counseling domain you need.';
                await ctx.reply(text, this.buildMatchingNavKeyboard());
                return;
            }
            case 'consent': {
                const text = message ?? this.sessionManager.getConsentDisclosureText();
                await ctx.reply(
                    text,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Agree and Continue', `${BotHandler.CONSENT_ACTION_PREFIX}:${await this.userManager!.registerUser(ctx.chat.id)}`)],
                        ...this.buildMatchingNavButtonsRow(true)
                    ])
                );
                return;
            }
            default:
                await ctx.reply('Let\'s continue your session setup.', this.buildMatchingNavKeyboard());
        }
    }

    private buildMatchingLanguageKeyboard(selected: string[]) {
        const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
        const selectedSet = new Set(selected);

        for (let i = 0; i < BotHandler.COUNSELOR_LANGUAGES.length; i += 2) {
            const left = BotHandler.COUNSELOR_LANGUAGES[i];
            const right = BotHandler.COUNSELOR_LANGUAGES[i + 1];
            const row: ReturnType<typeof Markup.button.callback>[] = [];
            const leftLabel = selectedSet.has(left) ? `✅ ${left}` : left;
            row.push(Markup.button.callback(leftLabel, `${BotHandler.MATCHING_LANG_ACTION_PREFIX}:${left}`));
            if (right) {
                const rightLabel = selectedSet.has(right) ? `✅ ${right}` : right;
                row.push(Markup.button.callback(rightLabel, `${BotHandler.MATCHING_LANG_ACTION_PREFIX}:${right}`));
            }
            rows.push(row);
        }

        rows.push([Markup.button.callback('✅ Done', BotHandler.MATCHING_LANG_DONE)]);
        rows.push(...this.buildMatchingNavButtonsRow(true));
        return Markup.inlineKeyboard(rows);
    }

    private buildMatchingDomainKeyboard() {
        const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
        for (let i = 0; i < BotHandler.COUNSELOR_DOMAINS.length; i += 2) {
            const left = BotHandler.COUNSELOR_DOMAINS[i];
            const right = BotHandler.COUNSELOR_DOMAINS[i + 1];
            const row: ReturnType<typeof Markup.button.callback>[] = [];
            row.push(Markup.button.callback(left, `${BotHandler.MATCHING_DOMAIN_ACTION_PREFIX}:${left}`));
            if (right) {
                row.push(Markup.button.callback(right, `${BotHandler.MATCHING_DOMAIN_ACTION_PREFIX}:${right}`));
            }
            rows.push(row);
        }

        rows.push(...this.buildMatchingNavButtonsRow(true));
        return Markup.inlineKeyboard(rows);
    }

    private buildMatchingNavButtonsRow(includeBack: boolean): Array<ReturnType<typeof Markup.button.callback>[]> {
        const row: ReturnType<typeof Markup.button.callback>[] = [];
        if (includeBack) {
            row.push(Markup.button.callback('⬅️ Back', BotHandler.MATCHING_BACK));
        }
        row.push(Markup.button.callback('❌ Cancel', BotHandler.MATCHING_CANCEL));
        return [row];
    }

    private buildMatchingNavKeyboard() {
        return Markup.inlineKeyboard(this.buildMatchingNavButtonsRow(true));
    }

    private buildMatchingNoLanguageKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('🔁 Choose Another Language', BotHandler.MATCHING_RETRY_LANG)],
            [Markup.button.callback('⏳ Wait for Counselor', BotHandler.MATCHING_WAIT)]
        ]);
    }

    private async findBestCounselorMatch(
        preferredLanguages: string[],
        requestedDomain: string,
        requesterChatId: number
    ): Promise<{ counselorId: string; counselor: { telegramChatId: number } } | { reason: 'no_language_match' } | null> {
        if (!this.collections) return null;

        const counselors = await this.collections.counselors.find({
            status: 'available',
            isApproved: true,
            isSuspended: false
        }).toArray();

        if (counselors.length === 0) {
            return null;
        }

        const normalizedLanguages = preferredLanguages.map(lang => lang.toLowerCase());
        const normalizedDomain = requestedDomain.toLowerCase();

        const candidates = counselors
            .filter(c => c.telegramChatId !== requesterChatId)
            .map(counselor => {
                const counselorLanguages = (counselor.languagesSpoken ?? []).map((lang: string) => lang.toLowerCase());
                const counselorDomains = (counselor.domainExpertise ?? []).map((domain: string) => domain.toLowerCase());
                const languageMatchCount = counselorLanguages.filter(lang => normalizedLanguages.includes(lang)).length;
                const domainMatch = counselorDomains.includes(normalizedDomain);
                return {
                    counselor,
                    languageMatchCount,
                    domainMatch
                };
            })
            .filter(candidate => candidate.languageMatchCount > 0);

        if (candidates.length === 0) {
            return { reason: 'no_language_match' };
        }

        const exactMatches = candidates.filter(candidate => candidate.domainMatch);
        const pool = exactMatches.length > 0 ? exactMatches : candidates;

        const activeCounts = await Promise.all(
            pool.map(candidate =>
                this.collections!.sessions.countDocuments({
                    counselorId: candidate.counselor.id,
                    isActive: true
                })
            )
        );

        const ranked = pool.map((candidate, index) => {
            const ratingAverage = typeof candidate.counselor.ratingAverage === 'number'
                ? candidate.counselor.ratingAverage
                : 0;
            const sessionsHandled = candidate.counselor.sessionsHandled ?? 0;
            return {
                ...candidate,
                activeCount: activeCounts[index] ?? 0,
                ratingAverage,
                sessionsHandled
            };
        });

        ranked.sort((a, b) => {
            if (a.domainMatch !== b.domainMatch) {
                return a.domainMatch ? -1 : 1;
            }
            if (a.languageMatchCount !== b.languageMatchCount) {
                return b.languageMatchCount - a.languageMatchCount;
            }
            if (a.activeCount !== b.activeCount) {
                return a.activeCount - b.activeCount;
            }
            if (a.ratingAverage !== b.ratingAverage) {
                return b.ratingAverage - a.ratingAverage;
            }
            return a.sessionsHandled - b.sessionsHandled;
        });

        const best = ranked[0];
        return best ? { counselorId: best.counselor.id, counselor: best.counselor } : null;
    }

    private async findPendingRatingSession(userId: string): Promise<Session | null> {
        if (!this.collections) return null;

        return this.collections.sessions
            .find({ userId, isActive: false, ratingScore: { $exists: false } })
            .sort({ endTime: -1 })
            .limit(1)
            .next();
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

    private async sendHistory(ctx: Context, page = 1): Promise<void> {
        await this.handleHistoryList(ctx, page);
    }

    private async handleHistoryList(ctx: Context, page = 1): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager || !this.collections) return;

        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'VIEWING_HISTORY');

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        const query = requesterType === 'user'
            ? { userId: requesterId }
            : {
                $or: [
                    { counselorId: requesterId },
                    { currentCounselorId: requesterId },
                    { previousCounselorId: requesterId },
                    { 'transferHistory.fromCounselorId': requesterId },
                    { 'transferHistory.toCounselorId': requesterId }
                ]
            };

        const sessions = await this.collections.sessions
            .find(query as unknown as Record<string, unknown>)
            .sort({ startTime: -1 })
            .toArray();

        if (sessions.length === 0) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'No session history available.');
            return;
        }

        const { pageItems, safePage, totalPages } = this.getPagination(sessions, page, BotHandler.PAGE_SIZE);

        await ctx.reply(`Session history (${sessions.length}):`);
        for (const session of pageItems) {
            const topic = session.userRequestedDomain ?? 'General Support';
            const date = this.formatTimestamp(session.startTime);
            const status = session.isActive
                ? 'Active'
                : (session.transferCount ?? 0) > 0
                    ? 'Transferred'
                    : 'Completed';
            const message = [
                `Session Topic: ${topic}`,
                `Date: ${date}`,
                `Status: ${status}`
            ].join('\n');

            await ctx.reply(
                message,
                Markup.inlineKeyboard([
                    Markup.button.callback(
                        '💬 See Chat',
                        `${BotHandler.VIEW_HISTORY_CHAT_ACTION_PREFIX}:${session.sessionId}`
                    )
                ])
            );
        }

        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_HISTORY_LIST_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private async sendHistoryChat(ctx: Context, sessionId: string, page = 1): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.userManager || !this.collections) return;

        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'VIEWING_HISTORY');

        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            await this.replyWithMenu(ctx, 'IDLE', 'Session not found.');
            return;
        }

        const { requesterId, requesterType } = await this.resolveRequester(ctx.chat.id);
        const { messages, total } = await this.sessionManager.getMessageHistoryPage(
            session.sessionId,
            requesterId,
            requesterType,
            page,
            BotHandler.HISTORY_CHAT_PAGE_SIZE
        );

        if (total === 0) {
            await this.replyWithMenu(ctx, 'IDLE', 'No messages in this session.');
            return;
        }

        const totalPages = Math.max(1, Math.ceil(total / BotHandler.HISTORY_CHAT_PAGE_SIZE));
        const safePage = Math.min(Math.max(page, 1), totalPages);

        const formatted = messages.map(msg => {
            const senderLabel = msg.senderType === 'user' ? 'User' : 'Counselor';
            const timestamp = msg.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : new Date(msg.timestamp).toISOString();
            return `[${timestamp}] ${senderLabel}: ${msg.content}`;
        });

        await ctx.reply(`Session chat (${total} messages):`);
        await ctx.reply(formatted.join('\n'));
        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_HISTORY_CHAT_ACTION_PREFIX,
            safePage,
            totalPages,
            session.sessionId
        );
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
            session = await this.findRecentSessionByUserId(requesterId);
        }

        if (!session || session.userId !== requesterId) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'No recent session found to report.');
            return;
        }

        const sessionCounselorId = this.getSessionCounselorId(session);
        const report = await this.reportingSystem.submitReport(session.sessionId, sessionCounselorId, reason);
        const counselorChatId = await this.resolveChatId(sessionCounselorId, 'counselor');
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
        if (!ctx.chat || !this.collections || !this.counselorManager || !this.userManager) return;

        const existing = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (existing) {
            const statusMessage = existing.isApproved
                ? 'You are already registered as a counselor.'
                : 'Your counselor application is already submitted and pending admin approval.';
            await ctx.reply(`${statusMessage} Counselor ID: ${existing.id}`);
            return;
        }

        await this.startCounselorOnboarding(ctx);
    }

    private async startCounselorOnboarding(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;

        const telegramUsername = ctx.from?.username?.trim();
        const data: CounselorOnboardingData = {
            languages: [],
            domains: []
        };
        if (telegramUsername && telegramUsername.length > 0) {
            data.telegramUsername = telegramUsername;
        }

        const state: CounselorOnboardingState = {
            step: 'full_name',
            data
        };

        this.counselorOnboardingState.set(ctx.chat.id, state);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'COUNSELOR_ONBOARDING');
        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingText(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat) return;

        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) {
            await this.startCounselorOnboarding(ctx);
            return;
        }

        const trimmed = text.trim();

        switch (state.step) {
            case 'full_name':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter your full name.');
                    return;
                }
                state.data.fullName = trimmed;
                state.step = 'telegram_username';
                if (state.data.telegramUsername) {
                    const username = this.formatTelegramUsername(state.data.telegramUsername);
                    state.step = 'languages';
                    await this.promptCounselorOnboardingStep(
                        ctx,
                        state,
                        `Telegram username detected: ${username}. Now select languages you speak.`
                    );
                } else {
                    await this.promptCounselorOnboardingStep(ctx, state);
                }
                return;
            case 'telegram_username':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter your Telegram username.');
                    return;
                }
                state.data.telegramUsername = this.normalizeTelegramUsername(trimmed);
                state.step = 'languages';
                await this.promptCounselorOnboardingStep(ctx, state);
                return;
            case 'languages_other':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter the language name.');
                    return;
                }
                this.addUniqueSelection(state.data.languages, trimmed);
                state.step = 'languages';
                await this.promptCounselorOnboardingStep(ctx, state, `Added language: ${trimmed}. Select more or tap Done.`);
                return;
            case 'domains_other':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter the domain name.');
                    return;
                }
                this.addUniqueSelection(state.data.domains, trimmed);
                state.step = 'domains';
                await this.promptCounselorOnboardingStep(ctx, state, `Added domain: ${trimmed}. Select more or tap Done.`);
                return;
            case 'experience': {
                const years = Number.parseInt(trimmed, 10);
                if (!Number.isFinite(years) || years <= 0) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter a positive number for years of experience.');
                    return;
                }
                state.data.yearsExperience = years;
                state.step = 'country';
                await this.promptCounselorOnboardingStep(ctx, state);
                return;
            }
            case 'country':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter your country.');
                    return;
                }
                state.data.country = trimmed;
                state.step = 'location';
                await this.promptCounselorOnboardingStep(ctx, state);
                return;
            case 'location':
                if (!trimmed) {
                    await this.promptCounselorOnboardingStep(ctx, state, 'Please enter your city or region.');
                    return;
                }
                state.data.location = trimmed;
                state.step = 'confirm';
                await this.promptCounselorOnboardingStep(ctx, state);
                return;
            case 'languages':
            case 'domains':
            case 'confirm':
                await ctx.reply('Please use the buttons provided to continue.');
                return;
            default:
                await this.promptCounselorOnboardingStep(ctx, state);
        }
    }

    private async handleCounselorOnboardingLanguageSelect(ctx: Context, language: string): Promise<void> {
        if (!ctx.chat) return;
        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        if (language === 'Other') {
            state.step = 'languages_other';
            await this.promptCounselorOnboardingStep(ctx, state);
            return;
        }

        this.toggleSelection(state.data.languages, language);
        state.step = 'languages';
        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingDomainSelect(ctx: Context, domain: string): Promise<void> {
        if (!ctx.chat) return;
        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        if (domain === 'Other') {
            state.step = 'domains_other';
            await this.promptCounselorOnboardingStep(ctx, state);
            return;
        }

        this.toggleSelection(state.data.domains, domain);
        state.step = 'domains';
        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingLanguagesDone(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        if (state.data.languages.length === 0) {
            state.step = 'languages';
            await this.promptCounselorOnboardingStep(ctx, state, 'Please select at least one language.');
            return;
        }

        state.step = 'domains';
        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingDomainsDone(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        if (state.data.domains.length === 0) {
            state.step = 'domains';
            await this.promptCounselorOnboardingStep(ctx, state, 'Please select at least one domain.');
            return;
        }

        state.step = 'experience';
        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingBack(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        switch (state.step) {
            case 'languages_other':
                state.step = 'languages';
                break;
            case 'domains_other':
                state.step = 'domains';
                break;
            case 'confirm':
                state.step = 'location';
                break;
            case 'location':
                state.step = 'country';
                break;
            case 'country':
                state.step = 'experience';
                break;
            case 'experience':
                state.step = 'domains';
                break;
            case 'domains':
                state.step = 'languages';
                break;
            case 'languages':
                state.step = 'telegram_username';
                break;
            case 'telegram_username':
                state.step = 'full_name';
                break;
            case 'full_name':
                await this.promptCounselorOnboardingStep(ctx, state, 'You are already at the first step.');
                return;
            default:
                state.step = 'full_name';
        }

        await this.promptCounselorOnboardingStep(ctx, state);
    }

    private async handleCounselorOnboardingCancel(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager) return;
        this.counselorOnboardingState.delete(ctx.chat.id);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', 'Counselor registration canceled.');
    }

    private async handleCounselorOnboardingConfirm(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.userManager || !this.collections || !this.counselorManager || !this.bot) return;

        const state = this.counselorOnboardingState.get(ctx.chat.id);
        if (!state) return;

        const existing = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (existing) {
            this.counselorOnboardingState.delete(ctx.chat.id);
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'You are already registered as a counselor.');
            return;
        }

        const { fullName, telegramUsername, languages, domains, yearsExperience, country, location } = state.data;
        if (!fullName || !telegramUsername || languages.length === 0 || domains.length === 0 || !yearsExperience || !country || !location) {
            this.counselorOnboardingState.delete(ctx.chat.id);
            await ctx.reply('Some information was missing, so the onboarding has been restarted.');
            await this.startCounselorOnboarding(ctx);
            return;
        }

        const counselorId = await this.counselorManager.createCounselor(ctx.chat.id, {
            fullName,
            telegramUsername,
            languagesSpoken: languages,
            domainExpertise: domains,
            yearsExperience,
            country,
            location
        });

        const formattedUsername = this.formatTelegramUsername(telegramUsername);
        const adminMessage = [
            '🧑‍⚕️ New Counselor Application',
            `ID: ${counselorId}`,
            `Full Name: ${fullName}`,
            `Telegram: ${formattedUsername}`,
            `Languages: ${languages.join(', ')}`,
            `Expertise: ${domains.join(', ')}`,
            `Experience: ${yearsExperience} years`,
            `Country: ${country}`,
            `Location: ${location}`,
            'Status: Pending Admin Approval'
        ].join('\n');

        for (const adminChatId of this.config.adminChatIds) {
            try {
                await this.bot.telegram.sendMessage(
                    adminChatId,
                    adminMessage,
                    Markup.inlineKeyboard([
                        Markup.button.callback(
                            '✅ Approve Counselor',
                            `${BotHandler.APPROVE_COUNSELOR_ACTION_PREFIX}:${counselorId}`
                        )
                    ])
                );
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to notify admin about counselor application', {
                    counselorId,
                    message: err.message
                });
            }
        }

        this.counselorOnboardingState.delete(ctx.chat.id);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(
            ctx,
            'IDLE',
            `Your counselor application has been submitted. Counselor ID: ${counselorId}. Status: Pending Admin Approval.`
        );
    }

    private async promptCounselorOnboardingStep(
        ctx: Context,
        state: CounselorOnboardingState,
        message?: string
    ): Promise<void> {
        if (!ctx.chat) return;

        switch (state.step) {
            case 'full_name': {
                const text = message ?? 'Please enter your full name.';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'telegram_username': {
                const current = state.data.telegramUsername
                    ? `Current: ${this.formatTelegramUsername(state.data.telegramUsername)}`
                    : undefined;
                const text = message ?? [
                    'Please enter your Telegram username.',
                    current ? current : ''
                ].filter(Boolean).join('\n');
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'languages': {
                const text = message ?? 'Select the languages you speak (multi-select). Tap Done when finished.';
                await ctx.reply(
                    text,
                    this.buildOnboardingMultiSelectKeyboard(
                        BotHandler.COUNSELOR_LANGUAGES,
                        state.data.languages,
                        BotHandler.COUNSELOR_ONBOARDING_LANG_ACTION_PREFIX,
                        BotHandler.COUNSELOR_ONBOARDING_LANG_DONE
                    )
                );
                return;
            }
            case 'languages_other': {
                const text = message ?? 'Please type the other language you speak.';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'domains': {
                const text = message ?? 'Select your counseling domain expertise (multi-select). Tap Done when finished.';
                await ctx.reply(
                    text,
                    this.buildOnboardingMultiSelectKeyboard(
                        BotHandler.COUNSELOR_DOMAINS,
                        state.data.domains,
                        BotHandler.COUNSELOR_ONBOARDING_DOMAIN_ACTION_PREFIX,
                        BotHandler.COUNSELOR_ONBOARDING_DOMAIN_DONE
                    )
                );
                return;
            }
            case 'domains_other': {
                const text = message ?? 'Please type the other counseling domain.';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'experience': {
                const text = message ?? 'How many years of counseling experience do you have? (number only)';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'country': {
                const text = message ?? 'Please enter your country.';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'location': {
                const text = message ?? 'Please enter your city or region.';
                await ctx.reply(text, Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
                return;
            }
            case 'confirm': {
                const summary = this.buildCounselorOnboardingSummary(state.data);
                const text = message ?? `${summary}\n\nConfirm submission?`;
                await ctx.reply(text, this.buildOnboardingConfirmKeyboard());
                return;
            }
            default:
                await ctx.reply('Let\'s continue your counselor application.', Markup.inlineKeyboard(this.buildOnboardingNavButtons()));
        }
    }

    private buildOnboardingNavButtons(includeBack = true): Array<ReturnType<typeof Markup.button.callback>[]> {
        const row: ReturnType<typeof Markup.button.callback>[] = [];
        if (includeBack) {
            row.push(Markup.button.callback('⬅️ Back', BotHandler.COUNSELOR_ONBOARDING_BACK));
        }
        row.push(Markup.button.callback('❌ Cancel', BotHandler.COUNSELOR_ONBOARDING_CANCEL));
        return [row];
    }

    private buildOnboardingMultiSelectKeyboard(
        options: string[],
        selected: string[],
        togglePrefix: string,
        doneAction: string
    ) {
        const rows: Array<ReturnType<typeof Markup.button.callback>[]> = [];
        const selectedSet = new Set(selected);

        for (let i = 0; i < options.length; i += 2) {
            const left = options[i];
            const right = options[i + 1];
            const row: ReturnType<typeof Markup.button.callback>[] = [];
            const leftLabel = selectedSet.has(left) ? `✅ ${left}` : left;
            row.push(Markup.button.callback(leftLabel, `${togglePrefix}:${left}`));
            if (right) {
                const rightLabel = selectedSet.has(right) ? `✅ ${right}` : right;
                row.push(Markup.button.callback(rightLabel, `${togglePrefix}:${right}`));
            }
            rows.push(row);
        }

        rows.push([Markup.button.callback('✅ Done', doneAction)]);
        rows.push(...this.buildOnboardingNavButtons());

        return Markup.inlineKeyboard(rows);
    }

    private buildOnboardingConfirmKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('✅ Submit Application', BotHandler.COUNSELOR_ONBOARDING_CONFIRM)],
            ...this.buildOnboardingNavButtons()
        ]);
    }

    private buildCounselorOnboardingSummary(data: CounselorOnboardingData): string {
        const telegram = data.telegramUsername ? this.formatTelegramUsername(data.telegramUsername) : 'N/A';
        return [
            '🧑‍⚕️ Counselor Application Summary',
            `Full Name: ${data.fullName ?? 'N/A'}`,
            `Telegram: ${telegram}`,
            `Languages: ${data.languages.join(', ') || 'N/A'}`,
            `Expertise: ${data.domains.join(', ') || 'N/A'}`,
            `Experience: ${data.yearsExperience ?? 'N/A'} years`,
            `Country: ${data.country ?? 'N/A'}`,
            `Location: ${data.location ?? 'N/A'}`
        ].join('\n');
    }

    private toggleSelection(values: string[], value: string): void {
        const index = values.indexOf(value);
        if (index >= 0) {
            values.splice(index, 1);
            return;
        }
        values.push(value);
    }

    private addUniqueSelection(values: string[], value: string): void {
        if (!values.includes(value)) {
            values.push(value);
        }
    }

    private normalizeTelegramUsername(value: string): string {
        const trimmed = value.trim();
        return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    }

    private formatTelegramUsername(value: string): string {
        const normalized = this.normalizeTelegramUsername(value);
        return normalized ? `@${normalized}` : value;
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

    private async handlePendingReports(ctx: Context, page = 1): Promise<void> {
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

        const { pageItems, safePage, totalPages } = this.getPagination(reports, page, BotHandler.PAGE_SIZE);

        await ctx.reply(`Pending reports (${reports.length}):`);
        for (const report of pageItems) {
            const submittedAt = report.timestamp instanceof Date
                ? report.timestamp.toISOString()
                : new Date(report.timestamp).toISOString();
            const message = [
                '🚩 Pending Report',
                `Report ID: ${report.reportId}`,
                `Counselor ID: ${report.counselorId}`,
                `Reason: ${report.reason}`,
                `Submitted: ${submittedAt}`
            ].join('\n');

            await ctx.reply(
                message,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback(
                            '💬 View Chat',
                            `${BotHandler.VIEW_REPORT_CHAT_ACTION_PREFIX}:${report.reportId}`
                        )
                    ],
                    [
                        Markup.button.callback(
                            '⚠️ Strike',
                            `${BotHandler.PROCESS_REPORT_ACTION_PREFIX}:${report.reportId}:s`
                        ),
                        Markup.button.callback(
                            '✅ Dismiss',
                            `${BotHandler.PROCESS_REPORT_ACTION_PREFIX}:${report.reportId}:d`
                        )
                    ]
                ])
            );
        }

        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_REPORTS_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private async handleViewReportChat(ctx: Context, reportId: string): Promise<void> {
        if (!ctx.chat || !this.sessionManager || !this.collections) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized view report chat access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view report chats.');
            return;
        }

        const report = await this.collections.reports.findOne({ reportId });
        if (!report) {
            await ctx.reply('Report not found.');
            return;
        }

        try {
            const messages = await this.sessionManager.getMessageHistoryForAdmin(report.sessionId);
            if (messages.length === 0) {
                await ctx.reply(
                    `No messages in session ${report.sessionId}.\n\nReport: ${report.reason}`
                );
                return;
            }

            const formatted = messages.map(msg => {
                const senderLabel = msg.senderType === 'user' ? 'User' : 'Counselor';
                const ts = msg.timestamp instanceof Date
                    ? msg.timestamp.toISOString()
                    : new Date(msg.timestamp).toISOString();
                return `[${ts}] ${senderLabel}: ${msg.content}`;
            });

            const header = `💬 Session chat (Report ID: ${report.reportId}, Counselor: ${report.counselorId})\nReason: ${report.reason}\n\n`;
            const fullText = header + formatted.join('\n');

            const TELEGRAM_MAX_LENGTH = 4096;
            if (fullText.length <= TELEGRAM_MAX_LENGTH) {
                await ctx.reply(fullText);
            } else {
                await ctx.reply(header.trim());
                let currentChunk = '';
                for (const line of formatted) {
                    if (currentChunk.length + line.length + 1 > TELEGRAM_MAX_LENGTH && currentChunk) {
                        await ctx.reply(currentChunk);
                        currentChunk = '';
                    }
                    currentChunk += (currentChunk ? '\n' : '') + line;
                }
                if (currentChunk) {
                    await ctx.reply(currentChunk);
                }
            }
        } catch (error) {
            const err = error as Error;
            logger.error('Failed to fetch report chat', { reportId, message: err.message });
            await ctx.reply(`Failed to load chat: ${err.message}`);
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

        await this.processReportAction(ctx, reportId, action);
    }

    private async handleCounselorList(ctx: Context, page = 1): Promise<void> {
        if (!ctx.chat || !this.counselorManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized counselor list access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view counselors.');
            return;
        }

        const counselors = await this.counselorManager.listCounselors();
        if (counselors.length === 0) {
            await ctx.reply('No counselors found.');
            return;
        }

        const { pageItems, safePage, totalPages } = this.getPagination(counselors, page, BotHandler.PAGE_SIZE);

        await ctx.reply(`Counselors (${counselors.length}):`);

        for (const counselor of pageItems) {
            const message = [
                '🧑‍⚕️ Counselor',
                `ID: ${counselor.counselorId}`,
                `Status: ${counselor.status}`,
                `Approved: ${counselor.isApproved ? 'Yes' : 'No'}`,
                `Suspended: ${counselor.isSuspended ? 'Yes' : 'No'}`,
                `Strikes: ${counselor.strikes}`,
                `Sessions: ${counselor.sessionsHandled}`
            ].join('\n');

            const buttons = [] as ReturnType<typeof Markup.button.callback>[];
            if (!counselor.isApproved) {
                buttons.push(
                    Markup.button.callback(
                        '✅ Approve',
                        `${BotHandler.REAPPROVE_ACTION_PREFIX}:${counselor.counselorId}`
                    )
                );
            } else if (counselor.isSuspended) {
                buttons.push(
                    Markup.button.callback(
                        '♻️ Revoke Suspension',
                        `${BotHandler.REVOKE_SUSPENSION_ACTION_PREFIX}:${counselor.counselorId}`
                    )
                );
            }

            const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : undefined;
            if (keyboard) {
                await ctx.reply(message, keyboard);
            } else {
                await ctx.reply(message);
            }
        }

        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_COUNSELORS_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private async handleAppealStart(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.collections || !this.userManager) return;

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isSuspended) {
            await ctx.reply('Appeals are only available for suspended counselors.');
            return;
        }

        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'APPEALING');
        await this.replyWithMenu(ctx, 'APPEALING', 'Please enter your appeal message to the admins.');
    }

    private async handleAppealMessage(ctx: Context, text: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.userManager) return;

        const message = text.trim();
        if (!message) {
            await this.replyWithMenu(ctx, 'APPEALING', 'Please enter your appeal message to the admins.');
            return;
        }

        const counselor = await this.collections.counselors.findOne({ telegramChatId: ctx.chat.id });
        if (!counselor || !counselor.isSuspended) {
            await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
            await this.replyWithMenu(ctx, 'IDLE', 'Appeals are only available for suspended counselors.');
            return;
        }

        const appeal = {
            appealId: generateAppealId(),
            counselorId: counselor.id,
            message,
            strikes: counselor.strikes ?? 0,
            timestamp: new Date(),
            processed: false
        };

        await this.collections.appeals.insertOne(appeal);
        await this.userManager.updateUserStateByTelegramId(ctx.chat.id, 'IDLE');
        await this.replyWithMenu(ctx, 'IDLE', `Appeal submitted. Reference: ${appeal.appealId}`);
    }

    private async handleAppeals(ctx: Context, page = 1): Promise<void> {
        if (!ctx.chat || !this.collections) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized appeals access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view appeals.');
            return;
        }

        const appeals = await this.collections.appeals
            .find({ processed: false })
            .sort({ timestamp: -1 })
            .toArray();

        if (appeals.length === 0) {
            await ctx.reply('No pending appeals.');
            return;
        }

        const { pageItems, safePage, totalPages } = this.getPagination(appeals, page, BotHandler.PAGE_SIZE);

        await ctx.reply(`Pending appeals (${appeals.length}):`);

        for (const appeal of pageItems) {
            const submittedAt = appeal.timestamp instanceof Date
                ? appeal.timestamp.toISOString()
                : new Date(appeal.timestamp).toISOString();
            const message = [
                '🧾 Appeal',
                `Appeal ID: ${appeal.appealId}`,
                `Counselor ID: ${appeal.counselorId}`,
                `Strikes: ${appeal.strikes}`,
                `Message: ${appeal.message}`,
                `Submitted: ${submittedAt}`
            ].join('\n');

            await ctx.reply(
                message,
                Markup.inlineKeyboard([
                    Markup.button.callback(
                        '♻️ Revoke Suspension',
                        `${BotHandler.APPEAL_ACTION_PREFIX}:${appeal.appealId}:r`
                    ),
                    Markup.button.callback(
                        '✅ Approve',
                        `${BotHandler.APPEAL_ACTION_PREFIX}:${appeal.appealId}:a`
                    )
                ])
            );
        }

        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_APPEALS_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private async processAppealAction(ctx: Context, appealId: string, action: 'revoke' | 'approve'): Promise<void> {
        if (!ctx.chat || !this.collections || !this.auditLogManager || !this.counselorManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized appeal action access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to process appeals.');
            return;
        }

        const appeal = await this.collections.appeals.findOne({ appealId });
        if (!appeal) {
            await ctx.reply('Appeal not found.');
            return;
        }

        if (appeal.processed) {
            await ctx.reply('Appeal already processed.');
            return;
        }

        const counselor = await this.collections.counselors.findOne({ id: appeal.counselorId });
        if (!counselor) {
            await ctx.reply('Counselor not found for this appeal.');
            return;
        }

        if (action === 'approve') {
            await this.counselorManager.approveCounselor(ctx.chat.id.toString(), counselor.id);
            await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'appeal_approve', counselor.id);
            await ctx.reply(`Appeal approved. Counselor ${counselor.id} is approved.`);
        } else {
            const result = await this.collections.counselors.updateOne(
                { id: counselor.id },
                { $set: { isSuspended: false, isApproved: true, status: 'away', lastActive: new Date(), strikes: 0 } }
            );

            if (result.matchedCount === 0) {
                await ctx.reply('Counselor not found.');
                return;
            }

            await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'appeal_revoke_suspension', counselor.id);
            await ctx.reply(`Appeal processed. Suspension revoked for counselor ${counselor.id}.`);
        }

        await this.collections.appeals.updateOne(
            { appealId },
            {
                $set: {
                    processed: true,
                    processedAt: new Date(),
                    processedBy: ctx.chat.id.toString(),
                    action
                }
            }
        );

        if (counselor.telegramChatId && this.bot) {
            const notification = action === 'approve'
                ? 'Your appeal has been approved. Your counseling access has been restored.'
                : 'Your appeal has been reviewed. Your suspension has been revoked.';
            try {
                await this.sendMenuToChatId(counselor.telegramChatId, 'IDLE', notification);
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to notify counselor about appeal decision', {
                    counselorId: counselor.id,
                    message: err.message
                });
            }
        }
    }

    private async handleRevokeSuspension(ctx: Context, counselorId: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized revoke suspension access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to update counselors.');
            return;
        }

        const result = await this.collections.counselors.updateOne(
            { id: counselorId },
            { $set: { isSuspended: false, isApproved: true, status: 'away', lastActive: new Date(), strikes: 0 } }
        );

        if (result.matchedCount === 0) {
            await ctx.reply('Counselor not found.');
            return;
        }

        await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'revoke_suspension', counselorId);
        await ctx.reply(`Suspension revoked for counselor ${counselorId}.`);

        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (counselor?.telegramChatId && this.bot) {
            try {
                await this.sendMenuToChatId(
                    counselor.telegramChatId,
                    'IDLE',
                    'Your suspension has been revoked. You can now set your status again.'
                );
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to notify counselor suspension revoke', {
                    counselorId,
                    message: err.message
                });
            }
        }
    }

    private async handleReapproveCounselor(ctx: Context, counselorId: string): Promise<void> {
        if (!ctx.chat || !this.collections || !this.counselorManager || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized reapprove access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to approve counselors.');
            return;
        }

        await this.counselorManager.approveCounselor(ctx.chat.id.toString(), counselorId);
        await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'reapprove_counselor', counselorId);
        await ctx.reply(`Counselor ${counselorId} approved.`);

        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (counselor?.telegramChatId && this.bot) {
            try {
                await this.bot.telegram.sendMessage(
                    counselor.telegramChatId,
                    'Your counseling access has been restored. You can now set your status and receive sessions.'
                );
            } catch (error) {
                const err = error as Error;
                logger.warn('Failed to notify counselor reapproval', {
                    counselorId,
                    message: err.message
                });
            }
        }
    }

    private async processReportAction(ctx: Context, reportId: string, action: 'strike' | 'dismiss'): Promise<void> {
        if (!ctx.chat || !this.reportingSystem || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized process_report access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to process reports.');
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

        if (action === 'strike' && this.collections && this.bot) {
            const counselor = await this.collections.counselors.findOne({ id: report.counselorId });
            if (counselor?.telegramChatId && (counselor.isSuspended || counselor.isApproved === false)) {
                const message = counselor.isApproved === false
                    ? 'Your counseling access has been revoked due to report strikes. Please contact an admin.'
                    : 'Your counselor account has been suspended due to report strikes. Please contact an admin.';
                try {
                    await this.bot.telegram.sendMessage(counselor.telegramChatId, message);
                } catch (error) {
                    const err = error as Error;
                    logger.warn('Failed to notify counselor suspension status', {
                        counselorId: report.counselorId,
                        message: err.message
                    });
                }
            }
        }
    }

    private async handleApproveCounselor(ctx: Context, counselorId?: string, page = 1): Promise<void> {
        if (!ctx.chat || !this.collections || !this.counselorManager || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized approve_counselor access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to approve counselors.');
            return;
        }

        if (!counselorId) {
            const pending = await this.collections.counselors
                .find({
                    $or: [
                        { isApproved: false },
                        { isApproved: { $exists: false } },
                        { is_approved: false },
                        { is_approved: { $exists: false } }
                    ]
                } as unknown as Record<string, unknown>)
                .sort({ createdAt: -1 })
                .toArray();

            if (pending.length === 0) {
                await ctx.reply('No counselors awaiting approval.');
                return;
            }

            const { pageItems, safePage, totalPages } = this.getPagination(pending, page, BotHandler.PAGE_SIZE);

            await ctx.reply(`Pending counselor approvals (${pending.length}):`);
            for (const counselor of pageItems) {
                const legacyCounselorId = 'counselorId' in counselor
                    ? (counselor as { counselorId?: string }).counselorId
                    : undefined;
                const counselorId = counselor.id ?? legacyCounselorId;
                if (!counselorId) {
                    logger.warn('Pending counselor missing id', { counselor });
                    continue;
                }

                const message = `ID: ${counselorId} | Status: ${counselor.status} | Strikes: ${counselor.strikes}`;
                await ctx.reply(
                    message,
                    Markup.inlineKeyboard([
                        Markup.button.callback(
                            '✅ Approve Counselor',
                            `${BotHandler.APPROVE_COUNSELOR_ACTION_PREFIX}:${counselorId}`
                        )
                    ])
                );
            }

            await this.sendPaginationControls(
                ctx,
                BotHandler.PAGINATE_APPROVALS_ACTION_PREFIX,
                safePage,
                totalPages
            );
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

    private async handleRemoveCounselor(ctx: Context, counselorId?: string, page = 1): Promise<void> {
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

            const { pageItems, safePage, totalPages } = this.getPagination(counselors, page, BotHandler.PAGE_SIZE);

            await ctx.reply(`Counselors (${counselors.length}):`);

            for (const counselor of pageItems) {
                const message = [
                    '🧑‍⚕️ Counselor',
                    `ID: ${counselor.counselorId}`,
                    `Status: ${counselor.status}`,
                    `Strikes: ${counselor.strikes}`
                ].join('\n');

                await ctx.reply(
                    message,
                    Markup.inlineKeyboard([
                        Markup.button.callback(
                            '🗑️ Remove Counselor',
                            `${BotHandler.REMOVE_COUNSELOR_ACTION_PREFIX}:${counselor.counselorId}`
                        )
                    ])
                );
            }

            await this.sendPaginationControls(
                ctx,
                BotHandler.PAGINATE_REMOVALS_ACTION_PREFIX,
                safePage,
                totalPages
            );

            return;
        }

        await this.counselorManager.removeCounselor(ctx.chat.id.toString(), counselorId);
        await this.auditLogManager.recordAdminAction(ctx.chat.id.toString(), 'remove_counselor', counselorId);
        await ctx.reply(`Counselor ${counselorId} removed.`);
    }

    private async handleAuditLog(ctx: Context, limitArg?: string, page = 1): Promise<void> {
        if (!ctx.chat || !this.auditLogManager) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized audit_log access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to view audit logs.');
            return;
        }

        if (limitArg) {
            const limit = Math.min(Math.max(parseInt(limitArg, 10) || 20, 1), 100);
            const logs = await this.auditLogManager.getRecentAdminActions(limit);
            if (logs.length === 0) {
                await ctx.reply('No audit log entries found.');
                return;
            }

            const { pageItems, safePage, totalPages } = this.getPagination(logs, page, BotHandler.PAGE_SIZE);
            const formatted = pageItems.map(log => this.formatAuditLogEntry(log));

            await ctx.reply(`🧾 Audit log (${logs.length}):`);
            await ctx.reply(formatted.join('\n\n'));
            await this.sendPaginationControls(
                ctx,
                BotHandler.PAGINATE_AUDIT_ACTION_PREFIX,
                safePage,
                totalPages,
                limitArg
            );
            return;
        }

        const { logs, total } = await this.auditLogManager.getAdminActionsPage(page, BotHandler.PAGE_SIZE);
        if (total === 0) {
            await ctx.reply('No audit log entries found.');
            return;
        }

        const totalPages = Math.max(1, Math.ceil(total / BotHandler.PAGE_SIZE));
        const safePage = Math.min(Math.max(page, 1), totalPages);
        const formatted = logs.map(log => this.formatAuditLogEntry(log));

        await ctx.reply(`🧾 Audit log (${total}):`);
        await ctx.reply(formatted.join('\n\n'));
        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_AUDIT_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private async handleBroadcastStart(ctx: Context): Promise<void> {
        if (!ctx.chat) return;
        if (!this.isAdmin(ctx.chat.id)) {
            logger.warn('Unauthorized broadcast access', { chatId: ctx.chat.id });
            await ctx.reply('You are not authorized to send broadcasts.');
            return;
        }

        this.broadcastState.set(ctx.chat.id, { step: 'target' });
        await ctx.reply(
            'Who should receive this announcement?',
            Markup.keyboard([
                [BotHandler.BROADCAST_TARGET_USERS, BotHandler.BROADCAST_TARGET_COUNSELORS],
                [BotHandler.BROADCAST_TARGET_EVERYONE],
                [BotHandler.BROADCAST_CANCEL]
            ]).resize().oneTime()
        );
    }

    private async handleBroadcastFlowText(ctx: Context): Promise<boolean> {
        if (!ctx.chat || !ctx.message || !('text' in ctx.message)) return false;

        const text = ctx.message.text;
        if (!text) return false;

        const state = this.broadcastState.get(ctx.chat.id);
        if (!state) return false;

        if (!this.isAdmin(ctx.chat.id)) {
            this.broadcastState.delete(ctx.chat.id);
            return false;
        }

        if (state.step === 'target') {
            if (text === BotHandler.BROADCAST_CANCEL) {
                this.broadcastState.delete(ctx.chat.id);
                const role = await this.getMenuRole(ctx.chat.id);
                await ctx.reply('Broadcast cancelled.', this.buildMenu('IDLE', role));
                return true;
            }

            let target: BroadcastTarget | undefined;
            if (text === BotHandler.BROADCAST_TARGET_USERS) target = 'users';
            else if (text === BotHandler.BROADCAST_TARGET_COUNSELORS) target = 'counselors';
            else if (text === BotHandler.BROADCAST_TARGET_EVERYONE) target = 'everyone';

            if (!target) {
                await ctx.reply('Please select a valid option: Users, Counselors, Everyone, or Cancel.');
                return true;
            }

            state.step = 'message';
            state.target = target;
            this.broadcastState.set(ctx.chat.id, state);
            await ctx.reply('Please type the announcement message:', Markup.removeKeyboard());
            return true;
        }

        if (state.step === 'message') {
            const message = text.trim();
            if (!message) {
                await ctx.reply('Please enter a non-empty message.');
                return true;
            }

            state.message = message;
            this.broadcastState.set(ctx.chat.id, state);
            await ctx.reply(
                `Preview:\n\n${message}\n\nSend broadcast?`,
                Markup.inlineKeyboard([
                    Markup.button.callback('✅ Send', BotHandler.BROADCAST_ACTION_CONFIRM),
                    Markup.button.callback('❌ Cancel', BotHandler.BROADCAST_ACTION_CANCEL)
                ])
            );
            return true;
        }

        return false;
    }

    private async handleBroadcastConfirm(ctx: Context): Promise<void> {
        if (!ctx.chat || !this.broadcastManager) return;

        const state = this.broadcastState.get(ctx.chat.id);
        if (!state || !state.target || !state.message) {
            await ctx.reply('Broadcast session expired. Please start again.');
            this.broadcastState.delete(ctx.chat.id);
            return;
        }

        const role = await this.getMenuRole(ctx.chat.id);
        await ctx.reply('Sending broadcast...');

        try {
            const { successCount, failedCount } = await this.broadcastManager.executeBroadcast(
                ctx.chat.id,
                state.target,
                state.message
            );
            this.broadcastState.delete(ctx.chat.id);
            await ctx.reply(
                `Broadcast sent. Success: ${successCount}, Failed: ${failedCount}`,
                this.buildMenu('IDLE', role)
            );
        } catch (error) {
            const err = error as Error;
            logger.error('Broadcast failed', { message: err.message, stack: err.stack });
            this.broadcastState.delete(ctx.chat.id);
            await ctx.reply(
                `Broadcast failed: ${err.message}. Please try again.`,
                this.buildMenu('IDLE', role)
            );
        }
    }

    private async handleBroadcastCancelAction(ctx: Context): Promise<void> {
        if (!ctx.chat) return;

        this.broadcastState.delete(ctx.chat.id);
        const role = await this.getMenuRole(ctx.chat.id);
        await ctx.reply('Broadcast cancelled.', this.buildMenu('IDLE', role));
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
            '/available | /away - Set counselor availability',
            '/my_stats - View counselor statistics',
            '/list_of_prayer_requests - View prayer requests',
            '/close_prayer <prayerId> - Close a prayer request',
            '🔁 Transfer Session to Expert - Transfer an active session (menu)'
        ];

        const adminCommands = [
            '/admin_stats - View system statistics (admins)',
            '/pending_reports - List pending reports (admins)',
            '/process_report <reportId> <strike|dismiss> - Process report (admins)',
            '/approve_counselor <counselorId> - Approve counselor (admins)',
            '/remove_counselor <counselorId> - Remove counselor (admins)',
            '/audit_log [limit] - View admin audit log (admins)',
            '📢 Broadcast Message - Send system announcements (menu only, admins)'
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

    private async sendPrayerRequestsToCounselor(ctx: Context, page = 1): Promise<void> {
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

        const { pageItems, safePage, totalPages } = this.getPagination(prayers, page, BotHandler.PAGE_SIZE);

        await ctx.reply(`Prayer requests (${prayers.length}):`);

        for (const prayer of pageItems) {
            const submittedAt = prayer.createdAt.toISOString();
            const message = [
                '🙏 Prayer Request',
                `Title: ${prayer.title}`,
                `ID: ${prayer.prayerId}`,
                `Submitted: ${submittedAt}`
            ].join('\n');

            await ctx.reply(
                message,
                Markup.inlineKeyboard([
                    Markup.button.callback('✅ Close Prayer', `${BotHandler.CLOSE_PRAYER_ACTION_PREFIX}:${prayer.prayerId}`)
                ])
            );
        }

        await this.sendPaginationControls(
            ctx,
            BotHandler.PAGINATE_PRAYERS_ACTION_PREFIX,
            safePage,
            totalPages
        );
    }

    private getPagination<T>(items: T[], page: number, pageSize: number): {
        pageItems: T[];
        safePage: number;
        totalPages: number;
    } {
        const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
        const safePage = Math.min(Math.max(page, 1), totalPages);
        const start = (safePage - 1) * pageSize;
        return {
            pageItems: items.slice(start, start + pageSize),
            safePage,
            totalPages
        };
    }

    private buildPageCallback(prefix: string, page: number, token?: string): string {
        return token ? `${prefix}:${page}:${token}` : `${prefix}:${page}`;
    }

    private async sendPaginationControls(
        ctx: Context,
        prefix: string,
        page: number,
        totalPages: number,
        token?: string
    ): Promise<void> {
        if (totalPages <= 1) {
            return;
        }

        const buttons = [] as ReturnType<typeof Markup.button.callback>[];
        if (page > 1) {
            buttons.push(
                Markup.button.callback(
                    '⬅️ Previous',
                    this.buildPageCallback(prefix, page - 1, token)
                )
            );
        }

        if (page < totalPages) {
            buttons.push(
                Markup.button.callback(
                    'Next ➡️',
                    this.buildPageCallback(prefix, page + 1, token)
                )
            );
        }

        if (buttons.length > 0) {
            await ctx.reply(`Page ${page}/${totalPages}`, Markup.inlineKeyboard(buttons));
        }
    }

    private formatAuditLogEntry(log: AuditLog): string {
        const timestamp = this.formatTimestamp(log.timestamp);
        const action = this.formatAuditAction(log.action);
        const lines = [
            '📌 Audit Entry',
            `Time: ${timestamp}`,
            `Action: ${action}`,
            `Admin: ${log.adminId}`
        ];

        if (log.targetId) {
            lines.push(`Target: ${log.targetId}`);
        }

        const details = this.formatAuditDetails(log.details);
        if (details) {
            lines.push(`Details: ${details}`);
        }

        return lines.join('\n');
    }

    private formatTimestamp(timestamp: Date | string): string {
        const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
        return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }

    private formatAuditAction(action: string): string {
        return action
            .replace(/_/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    private formatAuditDetails(details?: Record<string, unknown>): string | null {
        if (!details) {
            return null;
        }

        const entries = Object.entries(details);
        if (entries.length === 0) {
            return null;
        }

        const formatted = entries.map(([key, value]) => {
            const label = key.replace(/_/g, ' ');
            return `${label}: ${this.formatDetailValue(value)}`;
        });

        return formatted.join(', ');
    }

    private formatDetailValue(value: unknown): string {
        if (value === null || value === undefined) {
            return 'N/A';
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return this.trimText(String(value), 120);
        }

        try {
            return this.trimText(JSON.stringify(value), 120);
        } catch {
            return 'Unsupported';
        }
    }

    private trimText(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }

        return `${text.slice(0, maxLength - 1)}…`;
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

    private getSessionCounselorId(session: Session): string {
        return session.currentCounselorId ?? session.counselorId;
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
                .find({ $or: [{ counselorId: counselor.id }, { currentCounselorId: counselor.id }] } as unknown as Record<string, unknown>)
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

    private async findRecentSessionByUserId(userId: string): Promise<Session | null> {
        if (!this.collections) {
            throw new Error('BotHandler not initialized.');
        }

        return this.collections.sessions
            .find({ userId })
            .sort({ startTime: -1 })
            .limit(1)
            .next();
    }

    private extractCommandText(text: string | undefined, command: string): string {
        if (!text) return '';
        const trimmed = text.replace(`/${command}`, '').trim();
        return trimmed;
    }

    private buildMenu(state: UserState, role: 'user' | 'counselor' | 'admin' | 'suspended') {
        const baseRows = state === 'IN_SESSION'
            ? this.getSessionMenuRows()
            : state === 'REPORTING' || state === 'POST_SESSION'
                ? this.getPostSessionMenuRows()
                : this.getMainMenuRows(role);

        const roleRows = this.getRoleMenuRows(role);

        return Markup.keyboard([
            ...baseRows,
            ...roleRows
        ]).resize().persistent();
    }

    private getMainMenuRows(role: 'user' | 'counselor' | 'admin' | 'suspended'): string[][] {
        const rows: string[][] = [];

        if (role === 'user') {
            rows.push([BotHandler.MENU_START_COUNSELING]);
        }

        rows.push([BotHandler.MENU_SUBMIT_PRAYER]);
        rows.push([BotHandler.MENU_HISTORY, BotHandler.MENU_HELP]);
        rows.push([BotHandler.MENU_MAIN]);

        return rows;
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

    private getRoleMenuRows(role: 'user' | 'counselor' | 'admin' | 'suspended'): string[][] {
        const counselorRows = [
            [BotHandler.MENU_REGISTER_COUNSELOR],
            [BotHandler.MENU_STATUS_AVAILABLE, BotHandler.MENU_STATUS_AWAY],
            [BotHandler.MENU_MY_STATS],
            [BotHandler.MENU_PRAYER_REQUESTS],
            [BotHandler.MENU_CLOSE_PRAYER],
            [BotHandler.MENU_TRANSFER_SESSION]
        ];

        const adminRows = [
            [BotHandler.MENU_ADMIN_STATS],
            [BotHandler.MENU_PENDING_REPORTS],
            [BotHandler.MENU_COUNSELOR_LIST],
            [BotHandler.MENU_APPEALS],
            [BotHandler.MENU_APPROVE_COUNSELOR],
            [BotHandler.MENU_REMOVE_COUNSELOR],
            [BotHandler.MENU_AUDIT_LOG],
            [BotHandler.MENU_BROADCAST]
        ];

        const suspendedRows = [
            [BotHandler.MENU_APPEAL]
        ];

        if (role === 'admin') {
            return adminRows;
        }

        if (role === 'counselor') {
            return counselorRows;
        }

        if (role === 'suspended') {
            return suspendedRows;
        }

        return [[BotHandler.MENU_REGISTER_COUNSELOR]];
    }

    private async getMenuRole(chatId: number): Promise<'user' | 'counselor' | 'admin' | 'suspended'> {
        if (this.isAdmin(chatId)) {
            return 'admin';
        }

        if (!this.collections) {
            return 'user';
        }

        const counselor = await this.collections.counselors.findOne({ telegramChatId: chatId });
        if (counselor) {
            if (counselor.isApproved && !counselor.isSuspended) {
                return 'counselor';
            }

            if (counselor.isSuspended) {
                return 'suspended';
            }
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
            || text === BotHandler.MENU_STATUS_AWAY
            || text === BotHandler.MENU_MY_STATS
            || text === BotHandler.MENU_PRAYER_REQUESTS
            || text === BotHandler.MENU_CLOSE_PRAYER
            || text === BotHandler.MENU_TRANSFER_SESSION
            || text === BotHandler.MENU_ADMIN_STATS
            || text === BotHandler.MENU_PENDING_REPORTS
            || text === BotHandler.MENU_PROCESS_REPORT
            || text === BotHandler.MENU_COUNSELOR_LIST
            || text === BotHandler.MENU_APPEAL
            || text === BotHandler.MENU_APPEALS
            || text === BotHandler.MENU_APPROVE_COUNSELOR
            || text === BotHandler.MENU_REMOVE_COUNSELOR
            || text === BotHandler.MENU_AUDIT_LOG
            || text === BotHandler.MENU_BROADCAST;
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