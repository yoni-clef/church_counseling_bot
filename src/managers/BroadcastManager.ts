import { Telegraf, Context } from 'telegraf';
import { Collection } from 'mongodb';
import { User, Counselor, BroadcastLog } from '../types';
import { logger } from '../utils/logger';
import { generateBroadcastId } from '../models/utils';

export type BroadcastTarget = 'users' | 'counselors' | 'everyone';

export class BroadcastManager {
    private bot: Telegraf<Context>;
    private users: Collection<User>;
    private counselors: Collection<Counselor>;
    private broadcastLogs: Collection<BroadcastLog>;

    constructor(
        bot: Telegraf<Context>,
        users: Collection<User>,
        counselors: Collection<Counselor>,
        broadcastLogs: Collection<BroadcastLog>
    ) {
        this.bot = bot;
        this.users = users;
        this.counselors = counselors;
        this.broadcastLogs = broadcastLogs;
    }

    private async getRecipients(target: BroadcastTarget): Promise<number[]> {
        const chatIds = new Set<number>();

        if (target === 'users' || target === 'everyone') {
            const allUsers = await this.users.find({}, { projection: { telegramChatId: 1 } }).toArray();
            allUsers.forEach(u => u.telegramChatId && chatIds.add(u.telegramChatId));
        }

        if (target === 'counselors' || target === 'everyone') {
            const allCounselors = await this.counselors.find(
                { isApproved: true, isSuspended: false },
                { projection: { telegramChatId: 1 } }
            ).toArray();
            allCounselors.forEach(c => c.telegramChatId && chatIds.add(c.telegramChatId));
        }

        return Array.from(chatIds);
    }

    public async executeBroadcast(
        adminId: number,
        target: BroadcastTarget,
        message: string
    ): Promise<{ successCount: number; failedCount: number }> {
        const recipients = await this.getRecipients(target);
        const broadcastId = generateBroadcastId();
        let successCount = 0;
        let failedCount = 0;

        const broadcastMessage = `📢 System Announcement\n\n${message}\n\n— System Notification`;

        for (const chatId of recipients) {
            try {
                await this.bot.telegram.sendMessage(chatId, broadcastMessage);
                successCount++;
            } catch (error) {
                const err = error as Error;
                logger.warn('Broadcast send failed', { chatId, message: err.message });
                failedCount++;
            }
            // Add a small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        await this.logBroadcast(broadcastId, adminId, target, message, successCount, failedCount);
        return { successCount, failedCount };
    }

    private async logBroadcast(
        broadcastId: string,
        adminId: number,
        target: BroadcastTarget,
        message: string,
        successCount: number,
        failedCount: number
    ): Promise<void> {
        const logEntry: BroadcastLog = {
            broadcastId,
            message,
            targetGroup: target,
            sentByAdminId: adminId.toString(),
            sentAt: new Date(),
            successCount,
            failedCount
        };
        await this.broadcastLogs.insertOne(logEntry);
    }
}