export type AppealAction = 'revoke' | 'approve';

export interface Appeal {
    appealId: string;
    counselorId: string;
    message: string;
    strikes: number;
    timestamp: Date;
    processed: boolean;
    processedAt?: Date;
    processedBy?: string;
    action?: AppealAction;
}
