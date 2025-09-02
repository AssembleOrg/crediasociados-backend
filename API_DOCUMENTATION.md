# API Documentation - Crediasociados Backend

## Base URL
```
http://localhost:3000/api/v1
```

## Authentication
Todos los endpoints (excepto los marcados como públicos) requieren autenticación JWT. Incluir el token en el header:
```
Authorization: Bearer <your-jwt-token>
```

## Roles de Usuario
- `SUPERADMIN`: Acceso completo
- `ADMIN`: Acceso administrativo
- `SUBADMIN`: Acceso de sub-administrador
- `MANAGER`: Acceso de gestor

---

## 🔐 Authentication

### POST /auth/login
**Público** - Iniciar sesión

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "fullName": "John Doe",
    "role": "MANAGER"
  }
}
```

### POST /auth/refresh
**Público** - Actualizar token de acceso

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### POST /auth/logout
**Autenticado** - Cerrar sesión

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "message": "Cierre de sesión exitoso"
}
```

---

## 👥 Users

### POST /users
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Crear usuario

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "fullName": "New User",
  "phone": "1234567890",
  "role": "MANAGER"
}
```

**Response (201):**
```json
{
  "id": "user_id",
  "email": "newuser@example.com",
  "fullName": "New User",
  "phone": "1234567890",
  "role": "MANAGER",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "deletedAt": null,
  "createdById": "creator_id"
}
```

### GET /users
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener usuarios paginados

**Query Parameters:**
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página (default: 10)

**Response (200):**
```json
{
  "data": [
    {
      "id": "user_id",
      "email": "user@example.com",
      "fullName": "John Doe",
      "role": "MANAGER",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### GET /users/:id
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener usuario por ID

**Response (200):**
```json
{
  "id": "user_id",
  "email": "user@example.com",
  "fullName": "John Doe",
  "role": "MANAGER",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### PATCH /users/:id
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Actualizar usuario

**Request Body:**
```json
{
  "fullName": "Updated Name",
  "phone": "9876543210"
}
```

### DELETE /users/:id
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Eliminar usuario (soft delete)

**Response (200):**
```json
{
  "message": "User deleted successfully"
}
```

### GET /users/:id/created-users
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener usuarios creados por un usuario

### GET /users/:id/hierarchy
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener jerarquía de usuario

**Response (200):**
```json
{
  "createdBy": {
    "id": "creator_id",
    "fullName": "Creator Name",
    "role": "ADMIN"
  },
  "createdUsers": [
    {
      "id": "created_user_id",
      "fullName": "Created User",
      "role": "MANAGER"
    }
  ]
}
```

---

## 👤 Clients

### POST /clients
**Roles:** MANAGER - Crear cliente

**Request Body:**
```json
{
  "fullName": "Juan Pérez",
  "dni": "12345678",
  "cuit": "20-12345678-9",
  "phone": "1234567890",
  "email": "juan@example.com",
  "address": "Calle 123, Ciudad",
  "job": "Desarrollador"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "client_id",
    "fullName": "Juan Pérez",
    "dni": "12345678",
    "cuit": "20-12345678-9",
    "phone": "1234567890",
    "email": "juan@example.com",
    "address": "Calle 123, Ciudad",
    "job": "Desarrollador",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "deletedAt": null
  },
  "message": "Client created successfully",
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /clients
**Autenticado** - Obtener clientes paginados

**Query Parameters:**
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página (default: 10)

**Response (200):**
```json
{
  "data": {
    "data": [
      {
        "id": "client_id",
        "fullName": "Juan Pérez",
        "dni": "12345678",
        "cuit": "20-12345678-9",
        "phone": "1234567890",
        "email": "juan@example.com",
        "managers": [
          {
            "id": "manager_id",
            "fullName": "Manager Name",
            "role": "MANAGER"
          }
        ]
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 25,
      "totalPages": 3,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  },
  "message": "Clients retrieved successfully",
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /clients/search
**Autenticado** - Buscar cliente por DNI o CUIT

**Query Parameters:**
- `dni` (string, optional): Número de DNI
- `cuit` (string, optional): Número de CUIT

**Response (200):**
```json
{
  "data": {
    "id": "client_id",
    "fullName": "Juan Pérez",
    "dni": "12345678",
    "cuit": "20-12345678-9",
    "phone": "1234567890",
    "email": "juan@example.com",
    "managers": []
  },
  "message": "Client found successfully",
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET /clients/:id
**Autenticado** - Obtener cliente por ID

**Response (200):**
```json
{
  "data": {
    "id": "client_id",
    "fullName": "Juan Pérez",
    "dni": "12345678",
    "cuit": "20-12345678-9",
    "phone": "1234567890",
    "email": "juan@example.com",
    "address": "Calle 123, Ciudad",
    "job": "Desarrollador",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "deletedAt": null,
    "managers": [],
    "loans": []
  },
  "message": "Client retrieved successfully",
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### PATCH /clients/:id
**Roles:** MANAGER - Actualizar cliente

**Request Body:**
```json
{
  "fullName": "Juan Carlos Pérez",
  "phone": "9876543210"
}
```

### DELETE /clients/:id
**Roles:** MANAGER - Eliminar cliente (soft delete)

**Response (200):**
```json
{
  "data": {
    "message": "Client deleted successfully"
  },
  "message": "Client deleted successfully",
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## 💰 Loans

### POST /loans
**Roles:** MANAGER - Crear préstamo

**Request Body:**
```json
{
  "clientId": "client_id",
  "amount": 150000,
  "baseInterestRate": 50,
  "penaltyInterestRate": 0,
  "currency": "ARS",
  "paymentFrequency": "DAILY",
  "paymentDay": "FRIDAY",
  "totalPayments": 16,
  "firstDueDate": "2025-09-09T03:00:00.000Z",
  "description": "Préstamo personal",
  "notes": "Cliente confiable"
}
```

**Response (201):**
```json
{
  "id": "loan_id",
  "clientId": "client_id",
  "amount": 150000,
  "baseInterestRate": 50,
  "penaltyInterestRate": 0,
  "currency": "ARS",
  "paymentFrequency": "DAILY",
  "paymentDay": "FRIDAY",
  "totalPayments": 16,
  "firstDueDate": "2025-09-09T03:00:00.000Z",
  "loanTrack": "CREDITO-2025-00001",
  "originalAmount": 150000,
  "status": "PENDING",
  "subLoans": [
    {
      "id": "subloan_id",
      "paymentNumber": 1,
      "amount": 9375,
      "totalAmount": 9375,
      "status": "PENDING",
      "dueDate": "2025-09-09T03:00:00.000Z",
      "paidAmount": 0
    }
  ],
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### GET /loans
**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN - Obtener todos los préstamos activos

**Response (200):**
```json
[
  {
    "id": "loan_id",
    "clientId": "client_id",
    "amount": 150000,
    "baseInterestRate": 50,
    "penaltyInterestRate": 0,
    "currency": "ARS",
    "paymentFrequency": "DAILY",
    "status": "PENDING",
    "loanTrack": "CREDITO-2025-00001",
    "client": {
      "id": "client_id",
      "fullName": "Juan Pérez",
      "dni": "12345678",
      "cuit": "20-12345678-9"
    },
    "subLoans": [
      {
        "id": "subloan_id",
        "amount": 9375,
        "totalAmount": 9375,
        "status": "PENDING",
        "dueDate": "2025-09-09T03:00:00.000Z"
      }
    ]
  }
]
```

### GET /loans/pagination
**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN - Obtener préstamos paginados

**Query Parameters:**
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página (default: 10)

**Response (200):**
```json
{
  "data": [
    {
      "id": "loan_id",
      "clientId": "client_id",
      "amount": 150000,
      "baseInterestRate": 50,
      "penaltyInterestRate": 0,
      "currency": "ARS",
      "paymentFrequency": "DAILY",
      "status": "PENDING",
      "loanTrack": "CREDITO-2025-00001",
      "client": {
        "id": "client_id",
        "fullName": "Juan Pérez",
        "dni": "12345678",
        "cuit": "20-12345678-9"
      },
      "subLoans": []
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### GET /loans/tracking
**Público** - Obtener información del préstamo por DNI y código de tracking

**Query Parameters:**
- `dni` (string, required): Número de DNI del cliente
- `tracking` (string, required): Código de tracking del préstamo

**Response (200):**
```json
{
  "id": "loan_id",
  "loanTrack": "CREDITO-2025-00001",
  "amount": 150000,
  "status": "PENDING",
  "client": {
    "fullName": "Juan Pérez",
    "dni": "12345678"
  },
  "subLoans": [
    {
      "paymentNumber": 1,
      "amount": 9375,
      "dueDate": "2025-09-09T03:00:00.000Z",
      "status": "PENDING"
    }
  ]
}
```

### GET /loans/:id
**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN - Obtener préstamo por ID

**Response (200):**
```json
{
  "id": "loan_id",
  "clientId": "client_id",
  "amount": 150000,
  "baseInterestRate": 50,
  "penaltyInterestRate": 0,
  "currency": "ARS",
  "paymentFrequency": "DAILY",
  "status": "PENDING",
  "loanTrack": "CREDITO-2025-00001",
  "client": {
    "id": "client_id",
    "fullName": "Juan Pérez",
    "dni": "12345678"
  },
  "subLoans": []
}
```

---

## 📋 SubLoans

### GET /sub-loans/today-due
**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN - Obtener subloans que vencen hoy (paginado)

**Query Parameters:**
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página, mínimo 20 (default: 20)

**Response (200):**
```json
{
  "data": [
    {
      "id": "subloan_id",
      "loanId": "loan_id",
      "paymentNumber": 1,
      "amount": 9375,
      "totalAmount": 9375,
      "status": "PENDING",
      "dueDate": "2025-09-02T00:00:00.000Z",
      "paidDate": null,
      "paidAmount": 0,
      "daysOverdue": 0,
      "loan": {
        "id": "loan_id",
        "amount": 150000,
        "baseInterestRate": 50,
        "penaltyInterestRate": 0,
        "originalAmount": 150000,
        "client": {
          "id": "client_id",
          "fullName": "Juan Pérez",
          "dni": "12345678",
          "cuit": "20-12345678-9",
          "phone": "1234567890",
          "email": "juan@example.com"
        }
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### GET /sub-loans/today-due/stats
**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN - Obtener estadísticas de subloans que vencen hoy

**Response (200):**
```json
[
  {
    "status": "PENDING",
    "_count": {
      "id": 5
    },
    "_sum": {
      "amount": 46875,
      "totalAmount": 46875
    }
  },
  {
    "status": "OVERDUE",
    "_count": {
      "id": 2
    },
    "_sum": {
      "amount": 18750,
      "totalAmount": 18750
    }
  }
]
```

### POST /sub-loans/activate-today-due
**Roles:** ADMIN, SUPERADMIN - Activar subloans que vencen hoy

**Response (200):**
```json
{
  "message": "Se activaron 5 subloans que vencen hoy",
  "count": 5,
  "subLoanIds": [
    "subloan_id_1",
    "subloan_id_2",
    "subloan_id_3",
    "subloan_id_4",
    "subloan_id_5"
  ]
}
```

---

## ⏰ Scheduled Tasks

### POST /scheduled-tasks/activate-today-due-subloans
**Roles:** ADMIN, SUPERADMIN - Ejecutar manualmente la activación de subloans

**Response (200):**
```json
{
  "message": "Se activaron 5 subloans que vencen hoy",
  "count": 5,
  "subLoanIds": [
    "subloan_id_1",
    "subloan_id_2",
    "subloan_id_3",
    "subloan_id_4",
    "subloan_id_5"
  ]
}
```

---

## 🌐 External API

### POST /external-api/dolar-blue/fetch
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener y persistir datos del Dólar Blue

**Response (201):**
```json
{
  "id": "response_id",
  "compra": 1020.5,
  "venta": 1050.75,
  "fecha": "2024-01-15T10:30:00.000Z",
  "success": true,
  "responseTime": 250,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### GET /external-api/dolar-blue/latest
**Roles:** SUPERADMIN, ADMIN, SUBADMIN, MANAGER - Obtener último dato exitoso del Dólar Blue

**Response (200):**
```json
{
  "id": "response_id",
  "compra": 1020.5,
  "venta": 1050.75,
  "fecha": "2024-01-15T10:30:00.000Z",
  "success": true,
  "responseTime": 250,
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### GET /external-api/dolar-blue/current-rate
**Roles:** SUPERADMIN, ADMIN, SUBADMIN, MANAGER - Obtener tasas de cambio actuales

**Response (200):**
```json
{
  "compra": 1020.5,
  "venta": 1050.75
}
```

### GET /external-api/responses
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener todas las respuestas de API externa paginadas

**Query Parameters:**
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página (default: 10)

**Response (200):**
```json
{
  "data": [
    {
      "id": "response_id",
      "compra": 1020.5,
      "venta": 1050.75,
      "fecha": "2024-01-15T10:30:00.000Z",
      "success": true,
      "responseTime": 250,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### GET /external-api/responses/date-range
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener respuestas de API por rango de fechas

**Query Parameters:**
- `startDate` (string, required): Fecha de inicio (formato ISO)
- `endDate` (string, required): Fecha de fin (formato ISO)
- `page` (number, optional): Número de página (default: 1)
- `limit` (number, optional): Elementos por página (default: 10)

### GET /external-api/stats
**Roles:** SUPERADMIN, ADMIN, SUBADMIN - Obtener estadísticas de llamadas a API externa

**Response (200):**
```json
{
  "totalCalls": 150,
  "successfulCalls": 145,
  "failedCalls": 5,
  "averageResponseTime": 250,
  "lastSuccessfulCall": "2024-01-15T10:30:00.000Z"
}
```

---

## 🏠 App

### GET /
**Público** - Health check

**Response (200):**
```json
"Hello World!"
```

---

## 📝 Notas Importantes

### Transformación de Campos Decimal
Todos los endpoints que devuelven datos con campos numéricos (amount, baseInterestRate, penaltyInterestRate, etc.) los convierten automáticamente de strings a números para facilitar el uso en el frontend.

### Lógica de Domingos
Los subloans que caen en domingo se mueven automáticamente al lunes siguiente para evitar fechas de pago en domingo.

### Cron Job Automático
- **Horario**: Todos los días a las 4:00 AM (hora Argentina)
- **Función**: Cambia el status de subloans `PENDING` que vencen ese día a `OVERDUE`

### Paginación
- **Límite mínimo**: 20 elementos para `/sub-loans/today-due`
- **Límite por defecto**: 10 elementos para la mayoría de endpoints
- **Metadata**: Incluye información de navegación y totales

### Seguridad
- **Autenticación JWT**: Requerida en todos los endpoints excepto los públicos
- **Autorización por roles**: Cada endpoint tiene restricciones de roles específicas
- **Auditoría**: Todos los requests se registran automáticamente
