// Validation schemas for data integrity
import { User, Counselor, Session, Message, PrayerRequest, Report, CounselorStatus, SenderType, UserState } from './index';

// Validation functions for data integrity
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

export const validateUser = (user: Partial<User>): user is User => {
    if (!user.uuid || typeof user.uuid !== 'string') {
        throw new ValidationError('User must have a valid UUID string');
    }
    if (!user.telegramChatId || typeof user.telegramChatId !== 'number') {
        throw new ValidationError('User must have a valid Telegram chat ID number');
    }
    if (!user.createdAt || !(user.createdAt instanceof Date)) {
        throw new ValidationError('User must have a valid createdAt date');
    }
    if (!user.lastInteraction || !(user.lastInteraction instanceof Date)) {
        throw new ValidationError('User must have a valid lastInteraction date');
    }
    if (!isValidUserState(user.state)) {
        throw new ValidationError('User state must be a valid state');
    }
    return true;
};

export const validateCounselor = (counselor: Partial<Counselor>): counselor is Counselor => {
    if (!counselor.id || typeof counselor.id !== 'string') {
        throw new ValidationError('Counselor must have a valid ID string');
    }
    if (!counselor.telegramChatId || typeof counselor.telegramChatId !== 'number') {
        throw new ValidationError('Counselor must have a valid Telegram chat ID number');
    }
    if (!isValidCounselorStatus(counselor.status)) {
        throw new ValidationError('Counselor status must be "available", "busy", or "away"');
    }
    if (typeof counselor.isApproved !== 'boolean') {
        throw new ValidationError('Counselor isApproved must be a boolean');
    }
    if (typeof counselor.strikes !== 'number' || counselor.strikes < 0) {
        throw new ValidationError('Counselor strikes must be a non-negative number');
    }
    if (typeof counselor.isSuspended !== 'boolean') {
        throw new ValidationError('Counselor isSuspended must be a boolean');
    }
    if (typeof counselor.sessionsHandled !== 'number' || counselor.sessionsHandled < 0) {
        throw new ValidationError('Counselor sessionsHandled must be a non-negative number');
    }
    if (!counselor.createdAt || !(counselor.createdAt instanceof Date)) {
        throw new ValidationError('Counselor must have a valid createdAt date');
    }
    if (!counselor.lastActive || !(counselor.lastActive instanceof Date)) {
        throw new ValidationError('Counselor must have a valid lastActive date');
    }
    return true;
};

export const validateSession = (session: Partial<Session>): session is Session => {
    if (!session.sessionId || typeof session.sessionId !== 'string') {
        throw new ValidationError('Session must have a valid sessionId string');
    }
    if (!session.userId || typeof session.userId !== 'string') {
        throw new ValidationError('Session must have a valid userId string');
    }
    if (!session.counselorId || typeof session.counselorId !== 'string') {
        throw new ValidationError('Session must have a valid counselorId string');
    }
    if (!session.startTime || !(session.startTime instanceof Date)) {
        throw new ValidationError('Session must have a valid startTime date');
    }
    if (session.endTime && !(session.endTime instanceof Date)) {
        throw new ValidationError('Session endTime must be a valid date if provided');
    }
    if (typeof session.isActive !== 'boolean') {
        throw new ValidationError('Session isActive must be a boolean');
    }
    if (session.duration !== undefined && (typeof session.duration !== 'number' || session.duration < 0)) {
        throw new ValidationError('Session duration must be a non-negative number if provided');
    }
    return true;
};

export const validateMessage = (message: Partial<Message>): message is Message => {
    if (!message.messageId || typeof message.messageId !== 'string') {
        throw new ValidationError('Message must have a valid messageId string');
    }
    if (!message.sessionId || typeof message.sessionId !== 'string') {
        throw new ValidationError('Message must have a valid sessionId string');
    }
    if (!message.senderId || typeof message.senderId !== 'string') {
        throw new ValidationError('Message must have a valid senderId string');
    }
    if (!isValidSenderType(message.senderType)) {
        throw new ValidationError('Message senderType must be "user" or "counselor"');
    }
    if (!message.content || typeof message.content !== 'string') {
        throw new ValidationError('Message must have valid content string');
    }
    if (!message.timestamp || !(message.timestamp instanceof Date)) {
        throw new ValidationError('Message must have a valid timestamp date');
    }
    return true;
};

export const validatePrayerRequest = (prayer: Partial<PrayerRequest>): prayer is PrayerRequest => {
    if (!prayer.prayerId || typeof prayer.prayerId !== 'string') {
        throw new ValidationError('Prayer request must have a valid prayerId string');
    }
    if (!prayer.userId || typeof prayer.userId !== 'string') {
        throw new ValidationError('Prayer request must have a valid userId string');
    }
    if (!prayer.title || typeof prayer.title !== 'string') {
        throw new ValidationError('Prayer request must have a valid title string');
    }
    if (!prayer.createdAt || !(prayer.createdAt instanceof Date)) {
        throw new ValidationError('Prayer request must have a valid createdAt date');
    }
    return true;
};

export const validateReport = (report: Partial<Report>): report is Report => {
    if (!report.reportId || typeof report.reportId !== 'string') {
        throw new ValidationError('Report must have a valid reportId string');
    }
    if (!report.sessionId || typeof report.sessionId !== 'string') {
        throw new ValidationError('Report must have a valid sessionId string');
    }
    if (!report.counselorId || typeof report.counselorId !== 'string') {
        throw new ValidationError('Report must have a valid counselorId string');
    }
    if (!report.reason || typeof report.reason !== 'string') {
        throw new ValidationError('Report must have a valid reason string');
    }
    if (!report.timestamp || !(report.timestamp instanceof Date)) {
        throw new ValidationError('Report must have a valid timestamp date');
    }
    if (typeof report.processed !== 'boolean') {
        throw new ValidationError('Report processed must be a boolean');
    }
    return true;
};

// Helper validation functions
export const isValidCounselorStatus = (status: any): status is CounselorStatus => {
    return status === 'available' || status === 'busy' || status === 'away';
};

export const isValidSenderType = (senderType: any): senderType is SenderType => {
    return senderType === 'user' || senderType === 'counselor';
};

export const isValidUserState = (state: any): state is UserState => {
    return state === 'IDLE'
        || state === 'SUBMITTING_PRAYER'
        || state === 'WAITING_COUNSELOR'
        || state === 'IN_SESSION'
        || state === 'VIEWING_HISTORY'
    || state === 'REPORTING'
    || state === 'POST_SESSION';
};

// Sanitization functions for data minimization (Requirements 10.4)
export const sanitizeUserData = (user: User): User => {
    // Only keep essential fields, remove any potential PII
    return {
        uuid: user.uuid,
        telegramChatId: user.telegramChatId,
        createdAt: user.createdAt,
        lastInteraction: user.lastInteraction,
        state: user.state
    };
};

export const sanitizePrayerRequestForCounselor = (prayer: PrayerRequest): Omit<PrayerRequest, 'userId'> => {
    // Remove user ID when displaying to counselors (Requirements 2.2)
    return {
        prayerId: prayer.prayerId,
        title: prayer.title,
        createdAt: prayer.createdAt
    };
};

export const sanitizeReportForAdmin = (report: Report): Omit<Report, 'sessionId'> & { counselorId: string } => {
    // Show only anonymous counselor ID to admins (Requirements 7.5)
    return {
        reportId: report.reportId,
        counselorId: report.counselorId, // Keep anonymous counselor ID
        reason: report.reason,
        timestamp: report.timestamp,
        processed: report.processed
    };
};