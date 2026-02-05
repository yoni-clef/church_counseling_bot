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

    /**
     * Get paged audit logs
     */
    async getAdminActionsPage(page: number, pageSize: number): Promise<{ logs: AuditLog[]; total: number }> {
        const safePage = Math.max(1, page);
        const safePageSize = Math.max(1, pageSize);
        const skip = (safePage - 1) * safePageSize;

        const [total, logs] = await Promise.all([
            this.collections.auditLogs.countDocuments({}),
            this.collections.auditLogs
                .find({})
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(safePageSize)
                .toArray()
        ]);

        return { logs, total };
    }
}
