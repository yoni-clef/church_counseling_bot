import { Collections } from '../database/Collections';
import { Session } from '../types/Session';
import { Message } from '../types/Message';
import { generateMessageId, generateSessionId, calculateSessionDuration } from '../models/utils';

export type SenderType = 'user' | 'counselor';

export class SessionManager {
    private collections: Collections;

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Get the consent disclosure text that must be shown before starting a session
     * Requirements: 1.4
     */
    getConsentDisclosureText(): string {
        return (
            'Before we begin, please note: This counseling session is anonymous. '
            + 'Messages may be logged for safety and quality purposes. Do not share personally identifying information. '
            + 'By continuing, you consent to participate under these terms.'
        );
    }

    /**
     * Create a new counseling session
     * Requirements: 4.1, 4.3, 4.4
     */
    async createSession(userId: string, counselorId: string, consentGiven: boolean): Promise<Session> {
        if (!consentGiven) {
            throw new Error('Consent is required before starting a session.');
        }

        const [user, counselor] = await Promise.all([
            this.collections.users.findOne({ uuid: userId }),
            this.collections.counselors.findOne({ id: counselorId })
        ]);

        if (!user) {
            throw new Error('User not found.');
        }

        if (!counselor || !counselor.isApproved || counselor.isSuspended) {
            throw new Error('Counselor not available for session.');
        }

        const existingUserSession = await this.collections.sessions.findOne({ userId, isActive: true });
        if (existingUserSession) {
            throw new Error('User already has an active session.');
        }

        const existingCounselorSession = await this.collections.sessions.findOne({ counselorId, isActive: true });
        if (existingCounselorSession) {
            throw new Error('Counselor already has an active session.');
        }

        const now = new Date();
        const session: Session = {
            sessionId: generateSessionId(),
            userId,
            counselorId,
            currentCounselorId: counselorId,
            startTime: now,
            isActive: true,
            consentGiven: true,
            consentTimestamp: now,
            userPreferredLanguage: user.user_preferred_language ?? [],
            transferCount: 0,
            transferHistory: []
        };

        if (user.user_requested_domain) {
            session.userRequestedDomain = user.user_requested_domain;
        }

        await this.collections.sessions.insertOne(session);

        return session;
    }

    /**
     * End an active counseling session
     * Requirements: 4.3, 4.4
     */
    async endSession(sessionId: string): Promise<Session> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        if (!session.isActive) {
            return session;
        }

        const endTime = new Date();
        const duration = calculateSessionDuration(session.startTime, endTime);

        await this.collections.sessions.updateOne(
            { sessionId },
            { $set: { isActive: false, endTime, duration } }
        );

        const currentCounselorId = this.getCurrentCounselorId(session);
        await this.collections.counselors.updateOne(
            { id: currentCounselorId },
            {
                $set: { status: 'available', lastActive: endTime },
                $inc: { sessionsHandled: 1 }
            }
        );

