import { Collection, Db } from 'mongodb';
import { User } from '../types/User';
import { Counselor } from '../types/Counselor';
import { Session } from '../types/Session';
import { Message } from '../types/Message';
import { PrayerRequest } from '../types/PrayerRequest';
import { Report } from '../types/Report';
import { AuditLog } from '../types/AuditLog';
import { Appeal } from '../types/Appeal';
import { BroadcastLog } from '../types/BroadcastLog';

export class Collections {
    private db: Db;

    // Collection references
    public users: Collection<User>;
    public counselors: Collection<Counselor>;
    public sessions: Collection<Session>;
    public messages: Collection<Message>;
    public prayers: Collection<PrayerRequest>;
    public reports: Collection<Report>;
    public auditLogs: Collection<AuditLog>;
    public appeals: Collection<Appeal>;
    public broadcastLogs: Collection<BroadcastLog>;

    constructor(db: Db) {
        this.db = db;

        // Initialize collection references
        this.users = db.collection<User>('users');
        this.counselors = db.collection<Counselor>('counselors');
        this.sessions = db.collection<Session>('sessions');
        this.messages = db.collection<Message>('messages');
        this.prayers = db.collection<PrayerRequest>('prayers');
        this.reports = db.collection<Report>('reports');
        this.auditLogs = db.collection<AuditLog>('audit_logs');
        this.appeals = db.collection<Appeal>('appeals');
        this.broadcastLogs = db.collection<BroadcastLog>('broadcast_logs');
    }

    async initializeCollections(): Promise<void> {
        console.log('Initializing MongoDB collections and indexes...');

        try {
            // Create indexes for users collection
            await this.users.createIndex({ uuid: 1 }, { unique: true });
            await this.users.createIndex({ telegramChatId: 1 }, { unique: true });
            await this.users.createIndex({ createdAt: 1 });

            // Create indexes for counselors collection
            await this.counselors.createIndex({ id: 1 }, { unique: true });
            await this.counselors.createIndex({ telegramChatId: 1 }, { unique: true });
            await this.counselors.createIndex({ status: 1 });
            await this.counselors.createIndex({ isApproved: 1 });
            await this.counselors.createIndex({ isSuspended: 1 });

            // Create indexes for sessions collection
            await this.sessions.createIndex({ sessionId: 1 }, { unique: true });
            await this.sessions.createIndex({ userId: 1 });
            await this.sessions.createIndex({ counselorId: 1 });
            await this.sessions.createIndex({ isActive: 1 });
            await this.sessions.createIndex({ startTime: 1 });

            // Create indexes for messages collection
            await this.messages.createIndex({ messageId: 1 }, { unique: true });
            await this.messages.createIndex({ sessionId: 1 });
            await this.messages.createIndex({ senderId: 1 });
            await this.messages.createIndex({ timestamp: 1 });

            // Create indexes for prayers collection
            await this.prayers.createIndex({ prayerId: 1 }, { unique: true });
            await this.prayers.createIndex({ userId: 1 });
            await this.prayers.createIndex({ createdAt: 1 });
            await this.prayers.createIndex({ status: 1 });

            // Create indexes for reports collection
            await this.reports.createIndex({ reportId: 1 }, { unique: true });
            await this.reports.createIndex({ sessionId: 1 });
            await this.reports.createIndex({ counselorId: 1 });
            await this.reports.createIndex({ processed: 1 });
            await this.reports.createIndex({ timestamp: 1 });

            // Create indexes for audit logs collection
            await this.auditLogs.createIndex({ logId: 1 }, { unique: true });
            await this.auditLogs.createIndex({ adminId: 1 });
            await this.auditLogs.createIndex({ action: 1 });
            await this.auditLogs.createIndex({ timestamp: 1 });

            // Create indexes for appeals collection
            await this.appeals.createIndex({ appealId: 1 }, { unique: true });
            await this.appeals.createIndex({ counselorId: 1 });
            await this.appeals.createIndex({ processed: 1 });
            await this.appeals.createIndex({ timestamp: 1 });

            // Create indexes for broadcast logs collection
            await this.broadcastLogs.createIndex({ broadcastId: 1 }, { unique: true });
            await this.broadcastLogs.createIndex({ sentByAdminId: 1 });
            await this.broadcastLogs.createIndex({ sentAt: 1 });

            console.log('Successfully initialized all collections and indexes');
        } catch (error) {
            console.error('Error initializing collections:', error);
            throw error;
        }
    }

    async ensureCollectionsExist(): Promise<void> {
        const collectionNames = [
            'users',
            'counselors',
            'sessions',
            'messages',
            'prayers',
            'reports',
            'audit_logs',
            'appeals',
            'broadcast_logs'
        ];

        const existingCollections = await this.db.listCollections().toArray();
        const existingNames = existingCollections.map(col => col.name);

        for (const collectionName of collectionNames) {
            if (!existingNames.includes(collectionName)) {
                await this.db.createCollection(collectionName);
                console.log(`Created collection: ${collectionName}`);
            }
        }
    }

    async getCollectionStats(): Promise<Record<string, any>> {
        const stats: Record<string, any> = {};

        const collections = [
            { name: 'users', collection: this.users },
            { name: 'counselors', collection: this.counselors },
            { name: 'sessions', collection: this.sessions },
            { name: 'messages', collection: this.messages },
            { name: 'prayers', collection: this.prayers },
            { name: 'reports', collection: this.reports },
            { name: 'audit_logs', collection: this.auditLogs },
            { name: 'appeals', collection: this.appeals },
            { name: 'broadcast_logs', collection: this.broadcastLogs }
        ];

        for (const { name, collection } of collections) {
            try {
                const count = await collection.countDocuments();
                stats[name] = { documentCount: count };
            } catch (error) {
                stats[name] = { error: (error as Error).message };
            }
        }

        return stats;
    }
}