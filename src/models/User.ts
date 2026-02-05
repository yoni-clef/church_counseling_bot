/**
 * User Model - Anonymous user representation
 * Validates: Requirements 9.1 - User data persistence structure
 */
export interface User {
    /** Anonymous identifier - UUID v4 */
    uuid: string;
    /** Telegram chat ID for messaging */
    telegramChatId: number;
    /** Account creation timestamp */
    createdAt: Date;
    /** Last activity timestamp */
    lastActive: Date;
    /** Conversation state for menu routing */
    state: 'IDLE' | 'SUBMITTING_PRAYER' | 'WAITING_COUNSELOR' | 'IN_SESSION' | 'VIEWING_HISTORY' | 'REPORTING' | 'POST_SESSION';
}

/**
 * User creation input - excludes generated fields
 */
export interface CreateUserInput {
    telegramChatId: number;
}

/**
 * User validation schema
 */
export const validateUser = (user: any): user is User => {
    return (
        typeof user.uuid === 'string' &&
        user.uuid.length > 0 &&
        typeof user.telegramChatId === 'number' &&
        user.telegramChatId > 0 &&
        user.createdAt instanceof Date &&
        user.lastActive instanceof Date &&
        ['IDLE', 'SUBMITTING_PRAYER', 'WAITING_COUNSELOR', 'IN_SESSION', 'VIEWING_HISTORY', 'REPORTING', 'POST_SESSION'].includes(user.state)
    );
};

/**
 * Validates that user data contains only allowed fields (data minimization)
 */
export const validateUserDataMinimization = (userData: any): boolean => {
    const allowedFields = ['uuid', 'telegramChatId', 'createdAt', 'lastActive', 'state'];
    const userFields = Object.keys(userData);

    // Check that all fields are allowed
    return userFields.every(field => allowedFields.includes(field)) &&
        // Check that required fields are present
        allowedFields.slice(0, 2).every(field => userFields.includes(field));
};