        return {
            ...session,
            isActive: false,
            endTime,
            duration
        };
    }

    /**
     * Record a user rating for a completed session
     */
    async rateSession(sessionId: string, userId: string, ratingScore: number): Promise<Session> {
        if (!Number.isInteger(ratingScore) || ratingScore < 1 || ratingScore > 5) {
            throw new Error('Rating must be a number between 1 and 5.');
        }

        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        if (session.userId !== userId) {
            throw new Error('User is not authorized to rate this session.');
        }

        if (session.isActive) {
            throw new Error('Cannot rate an active session.');
        }

        if (typeof session.ratingScore === 'number') {
            return session as Session;
        }

        const ratingTimestamp = new Date();
        await this.collections.sessions.updateOne(
            { sessionId },
            { $set: { ratingScore, ratingTimestamp } }
        );

        const counselorId = this.getCurrentCounselorId(session);
        const counselor = await this.collections.counselors.findOne({ id: counselorId });
        if (counselor) {
            const ratingCount = counselor.ratingCount ?? 0;
            const ratingTotal = counselor.ratingTotal ?? 0;
            const newCount = ratingCount + 1;
            const newTotal = ratingTotal + ratingScore;
            const newAverage = newTotal / newCount;

            await this.collections.counselors.updateOne(
                { id: counselorId },
                {
                    $set: {
                        ratingCount: newCount,
                        ratingTotal: newTotal,
                        ratingAverage: newAverage
                    }
                }
            );
        }

        return { ...session, ratingScore, ratingTimestamp } as Session;
    }

    /**
     * Terminate all active sessions for a specific user
     * Requirements: 4.4
     */
    async terminateActiveSessionsForUser(userId: string): Promise<number> {
        const activeSessions = await this.collections.sessions.find({ userId, isActive: true }).toArray();
        let terminatedCount = 0;

        for (const session of activeSessions) {
            await this.endSession(session.sessionId);
            terminatedCount += 1;
        }

        return terminatedCount;
    }

    /**
     * Terminate all active sessions for a specific counselor
     * Requirements: 4.4
     */
    async terminateActiveSessionsForCounselor(counselorId: string): Promise<number> {
        const activeSessions = await this.collections.sessions.find({
            isActive: true,
            $or: [{ counselorId }, { currentCounselorId: counselorId }]
        } as unknown as Record<string, unknown>).toArray();
        let terminatedCount = 0;

        for (const session of activeSessions) {
            await this.endSession(session.sessionId);
            terminatedCount += 1;
        }

        return terminatedCount;
    }

    /**
     * Retrieve an active session for a user
     * Requirements: 4.1
     */
    async getActiveSessionForUser(userId: string): Promise<Session | null> {
        return this.collections.sessions.findOne({ userId, isActive: true });
    }

    /**
     * Retrieve an active session for a counselor
     * Requirements: 4.1
     */
    async getActiveSessionForCounselor(counselorId: string): Promise<Session | null> {
        return this.collections.sessions.findOne({
            isActive: true,
            $or: [{ counselorId }, { currentCounselorId: counselorId }]
        } as unknown as Record<string, unknown>);
    }

    /**
     * Store a message for a session with access validation
     * Requirements: 5.1, 5.2, 5.3, 5.4
     */
    async storeMessage(sessionId: string, senderId: string, senderType: SenderType, content: string): Promise<Message> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session || !session.isActive) {
            throw new Error('Active session not found.');
        }

        const currentCounselorId = this.getCurrentCounselorId(session);

        if (senderType === 'user' && senderId !== session.userId) {
            throw new Error('User is not authorized for this session.');
        }

        if (senderType === 'counselor' && senderId !== currentCounselorId) {
            throw new Error('Counselor is not authorized for this session.');
        }

        const trimmedContent = content.trim();
        if (!trimmedContent) {
            throw new Error('Message content cannot be empty.');
        }

        const message: Message = {
            messageId: generateMessageId(),
            sessionId,
            senderId,
            senderType,
            content: trimmedContent,
            timestamp: new Date()
        };

        await this.collections.messages.insertOne(message);
        return message;
    }

    /**
     * Route a message and return the intended recipient
     * Requirements: 5.1, 5.2, 5.3
     */
    async routeMessage(sessionId: string, senderId: string, senderType: SenderType, content: string): Promise<{
        message: Message;
        recipientId: string;
        recipientType: SenderType;
    }> {
        const message = await this.storeMessage(sessionId, senderId, senderType, content);
        const session = await this.collections.sessions.findOne({ sessionId });

        if (!session) {
            throw new Error('Session not found for routing.');
        }

        const recipientType: SenderType = senderType === 'user' ? 'counselor' : 'user';
        const currentCounselorId = this.getCurrentCounselorId(session);
        const recipientId = senderType === 'user' ? currentCounselorId : session.userId;

        return { message, recipientId, recipientType };
    }

    /**
     * Retrieve message history for a session with access control
     * Requirements: 5.4
     */
    async getMessageHistory(
        sessionId: string,
        requesterId: string,
        requesterType: SenderType,
        limit = 50
    ): Promise<Message[]> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        const isAuthorizedUser = requesterType === 'user' && requesterId === session.userId;
        const isAuthorizedCounselor = requesterType === 'counselor' && this.isCounselorParticipant(session as Session, requesterId);

        if (!isAuthorizedUser && !isAuthorizedCounselor) {
            throw new Error('Requester is not authorized to view this session history.');
        }

        return this.collections.messages
            .find({ sessionId })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
    }

    /**
     * Retrieve message history for a session with pagination
     */
    async getMessageHistoryPage(
        sessionId: string,
        requesterId: string,
        requesterType: SenderType,
        page: number,
        pageSize: number
    ): Promise<{ messages: Message[]; total: number }> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        const isAuthorizedUser = requesterType === 'user' && requesterId === session.userId;
        const isAuthorizedCounselor = requesterType === 'counselor' && this.isCounselorParticipant(session as Session, requesterId);

        if (!isAuthorizedUser && !isAuthorizedCounselor) {
            throw new Error('Requester is not authorized to view this session history.');
        }

        const safePage = Math.max(1, page);
        const safePageSize = Math.max(1, pageSize);
        const skip = (safePage - 1) * safePageSize;

        const [total, messages] = await Promise.all([
            this.collections.messages.countDocuments({ sessionId }),
            this.collections.messages
                .find({ sessionId })
                .sort({ timestamp: 1 })
                .skip(skip)
                .limit(safePageSize)
                .toArray()
        ]);

        return { messages, total };
    }

    /**
     * Retrieve full message history for a session (admin only, for report review)
     */
    async getMessageHistoryForAdmin(sessionId: string): Promise<Message[]> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        return this.collections.messages
            .find({ sessionId })
            .sort({ timestamp: 1 })
            .toArray();
    }

    async transferSession(
        sessionId: string,
        fromCounselorId: string,
        toCounselorId: string,
        reason: string
    ): Promise<Session> {
        const session = await this.collections.sessions.findOne({ sessionId });
        if (!session) {
            throw new Error('Session not found.');
        }

        const currentCounselorId = this.getCurrentCounselorId(session as Session);
        if (currentCounselorId !== fromCounselorId) {
            throw new Error('Counselor is not assigned to this session.');
        }

        const transferTimestamp = new Date();
        const transferEntry = {
            fromCounselorId,
            toCounselorId,
            reason,
            timestamp: transferTimestamp
        };

        await this.collections.sessions.updateOne(
            { sessionId },
            {
                $set: {
                    currentCounselorId: toCounselorId,
                    previousCounselorId: fromCounselorId,
                    transferReason: reason,
                    transferTimestamp
                },
                $inc: { transferCount: 1 },
                $push: { transferHistory: transferEntry }
            }
        );

        return {
            ...(session as Session),
            currentCounselorId: toCounselorId,
            previousCounselorId: fromCounselorId,
            transferReason: reason,
            transferTimestamp,
            transferCount: (session.transferCount ?? 0) + 1,
            transferHistory: [...(session.transferHistory ?? []), transferEntry]
        };
    }

    private getCurrentCounselorId(session: Session): string {
        return session.currentCounselorId ?? session.counselorId;
    }

    private isCounselorParticipant(session: Session, counselorId: string): boolean {
        if (session.counselorId === counselorId) {
            return true;
        }
        if (session.currentCounselorId === counselorId) {
            return true;
        }
        if (session.previousCounselorId === counselorId) {
            return true;
        }

        const history = session.transferHistory ?? [];
        return history.some(entry => entry.fromCounselorId === counselorId || entry.toCounselorId === counselorId);
    }
}