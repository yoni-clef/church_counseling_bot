import { Collections } from '../database/Collections';
import { Counselor } from '../types/Counselor';
import { v4 as uuidv4 } from 'uuid';

export interface CounselorStats {
    counselorId: string;
    sessionsHandled: number;
    status: 'available' | 'busy' | 'away';
    isApproved: boolean;
    strikes: number;
    isSuspended: boolean;
    lastActive: Date;
}

export interface StatusChangeAudit {
    counselorId: string;
    previousStatus: 'available' | 'busy' | 'away';
    newStatus: 'available' | 'busy' | 'away';
    changedBy: string;
    timestamp: Date;
}

export class CounselorManager {
    private collections: Collections;
    private statusAuditLog: StatusChangeAudit[] = [];

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Set counselor availability status
     * Requirements: 3.1, 3.3, 3.4
     */
    async setAvailability(counselorId: string, status: 'available' | 'busy' | 'away', changedBy?: string): Promise<void> {
        // Validate status
        const validStatuses = ['available', 'busy', 'away'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }

        // Get current counselor to track previous status
        const currentCounselor = await this.collections.counselors.findOne({ id: counselorId });
        if (!currentCounselor) {
            throw new Error(`Counselor not found: ${counselorId}`);
        }

        const previousStatus = currentCounselor.status;

        // Update counselor status
        const result = await this.collections.counselors.updateOne(
            { id: counselorId },
            {
                $set: {
                    status: status,
                    lastActive: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            throw new Error(`Counselor not found: ${counselorId}`);
        }

        // Create audit trail for status changes
        const auditEntry: StatusChangeAudit = {
            counselorId,
            previousStatus,
            newStatus: status,
            changedBy: changedBy || counselorId,
            timestamp: new Date()
        };
        this.statusAuditLog.push(auditEntry);
    }

    /**
     * Get an available counselor for assignment
     * Requirements: 3.2
     */
    async getAvailableCounselor(): Promise<string | null> {
        const availableCounselor = await this.collections.counselors.findOne({
            status: 'available',
            isApproved: true,
            isSuspended: false
        });

        return availableCounselor ? availableCounselor.id : null;
    }

    /**
     * Approve a counselor (admin function)
     * Requirements: 6.1
     */
    async approveCounselor(adminId: string, counselorId: string): Promise<void> {
        const result = await this.collections.counselors.updateOne(
            { id: counselorId },
            {
                $set: {
                    isApproved: true,
                    lastActive: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            throw new Error(`Counselor not found: ${counselorId}`);
        }

        // Log admin action
        console.log(`Admin ${adminId} approved counselor ${counselorId} at ${new Date().toISOString()}`);
    }

    /**
     * Remove a counselor (admin function)
     * Requirements: 6.2
     */
    async removeCounselor(adminId: string, counselorId: string): Promise<void> {
        // First, end any active sessions gracefully
        const activeSessions = await this.collections.sessions.find({
            counselorId: counselorId,
            isActive: true
        }).toArray();

        for (const session of activeSessions) {
            await this.collections.sessions.updateOne(
                { sessionId: session.sessionId },
                {
                    $set: {
                        isActive: false,
                        endTime: new Date(),
                        duration: Math.floor((new Date().getTime() - session.startTime.getTime()) / (1000 * 60))
                    }
                }
            );
        }

        // Remove counselor access by setting isApproved to false and suspending
        const result = await this.collections.counselors.updateOne(
            { id: counselorId },
            {
                $set: {
                    isApproved: false,
                    isSuspended: true,
                    status: 'away',
                    lastActive: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            throw new Error(`Counselor not found: ${counselorId}`);
        }

        // Log admin action
        console.log(`Admin ${adminId} removed counselor ${counselorId} at ${new Date().toISOString()}`);
    }

    /**
     * Get counselor statistics
     * Requirements: 8.2
     */
    async getCounselorStats(counselorId: string): Promise<CounselorStats> {
        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (!counselor) {
            throw new Error(`Counselor not found: ${counselorId}`);
        }

        return {
            counselorId: counselor.id,
            sessionsHandled: counselor.sessionsHandled,
            status: counselor.status,
            isApproved: counselor.isApproved,
            strikes: counselor.strikes,
            isSuspended: counselor.isSuspended,
            lastActive: counselor.lastActive
        };
    }

    /**
     * Get workload distribution across all counselors
     * Requirements: 8.2
     */
    async getWorkloadDistribution(): Promise<Array<{
        counselorId: string;
        sessionsHandled: number;
        workloadPercentage: number;
    }>> {
        const counselors = await this.collections.counselors.find({}).toArray();
        const totalSessions = counselors.reduce((sum, counselor) => sum + counselor.sessionsHandled, 0);

        return counselors.map(counselor => ({
            counselorId: counselor.id,
            sessionsHandled: counselor.sessionsHandled,
            workloadPercentage: totalSessions > 0 ? (counselor.sessionsHandled / totalSessions) * 100 : 0
        }));
    }

    /**
     * Get comprehensive counselor statistics for all counselors
     * Requirements: 8.2
     */
    async getAllCounselorStats(): Promise<{
        totalCounselors: number;
        approvedCounselors: number;
        availableCounselors: number;
        suspendedCounselors: number;
        totalSessionsHandled: number;
        averageSessionsPerCounselor: number;
        workloadDistribution: Array<{
            counselorId: string;
            sessionsHandled: number;
            workloadPercentage: number;
        }>;
    }> {
        const counselors = await this.collections.counselors.find({}).toArray();
        const totalSessions = counselors.reduce((sum, counselor) => sum + counselor.sessionsHandled, 0);

        const stats = {
            totalCounselors: counselors.length,
            approvedCounselors: counselors.filter(c => c.isApproved).length,
            availableCounselors: counselors.filter(c => c.status === 'available' && c.isApproved && !c.isSuspended).length,
            suspendedCounselors: counselors.filter(c => c.isSuspended).length,
            totalSessionsHandled: totalSessions,
            averageSessionsPerCounselor: counselors.length > 0 ? totalSessions / counselors.length : 0,
            workloadDistribution: counselors.map(counselor => ({
                counselorId: counselor.id,
                sessionsHandled: counselor.sessionsHandled,
                workloadPercentage: totalSessions > 0 ? (counselor.sessionsHandled / totalSessions) * 100 : 0
            }))
        };

        return stats;
    }

    /**
     * List all counselors with appropriate information
     * Requirements: 6.3
     */
    async listCounselors(): Promise<Array<{
        counselorId: string;
        status: 'available' | 'busy' | 'away';
        isApproved: boolean;
        sessionsHandled: number;
        strikes: number;
        isSuspended: boolean;
        lastActive: Date;
    }>> {
        const counselors = await this.collections.counselors.find({}).toArray();

        return counselors.map(counselor => ({
            counselorId: counselor.id,
            status: counselor.status,
            isApproved: counselor.isApproved,
            sessionsHandled: counselor.sessionsHandled,
            strikes: counselor.strikes,
            isSuspended: counselor.isSuspended,
            lastActive: counselor.lastActive
        }));
    }

    /**
     * Check if counselor has access to counselor commands
     * Requirements: 6.1
     */
    async hasAccess(counselorId: string): Promise<boolean> {
        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        return counselor ? counselor.isApproved && !counselor.isSuspended : false;
    }

    /**
     * Get status change audit trail
     * Requirements: 3.4
     */
    getStatusAuditTrail(counselorId?: string): StatusChangeAudit[] {
        if (counselorId) {
            return this.statusAuditLog.filter(entry => entry.counselorId === counselorId);
        }
        return [...this.statusAuditLog];
    }

    /**
     * Create a new counselor record
     */
    async createCounselor(telegramChatId: number): Promise<string> {
        const counselorId = uuidv4();
        const counselor: Counselor = {
            id: counselorId,
            telegramChatId,
            status: 'away',
            isApproved: false,
            strikes: 0,
            isSuspended: false,
            sessionsHandled: 0,
            createdAt: new Date(),
            lastActive: new Date()
        };

        await this.collections.counselors.insertOne(counselor);
        return counselorId;
    }
}