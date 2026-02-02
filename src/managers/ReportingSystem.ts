import { Collections } from '../database/Collections';
import { Report } from '../types/Report';
import { generateReportId } from '../models/utils';

export type ReportAction = 'strike' | 'dismiss';

export class ReportingSystem {
    private collections: Collections;
    private readonly suspendThreshold: number;
    private readonly revokeThreshold: number;

    constructor(collections: Collections, suspendThreshold = 3, revokeThreshold = 5) {
        if (revokeThreshold < suspendThreshold) {
            throw new Error('Revoke threshold must be greater than or equal to suspend threshold.');
        }

        this.collections = collections;
        this.suspendThreshold = suspendThreshold;
        this.revokeThreshold = revokeThreshold;
    }

    /**
     * Submit a user report for a counselor session
     * Requirements: 7.1, 7.2
     */
    async submitReport(sessionId: string, counselorId: string, reason: string): Promise<Report> {
        const trimmedReason = reason.trim();
        if (!trimmedReason) {
            throw new Error('Report reason is required.');
        }

        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        if (session.counselorId !== counselorId) {
            throw new Error('Counselor does not match the session.');
        }

        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (!counselor) {
            throw new Error('Counselor not found.');
        }

        const report: Report = {
            reportId: generateReportId(),
            sessionId,
            counselorId,
            reason: trimmedReason,
            timestamp: new Date(),
            processed: false
        };

        await this.collections.reports.insertOne(report);
        return report;
    }

    /**
     * Retrieve pending reports for admin review
     * Requirements: 7.3
     */
    async getPendingReports(): Promise<Report[]> {
        return this.collections.reports
            .find({ processed: false })
            .sort({ timestamp: -1 })
            .toArray();
    }

    /**
     * Retrieve all reports for a counselor
     * Requirements: 7.3
     */
    async getReportsForCounselor(counselorId: string, includeProcessed = true): Promise<Report[]> {
        const filter = includeProcessed ? { counselorId } : { counselorId, processed: false };
        return this.collections.reports
            .find(filter)
            .sort({ timestamp: -1 })
            .toArray();
    }

    /**
     * Process a report and apply strike management
     * Requirements: 7.3, 7.4, 7.5
     */
    async processReport(reportId: string, adminId: string, action: ReportAction): Promise<Report> {
        const report = await this.collections.reports.findOne({ reportId });
        if (!report) {
            throw new Error('Report not found.');
        }

        if (report.processed) {
            return report;
        }

        if (action === 'strike') {
            await this.applyStrike(report.counselorId);
        }

        await this.collections.reports.updateOne(
            { reportId },
            { $set: { processed: true } }
        );

        console.log(`Admin ${adminId} processed report ${reportId} with action ${action}`);

        return {
            ...report,
            processed: true
        };
    }

    /**
     * Apply a strike to a counselor and enforce suspension/revocation
     * Requirements: 7.4, 7.5
     */
    private async applyStrike(counselorId: string): Promise<void> {
        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (!counselor) {
            throw new Error('Counselor not found.');
        }

        const newStrikes = counselor.strikes + 1;
        const updates: Record<string, unknown> = {
            strikes: newStrikes,
            lastActive: new Date()
        };

        if (newStrikes >= this.revokeThreshold) {
            updates.isApproved = false;
            updates.isSuspended = true;
            updates.status = 'away';
        } else if (newStrikes >= this.suspendThreshold) {
            updates.isSuspended = true;
            updates.status = 'away';
        }

        await this.collections.counselors.updateOne({ id: counselorId }, { $set: updates });
    }
}