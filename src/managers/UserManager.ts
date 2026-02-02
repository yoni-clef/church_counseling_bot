import { v4 as uuidv4 } from 'uuid';
import { Collections } from '../database/Collections';
import { User } from '../types/User';
import { PrayerRequest } from '../types/PrayerRequest';

export class UserManager {
    private collections: Collections;

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Register a new user with anonymous UUID generation
     * Requirements: 1.1, 1.2, 1.3
     */
    async registerUser(telegramChatId: number): Promise<string> {
        // Check if user already exists
        const existingUser = await this.getUserByTelegramId(telegramChatId);
        if (existingUser) {
            return existingUser.uuid;
        }

        // Generate anonymous UUID
        const uuid = uuidv4();
        const now = new Date();

        const user: User = {
            uuid,
            telegramChatId,
            createdAt: now,
            lastActive: now
        };

        try {
            await this.collections.users.insertOne(user);
            return uuid;
        } catch (error) {
            throw new Error(`Failed to register user: ${(error as Error).message}`);
        }
    }

    /**
     * Retrieve user by Telegram chat ID
     * Requirements: 1.1, 1.2, 1.3
     */
    async getUserByTelegramId(telegramChatId: number): Promise<User | null> {
        try {
            const user = await this.collections.users.findOne({ telegramChatId });
            if (user) {
                // Update last active timestamp
                await this.collections.users.updateOne(
                    { telegramChatId },
                    { $set: { lastActive: new Date() } }
                );
            }
            return user;
        } catch (error) {
            throw new Error(`Failed to retrieve user by Telegram ID: ${(error as Error).message}`);
        }
    }

    /**
     * Retrieve user by UUID
     * Requirements: 1.1, 1.2, 1.3
     */
    async getUserById(uuid: string): Promise<User | null> {
        try {
            const user = await this.collections.users.findOne({ uuid });
            if (user) {
                // Update last active timestamp
                await this.collections.users.updateOne(
                    { uuid },
                    { $set: { lastActive: new Date() } }
                );
            }
            return user;
        } catch (error) {
            throw new Error(`Failed to retrieve user by UUID: ${(error as Error).message}`);
        }
    }

    /**
     * Submit a prayer request with unique ID generation
     * Requirements: 2.1, 2.2, 2.3, 2.4
     */
    async submitPrayerRequest(userId: string, title: string): Promise<string> {
        // Verify user exists
        const user = await this.getUserById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Generate unique prayer ID
        const prayerId = uuidv4();
        const now = new Date();

        const prayerRequest: PrayerRequest = {
            prayerId,
            userId,
            title: title.trim(),
            createdAt: now,
            status: 'open'
        };

        try {
            await this.collections.prayers.insertOne(prayerRequest);
            return prayerId;
        } catch (error) {
            throw new Error(`Failed to submit prayer request: ${(error as Error).message}`);
        }
    }

    /**
     * Get prayer requests for counselors (without user identifying information)
     * Requirements: 2.2, 2.3
     */
    async getPrayerRequestsForCounselors(): Promise<Array<{ prayerId: string; title: string; createdAt: Date }>> {
        try {
            const prayers = await this.collections.prayers
                .find({ $or: [{ status: 'open' }, { status: { $exists: false } }] })
                .sort({ createdAt: -1 })
                .toArray();

            // Return only prayer content without user identifying information
            return prayers.map(prayer => ({
                prayerId: prayer.prayerId,
                title: prayer.title,
                createdAt: prayer.createdAt
            }));
        } catch (error) {
            throw new Error(`Failed to retrieve prayer requests: ${(error as Error).message}`);
        }
    }

    /**
     * Get prayer requests submitted by a specific user
     * Requirements: 2.4
     */
    async getUserPrayerRequests(userId: string): Promise<PrayerRequest[]> {
        try {
            const prayers = await this.collections.prayers
                .find({ userId })
                .sort({ createdAt: -1 })
                .toArray();

            return prayers;
        } catch (error) {
            throw new Error(`Failed to retrieve user prayer requests: ${(error as Error).message}`);
        }
    }

    /**
     * Close a prayer request after it has been prayed for
     */
    async closePrayerRequest(prayerId: string): Promise<{ closed: boolean; prayer: PrayerRequest }> {
        try {
            const prayer = await this.collections.prayers.findOne({ prayerId });
            if (!prayer) {
                throw new Error('Prayer request not found');
            }

            if (prayer.status === 'closed') {
                return { closed: false, prayer };
            }

            await this.collections.prayers.updateOne(
                { prayerId },
                { $set: { status: 'closed', closedAt: new Date() } }
            );

            return { closed: true, prayer: { ...prayer, status: 'closed', closedAt: new Date() } };
        } catch (error) {
            throw new Error(`Failed to close prayer request: ${(error as Error).message}`);
        }
    }
}