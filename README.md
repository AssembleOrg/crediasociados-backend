# Crediasociados Backend

A comprehensive NestJS application with PostgreSQL, Prisma ORM, and role-based authentication system.

## Features

- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with refresh tokens
- **Authorization**: Role-based access control (SUPERADMIN, ADMIN, SELLER, USER)
- **API Documentation**: Swagger/OpenAPI
- **Validation**: Class-validator with DTOs
- **Security**: Helmet, CORS, rate limiting
- **Audit**: Request/response logging
- **Soft Deletes**: Data integrity with timestamps

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- pnpm package manager

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd crediasociados-backend
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your database configuration:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/crediasociados?schema=public"
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-change-in-production"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
NODE_ENV="development"
PORT=3000
SWAGGER_ENABLED=true
```

4. Generate Prisma client:
```bash
pnpm prisma:generate
```

5. Run database migrations:
```bash
pnpm prisma:migrate
```

6. Seed the database with initial data:
```bash
pnpm db:seed
```

## Development

Start the development server:
```bash
pnpm start:dev
```

The application will be available at:
- API: http://localhost:3000/api/v1
- Swagger Documentation: http://localhost:3000/api/docs

## Default Superadmin Account

After running the seed script, you can login with:
- Email: `superadmin@crediasociados.com`
- Password: `superadmin123`

## API Documentation

Comprehensive API documentation is available in `context_api.md` for frontend integration.

## User Roles

### SUPERADMIN
- Can create ADMIN accounts
- Full system access
- Cannot be created through API

### ADMIN
- Can create MANAGER accounts
- Can manage MANAGER accounts

### MANAGER
- Basic user with highest concurrency
- Requires DNI or CUIT (one must be provided)
- Cannot create or manage other accounts

## Database Schema

### Users Table
- `id`: Unique identifier (CUID)
- `email`: Unique email address
- `password`: Hashed password
- `fullName`: User's full name
- `phone`: Optional phone number
- `role`: User role (SUPERADMIN, ADMIN, MANAGER)
- `dni`: Optional DNI (required for MANAGER if CUIT not provided)
- `cuit`: Optional CUIT (required for MANAGER if DNI not provided)
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp
- `deletedAt`: Soft delete timestamp
- `createdById`: ID of user who created this account

### Refresh Tokens Table
- `id`: Unique identifier
- `token`: Refresh token
- `userId`: Associated user ID
- `expiresAt`: Token expiration
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp
- `deletedAt`: Soft delete timestamp

## Available Scripts

- `pnpm start`: Start production server
- `pnpm start:dev`: Start development server with hot reload
- `pnpm build`: Build the application
- `pnpm test`: Run tests
- `pnpm test:e2e`: Run end-to-end tests
- `pnpm lint`: Run ESLint
- `pnpm format`: Format code with Prettier
- `pnpm prisma:generate`: Generate Prisma client
- `pnpm prisma:migrate`: Run database migrations
- `pnpm prisma:studio`: Open Prisma Studio
- `pnpm db:push`: Push schema changes to database
- `pnpm db:seed`: Seed database with initial data

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Role-based Access Control**: Granular permissions system
- **Password Hashing**: bcrypt with salt rounds
- **Rate Limiting**: 100 requests per minute
- **CORS**: Cross-origin resource sharing
- **Helmet**: Security headers
- **Input Validation**: Comprehensive request validation
- **Soft Deletes**: Data integrity preservation

## Error Handling

The application includes comprehensive error handling:
- Validation errors (400)
- Authentication errors (401)
- Authorization errors (403)
- Not found errors (404)
- Internal server errors (500)

## Response Format

All API responses follow a consistent format:
```json
{
  "data": "Response data",
  "message": "Success",
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Pagination

Paginated responses include metadata:
```json
{
  "data": "Array of items",
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

## Environment Configuration

The application uses `@nestjs/config` for environment management:
- Development: Swagger enabled, detailed logging
- Production: Swagger disabled, optimized logging
- Environment variables for database, JWT, and application settings

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all tests pass
5. Follow the commit message convention

## License

This project is proprietary and confidential.
