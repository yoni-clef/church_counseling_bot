import { Collections } from '../database/Collections';

export interface CleanupResult {
    sessionsDeleted: number;
    messagesDeleted: number;
    reportsDeleted: number;
}

export class CleanupManager {
    private collections: Collections;

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Remove sessions older than the provided retention period (in days)
     * Also removes orphaned messages and reports tied to deleted sessions.
     * Requirements: 10.2, 10.5
     */
    async cleanupOldSessions(retentionDays: number): Promise<CleanupResult> {
        if (retentionDays < 1) {
            throw new Error('Retention days must be at least 1.');
        }

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        const oldSessions = await this.collections.sessions
            .find({ startTime: { $lt: cutoff } })
            .toArray();

        if (oldSessions.length === 0) {
            return { sessionsDeleted: 0, messagesDeleted: 0, reportsDeleted: 0 };
        }

        const sessionIds = oldSessions.map(session => session.sessionId);
        
        const [sessionResult, messageResult, reportResult] = await Promise.all([
            this.collections.sessions.deleteMany({ sessionId: { $in: sessionIds } }),
            this.collections.messages.deleteMany({ sessionId: { $in: sessionIds } }),
            this.collections.reports.deleteMany({ sessionId: { $in: sessionIds } })
        ]);
        
        return {
            sessionsDeleted: sessionResult.deletedCount ?? 0,
            messagesDeleted: messageResult.deletedCount ?? 0,
            reportsDeleted: reportResult.deletedCount ?? 0
        };
    }
}
