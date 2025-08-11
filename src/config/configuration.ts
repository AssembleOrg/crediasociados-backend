export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  timezone: process.env.TZ || 'America/Argentina/Buenos_Aires',
}); 