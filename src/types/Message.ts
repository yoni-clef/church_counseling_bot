export interface Message {
    messageId: string;
    sessionId: string;
    senderId: string;
    senderType: 'user' | 'counselor';
    content: string;
    timestamp: Date;
}