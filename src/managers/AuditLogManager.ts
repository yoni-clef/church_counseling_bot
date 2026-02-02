import { Collections } from '../database/Collections';
import { AuditLog } from '../types/AuditLog';
import { generateAuditLogId } from '../models/utils';

export class AuditLogManager {
    private collections: Collections;

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Record an administrative action
     * Requirements: 6.4
     */
    async recordAdminAction(
        adminId: string,
        action: string,
        targetId?: string,
        details?: Record<string, unknown>
    ): Promise<AuditLog> {
        const log: AuditLog = {
            logId: generateAuditLogId(),
            adminId,
            action,
            timestamp: new Date(),
            ...(targetId !== undefined ? { targetId } : {}),
            ...(details !== undefined ? { details } : {})
        };

        await this.collections.auditLogs.insertOne(log);
        return log;
    }

    /**
     * Get recent audit logs
     * Requirements: 6.4
     */
    async getRecentAdminActions(limit = 25): Promise<AuditLog[]> {
        return this.collections.auditLogs
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }
}
