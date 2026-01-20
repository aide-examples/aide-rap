/**
 * Centralized logging configuration using Winston
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');
require('winston-daily-rotate-file');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] })
);

// Console format (colorized for development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present (COMPACT - no pretty-printing)
    if (metadata && Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }

    return msg;
  })
);

// File format (JSON for production)
const fileFormat = winston.format.combine(
  logFormat,
  winston.format.json()
);

// Determine log level from environment
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: 'irma' },
  transports: [
    // Error log file - DAILY ROTATION
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: fileFormat,
      maxSize: '20m',  // Rotate at 20MB
      maxFiles: '14d', // Keep 14 days
      zippedArchive: true, // Compress old logs
    }),

    // Combined log file - DAILY ROTATION
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: fileFormat,
      maxSize: '20m',  // Rotate at 20MB
      maxFiles: '7d',  // Keep 7 days
      zippedArchive: true, // Compress old logs
    }),
  ],

  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add console transport for non-production or if explicitly enabled
if (process.env.NODE_ENV !== 'production' || process.env.CONSOLE_LOGS === 'true') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

// Handle uncaught exceptions and unhandled rejections - DAILY ROTATION
logger.exceptions.handle(
  new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'exceptions-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    format: fileFormat,
    maxSize: '20m',
    maxFiles: '30d', // Keep 30 days (critical errors)
    zippedArchive: true,
  })
);

logger.rejections.handle(
  new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'rejections-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    format: fileFormat,
    maxSize: '20m',
    maxFiles: '30d', // Keep 30 days (critical errors)
    zippedArchive: true,
  })
);

// Log rotation events
logger.on('rotate', (oldFilename, newFilename) => {
  logger.info('Log file rotated', { oldFilename, newFilename });
});

/**
 * Helper function to log with correlation ID
 */
logger.withCorrelation = function(correlationId) {
  return {
    error: (message, meta = {}) => logger.error(message, { ...meta, correlationId }),
    warn: (message, meta = {}) => logger.warn(message, { ...meta, correlationId }),
    info: (message, meta = {}) => logger.info(message, { ...meta, correlationId }),
    debug: (message, meta = {}) => logger.debug(message, { ...meta, correlationId }),
  };
};

module.exports = logger;
