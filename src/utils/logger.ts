export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

let currentLevel: LogLevel = 'info';

const formatMessage = (message: string, meta?: Record<string, unknown>): string => {
    if (!meta || Object.keys(meta).length === 0) {
        return message;
    }
    return `${message} | ${JSON.stringify(meta)}`;
};

export const logger = {
    setLevel: (level: LogLevel) => {
        currentLevel = level;
    },
    info: (message: string, meta?: Record<string, unknown>) => {
        if (levels[currentLevel] >= levels.info) {
            console.log(formatMessage(message, meta));
        }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
        if (levels[currentLevel] >= levels.warn) {
            console.warn(formatMessage(message, meta));
        }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
        console.error(formatMessage(message, meta));
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
        if (levels[currentLevel] >= levels.debug) {
            console.debug(formatMessage(message, meta));
        }
    }
};