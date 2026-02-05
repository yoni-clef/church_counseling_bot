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
            startTime: now,
            isActive: true,
            consentGiven: true,
            consentTimestamp: now
        };

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

        await this.collections.counselors.updateOne(
            { id: session.counselorId },
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
        const activeSessions = await this.collections.sessions.find({ counselorId, isActive: true }).toArray();
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
        return this.collections.sessions.findOne({ counselorId, isActive: true });
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

        if (senderType === 'user' && senderId !== session.userId) {
            throw new Error('User is not authorized for this session.');
        }

        if (senderType === 'counselor' && senderId !== session.counselorId) {
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
        const recipientId = senderType === 'user' ? session.counselorId : session.userId;

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
        const isAuthorizedCounselor = requesterType === 'counselor' && requesterId === session.counselorId;

        if (!isAuthorizedUser && !isAuthorizedCounselor) {
            throw new Error('Requester is not authorized to view this session history.');
        }

        return this.collections.messages
            .find({ sessionId })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
    }
}