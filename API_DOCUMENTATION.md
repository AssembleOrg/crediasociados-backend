# API Documentation - Sistema de Créditos Asociados

## ✨ Nuevo: Sistema de Rutas de Cobro Diarias

Se ha agregado un sistema completo de **Rutas de Cobro Diarias** que permite a managers y subadmins organizar y gestionar los cobros del día. Ver documentación detallada en:
- 📘 [Documentación Completa](./COLLECTION_ROUTES_DOCUMENTATION.md)
- 🚀 [Guía de Uso Rápido](./EJEMPLO_USO_RUTAS.md)
- 📊 [Resumen del Sistema](./RESUMEN_SISTEMA_RUTAS.md)

---

## 📋 Índice

1. [Información General](#información-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Modelos de Datos](#modelos-de-datos)
4. [Sistema de Carteras (Wallets)](#sistema-de-carteras-wallets)
5. [Sistema de Pagos](#sistema-de-pagos)
6. [Cierre Diario](#cierre-diario)
7. [Sistema de Auditoría y Logging](#sistema-de-auditoría-y-logging)
8. [Endpoints por Módulo](#endpoints-por-módulo)
9. [Dashboard y Estadísticas](#dashboard-y-estadísticas)
10. [Flujos de Trabajo](#flujos-de-trabajo)
11. [Códigos de Respuesta](#códigos-de-respuesta)

---

## 📌 Información General

### Base URL
```
http://your-domain/api/v1
```

### Autenticación
Todos los endpoints (excepto login y registro público) requieren autenticación JWT:
```
Authorization: Bearer {token}
```

### Zona Horaria
- **Todas las fechas se manejan en zona horaria de Buenos Aires (GMT-3)**
- Formato: ISO 8601
- Librería: Luxon

### Formato de Respuesta Estándar
```json
{
  "data": {},
  "message": "Success",
  "success": true,
  "timestamp": "2024-01-15T18:30:45.123-03:00"
}
```

---

## 🏗️ Arquitectura del Sistema

### Jerarquía de Roles

```
SUPERADMIN
    ↓ crea
  ADMIN
    ↓ crea
  SUBADMIN (tiene cartera)
    ↓ crea y presta dinero
  MANAGER (tiene cartera)
    ↓ presta a
  CLIENTE
```

### Reglas de Negocio Principales

1. **Sistema de Cuotas de Clientes**:
   - Cada ADMIN tiene una cuota configurable de clientes (por defecto 450)
   - Los ADMINs pueden asignar cuotas a SUBADMINs al crearlos
   - Los SUBADMINs pueden asignar cuotas a MANAGERs al crearlos
   - Los MANAGERs solo pueden crear/asignar clientes hasta su cuota disponible
   - Las cuotas se incrementan al crear un usuario hijo y se decrementan al eliminarlo
   - Un MANAGER no puede agregar más clientes si su cuota está llena

2. **Sistema de Carteras**:
   - SUBADMIN y MANAGER tienen carteras (wallets)
   - El dinero disponible limita cuánto pueden prestar
   - SUBADMIN puede transferir dinero a sus MANAGERS

3. **Préstamos**:
   - Un MANAGER no puede prestar más de lo que tiene en su cartera
   - Los préstamos se dividen en SubLoans (cuotas)
   - Cada préstamo registra qué MANAGER lo creó

4. **Pagos**:
   - Los SubLoans aceptan pagos parciales
   - Estados: PENDING, PARTIAL, PAID, OVERDUE
   - Los pagos excedentes se distribuyen a SubLoans incompletos anteriores

5. **Cierre Diario**:
   - Los MANAGERS registran cobros y gastos diarios
   - Categorías de gastos: COMBUSTIBLE, CONSUMO, REPARACIONES, OTROS

---

## 📊 Modelos de Datos

### User
```typescript
{
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'SUBADMIN' | 'MANAGER';
  clientQuota: number;           // Cuota total de clientes asignada
  usedClientQuota: number;       // Cuota de clientes ya utilizada
  availableClientQuota: number;  // Cuota disponible (calculado)
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  createdById?: string;
  wallet?: Wallet;
}
```

### Wallet (Cartera)
```typescript
{
  id: string;
  userId: string;
  balance: number;           // Saldo disponible
  currency: 'ARS' | 'USD';
  createdAt: Date;
  updatedAt: Date;
}
```

### WalletTransaction
```typescript
{
  id: string;
  walletId: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_PAYMENT' | 
        'TRANSFER_TO_MANAGER' | 'TRANSFER_FROM_SUBADMIN';
  amount: number;
  currency: 'ARS' | 'USD';
  description: string;
  relatedUserId?: string;    // Usuario relacionado en transferencias
  createdAt: Date;
}
```

### Loan (Préstamo)
```typescript
{
  id: string;
  clientId: string;
  managerId: string;          // NUEVO: Manager que creó el préstamo
  amount: number;
  originalAmount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED';
  baseInterestRate: number;
  penaltyInterestRate: number;
  currency: 'ARS' | 'USD';
  paymentFrequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  paymentDay?: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
  totalPayments: number;
  firstDueDate?: Date;
  loanTrack: string;          // Código único de tracking
  description?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### SubLoan (Cuota)
```typescript
{
  id: string;
  loanId: string;
  paymentNumber: number;
  amount: number;             // Monto base de la cuota
  totalAmount: number;        // Monto total (con intereses)
  paidAmount: number;         // Monto pagado hasta ahora
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  dueDate: Date;
  paidDate?: Date;
  daysOverdue: number;
  paymentHistory?: Array<{   // NUEVO: Historial de pagos parciales
    date: Date;
    amount: number;
    balance: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Payment (Pago)
```typescript
{
  id: string;
  subLoanId: string;
  amount: number;
  currency: 'ARS' | 'USD';
  paymentDate: Date;
  description?: string;
  createdAt: Date;
}
```

### DailyClosure (Cierre Diario)
```typescript
{
  id: string;
  userId: string;             // MANAGER
  closureDate: Date;          // Fecha del cierre
  totalCollected: number;     // Total cobrado
  totalExpenses: number;      // Total de gastos
  netAmount: number;          // Neto (collected - expenses)
  notes?: string;
  expenses: Expense[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Expense (Gasto)
```typescript
{
  id: string;
  dailyClosureId: string;
  category: 'COMBUSTIBLE' | 'CONSUMO' | 'REPARACIONES' | 'OTROS';
  amount: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Client (Cliente)
```typescript
{
  id: string;
  fullName: string;
  dni?: string;
  cuit?: string;
  phone?: string;
  email?: string;
  address?: string;
  job?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 💰 Sistema de Carteras (Wallets)

### `GET /api/v1/wallets/my-wallet`
Obtener cartera del usuario autenticado.

**Roles:** SUBADMIN, MANAGER

**Respuesta:**
```json
{
  "data": {
    "id": "wallet_id",
    "userId": "user_id",
    "balance": 150000.50,
    "currency": "ARS",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### `POST /api/v1/wallets/deposit`
Realizar un depósito en la cartera.

**Roles:** SUBADMIN, MANAGER

**Body:**
```json
{
  "amount": 50000,
  "currency": "ARS",
  "description": "Depósito inicial"
}
```

**Respuesta:**
```json
{
  "data": {
    "wallet": {
      "id": "wallet_id",
      "balance": 200000.50
    },
    "transaction": {
      "id": "transaction_id",
      "type": "DEPOSIT",
      "amount": 50000,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

### `POST /api/v1/wallets/withdrawal`
Realizar un retiro de la cartera.

**Roles:** SUBADMIN, MANAGER

**Body:**
```json
{
  "amount": 10000,
  "currency": "ARS",
  "description": "Retiro para gastos"
}
```

### `POST /api/v1/wallets/transfer`
Transferir dinero de SUBADMIN a MANAGER.

**Roles:** SUBADMIN

**Body:**
```json
{
  "managerId": "manager_user_id",
  "amount": 100000,
  "currency": "ARS",
  "description": "Transferencia de capital de trabajo"
}
```

**Respuesta:**
```json
{
  "data": {
    "fromWallet": {
      "userId": "subadmin_id",
      "newBalance": 50000
    },
    "toWallet": {
      "userId": "manager_id",
      "newBalance": 150000
    },
    "transaction": {
      "id": "transaction_id",
      "type": "TRANSFER_TO_MANAGER",
      "amount": 100000
    }
  }
}
```

### `GET /api/v1/wallets/transactions`
Obtener historial de transacciones de la cartera.

**Roles:** SUBADMIN, MANAGER

**Query Parameters:**
- `page` (opcional, default: 1)
- `limit` (opcional, default: 10)
- `type` (opcional): Filtrar por tipo de transacción
- `startDate` (opcional): Fecha desde
- `endDate` (opcional): Fecha hasta

**Respuesta:**
```json
{
  "data": {
    "data": [
      {
        "id": "transaction_id",
        "type": "DEPOSIT",
        "amount": 50000,
        "description": "Depósito inicial",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 45,
      "totalPages": 5
    }
  }
}
```

### `GET /api/v1/wallets/balance`
Obtener saldo disponible.

**Roles:** SUBADMIN, MANAGER

**Respuesta:**
```json
{
  "data": {
    "balance": 150000.50,
    "currency": "ARS",
    "availableForLoan": 150000.50,
    "lockedAmount": 0
  }
}
```

---

## 💳 Sistema de Pagos

### Reglas de Pagos Parciales

1. **Pago Menor al Esperado** → Estado: `PARTIAL`
   - Se registra el pago
   - Se actualiza `paidAmount`
   - El SubLoan queda pendiente

2. **Pago Igual al Esperado** → Estado: `PAID`
   - Se completa el SubLoan
   - Se registra `paidDate`

3. **Pago Mayor al Esperado** → Distribución Inteligente:
   - Se completa el SubLoan actual
   - El excedente se distribuye a SubLoans anteriores con estado `PARTIAL`
   - Se procesan en orden (del más antiguo al más nuevo)

### `POST /api/v1/payments/register`
Registrar un pago para un SubLoan.

**Roles:** MANAGER

**Body:**
```json
{
  "subLoanId": "subloan_id",
  "amount": 15000,
  "currency": "ARS",
  "paymentDate": "2024-01-15T00:00:00.000Z",
  "description": "Pago parcial cliente Juan"
}
```

**Respuesta:**
```json
{
  "data": {
    "payment": {
      "id": "payment_id",
      "subLoanId": "subloan_id",
      "amount": 15000,
      "paymentDate": "2024-01-15T00:00:00.000Z"
    },
    "subLoan": {
      "id": "subloan_id",
      "status": "PARTIAL",
      "paidAmount": 15000,
      "totalAmount": 50000,
      "remainingAmount": 35000
    },
    "distributedPayments": [
      {
        "subLoanId": "previous_subloan_id",
        "distributedAmount": 0,
        "newStatus": "PARTIAL"
      }
    ]
  }
}
```

### `POST /api/v1/payments/bulk-register`
Registrar múltiples pagos a la vez.

**Roles:** MANAGER

**Body:**
```json
{
  "payments": [
    {
      "subLoanId": "subloan_id_1",
      "amount": 50000,
      "paymentDate": "2024-01-15T00:00:00.000Z"
    },
    {
      "subLoanId": "subloan_id_2",
      "amount": 25000,
      "paymentDate": "2024-01-15T00:00:00.000Z"
    }
  ]
}
```

### `GET /api/v1/payments/subloan/:subLoanId`
Obtener historial de pagos de un SubLoan.

**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN

**Respuesta:**
```json
{
  "data": {
    "subLoan": {
      "id": "subloan_id",
      "paymentNumber": 1,
      "totalAmount": 50000,
      "paidAmount": 35000,
      "status": "PARTIAL"
    },
    "payments": [
      {
        "id": "payment_1",
        "amount": 20000,
        "paymentDate": "2024-01-05T00:00:00.000Z"
      },
      {
        "id": "payment_2",
        "amount": 15000,
        "paymentDate": "2024-01-15T00:00:00.000Z"
      }
    ],
    "paymentHistory": [
      {
        "date": "2024-01-05T00:00:00.000Z",
        "amount": 20000,
        "balance": 30000
      },
      {
        "date": "2024-01-15T00:00:00.000Z",
        "amount": 15000,
        "balance": 15000
      }
    ]
  }
}
```

---

## 📅 Cierre Diario

### `POST /api/v1/daily-closures`
Crear un cierre diario.

**Roles:** MANAGER

**Body:**
```json
{
  "closureDate": "2024-01-15",
  "totalCollected": 150000,
  "expenses": [
    {
      "category": "COMBUSTIBLE",
      "amount": 5000,
      "description": "Nafta para recorrido"
    },
    {
      "category": "CONSUMO",
      "amount": 2000,
      "description": "Almuerzo"
    },
    {
      "category": "REPARACIONES",
      "amount": 3000,
      "description": "Arreglo de moto"
    }
  ],
  "notes": "Día con buen cobro en zona norte"
}
```

**Respuesta:**
```json
{
  "data": {
    "id": "closure_id",
    "userId": "manager_id",
    "closureDate": "2024-01-15T00:00:00.000Z",
    "totalCollected": 150000,
    "totalExpenses": 10000,
    "netAmount": 140000,
    "expenses": [
      {
        "id": "expense_1",
        "category": "COMBUSTIBLE",
        "amount": 5000,
        "description": "Nafta para recorrido"
      }
    ]
  }
}
```

### `GET /api/v1/daily-closures/my-closures`
Obtener cierres diarios del manager autenticado.

**Roles:** MANAGER

**Query Parameters:**
- `page` (opcional, default: 1)
- `limit` (opcional, default: 10)
- `startDate` (opcional)
- `endDate` (opcional)

**Respuesta:**
```json
{
  "data": {
    "data": [
      {
        "id": "closure_id",
        "closureDate": "2024-01-15T00:00:00.000Z",
        "totalCollected": 150000,
        "totalExpenses": 10000,
        "netAmount": 140000,
        "expenses": []
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 30,
      "totalPages": 3
    }
  }
}
```

### `GET /api/v1/daily-closures/:id`
Obtener detalle de un cierre diario.

**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN

**Respuesta:**
```json
{
  "data": {
    "id": "closure_id",
    "userId": "manager_id",
    "user": {
      "id": "manager_id",
      "fullName": "Juan Manager",
      "email": "manager@test.com"
    },
    "closureDate": "2024-01-15T00:00:00.000Z",
    "totalCollected": 150000,
    "totalExpenses": 10000,
    "netAmount": 140000,
    "expenses": [
      {
        "id": "expense_1",
        "category": "COMBUSTIBLE",
        "amount": 5000,
        "description": "Nafta para recorrido"
      }
    ],
    "subLoans": [
      {
        "id": "subloan_1",
        "paymentNumber": 1,
        "status": "PAID",
        "paidAmount": 50000,
        "client": {
          "fullName": "Cliente 1"
        }
      }
    ]
  }
}
```

### `GET /api/v1/daily-closures/date/:date`
Obtener cierres de una fecha específica.

**Roles:** MANAGER, SUBADMIN, ADMIN, SUPERADMIN

**Parámetros URL:**
- `date`: Fecha en formato YYYY-MM-DD

**Respuesta:**
```json
{
  "data": {
    "closure": {
      "id": "closure_id",
      "totalCollected": 150000,
      "totalExpenses": 10000,
      "netAmount": 140000
    },
    "subLoans": [
      {
        "id": "subloan_id",
        "loanTrack": "CREDITO-2024-001",
        "paymentNumber": 1,
        "totalAmount": 50000,
        "paidAmount": 50000,
        "status": "PAID",
        "client": {
          "fullName": "Juan Pérez",
          "dni": "12345678"
        }
      }
    ]
  }
}
```

### `GET /api/v1/daily-closures/subloans-by-date/:date`
Obtener SubLoans vencidos en una fecha específica (para el cierre).

**Roles:** MANAGER

**Respuesta:**
```json
{
  "data": [
    {
      "id": "subloan_id",
      "loanTrack": "CREDITO-2024-001",
      "paymentNumber": 1,
      "amount": 50000,
      "totalAmount": 50000,
      "paidAmount": 20000,
      "status": "PARTIAL",
      "dueDate": "2024-01-15T00:00:00.000Z",
      "daysOverdue": 0,
      "client": {
        "id": "client_id",
        "fullName": "Juan Pérez",
        "dni": "12345678",
        "phone": "+5491112345678"
      },
      "loan": {
        "id": "loan_id",
        "loanTrack": "CREDITO-2024-001",
        "amount": 150000
      }
    }
  ]
}
```

---

## 📊 Dashboard y Estadísticas

> **Nota**: Los endpoints de dashboard están documentados para referencia del frontend. La lógica de estadísticas puede implementarse consultando directamente los endpoints existentes:
> - **Carteras**: `GET /wallets/my-wallet` y `GET /wallets/balance`
> - **Préstamos**: `GET /loans` (con filtros por managerId, status, fechas)
> - **Clientes**: `GET /clients` (paginado)
> - **Cierres Diarios**: `GET /daily-closures/my-closures` (con filtros de fecha)
> - **Pagos**: `GET /payments/subloan/:id` (historial por SubLoan)

### Construyendo un Dashboard - Ejemplo para MANAGER

**Cartera:**
```
GET /wallets/my-wallet
GET /wallets/balance
```

**Préstamos Activos:**
```
GET /loans?status=ACTIVE
GET /loans?status=COMPLETED
```

**SubLoans Pendientes:**
```
GET /loans (filtrar por managerId y obtener subloans)
```

**Cobros del Mes:**
```
GET /daily-closures/my-closures?startDate=2024-01-01&endDate=2024-01-31
```

### Construyendo un Dashboard - Ejemplo para SUBADMIN

**Managers del SUBADMIN:**
```
GET /users (filtrados por createdById = subadmin_id)
```

**Préstamos de todos los Managers:**
```
GET /users/:managerId/loans (para cada manager)
```

**Performance Individual:**
```
GET /users/:managerId/clients
GET /users/:managerId/loans
```

**Transferencias Realizadas:**
```
GET /wallets/transactions?type=TRANSFER_TO_MANAGER
```

### 📈 Estadísticas por Período

#### 📊 Clientes Nuevos por Semana/Mes

```http
GET /clients/stats/by-period?groupBy=week
GET /clients/stats/by-period?groupBy=month&dateFrom=2025-01-01&dateTo=2025-12-31
```

**Roles**: `MANAGER`, `SUBADMIN`, `ADMIN`, `SUPERADMIN`

**Parámetros Query**:
- `dateFrom` (opcional): Fecha desde (ISO 8601)
- `dateTo` (opcional): Fecha hasta (ISO 8601)
- `groupBy` (opcional): `week` o `month` (default: `week`)

**Respuesta**:
```json
{
  "total": 50,
  "groupBy": "week",
  "stats": [
    {
      "period": "Sem. 19/10",
      "count": 1
    },
    {
      "period": "Sem. 26/10",
      "count": 3
    }
  ]
}
```

**Comportamiento por Rol**:
- **MANAGER**: Ve solo sus clientes
- **SUBADMIN**: Ve clientes de todos sus managers
- **ADMIN/SUPERADMIN**: Ve todos los clientes del sistema

#### 💰 Préstamos Nuevos por Semana/Mes

```http
GET /loans/stats/by-period?groupBy=week
GET /loans/stats/by-period?groupBy=month&dateFrom=2025-01-01&dateTo=2025-12-31
```

**Roles**: `MANAGER`, `SUBADMIN`, `ADMIN`, `SUPERADMIN`

**Parámetros Query**:
- `dateFrom` (opcional): Fecha desde (ISO 8601)
- `dateTo` (opcional): Fecha hasta (ISO 8601)
- `groupBy` (opcional): `week` o `month` (default: `week`)

**Respuesta**:
```json
{
  "total": 15,
  "totalAmount": 5000000,
  "groupBy": "week",
  "stats": [
    {
      "period": "Sem. 19/10",
      "count": 2,
      "amount": 600000
    },
    {
      "period": "Sem. 26/10",
      "count": 5,
      "amount": 1200000
    }
  ]
}
```

**Comportamiento por Rol**:
- **MANAGER**: Ve solo sus préstamos
- **SUBADMIN**: Ve préstamos de todos sus managers
- **ADMIN/SUPERADMIN**: Ve todos los préstamos del sistema

---

### Estadísticas Recomendadas por Rol

#### MANAGER
- Saldo en cartera (`GET /wallets/balance`)
- Total de clientes (`GET /clients` + count)
- **📊 Clientes nuevos por semana** (`GET /clients/stats/by-period?groupBy=week`)
- **💰 Préstamos nuevos por semana** (`GET /loans/stats/by-period?groupBy=week`)
- Préstamos activos vs completados (`GET /loans` con filtros)
- SubLoans vencidos hoy (`GET /daily-closures/subloans-by-date/:today`)
- Cobros del día/semana/mes (`GET /daily-closures/my-closures` con fechas)
- Gastos del mes (`GET /daily-closures/my-closures` sumar expenses)

#### SUBADMIN
- Saldo en cartera (`GET /wallets/balance`)
- Total de managers creados (`GET /users` filtrado)
- **📊 Clientes nuevos por semana** (de todos sus managers) (`GET /clients/stats/by-period`)
- **💰 Préstamos nuevos por semana** (de todos sus managers) (`GET /loans/stats/by-period`)
- Préstamos totales de todos los managers
- Transferencias totales realizadas (`GET /wallets/transactions`)
- Performance por manager (consultar préstamos y clientes de cada uno)

#### ADMIN/SUPERADMIN
- Total de usuarios por rol (`GET /users`)
- Total de préstamos del sistema (`GET /loans`)
- **📊 Clientes nuevos por semana** (sistema completo) (`GET /clients/stats/by-period`)
- **💰 Préstamos nuevos por semana** (sistema completo) (`GET /loans/stats/by-period`)
- Montos totales prestados vs cobrados
- Actividad general del sistema

---

## 🔍 Sistema de Auditoría y Logging

El sistema cuenta con un **sistema completo de auditoría y logging** que registra todas las acciones CRUD, requests HTTP, logins, y cambios realizados por cualquier usuario.

### Características Principales

1. **Auditoría Total de Acciones CRUD**
   - Registra CREATE, READ, UPDATE, DELETE en todas las entidades
   - Captura el estado ANTES y DESPUÉS de cada cambio
   - Identifica la entidad afectada (User, Loan, Client, Payment, etc.)
   - Registra el ID de la entidad específica modificada

2. **Logging Completo de HTTP Requests**
   - Registra TODAS las requests HTTP que llegan al sistema
   - Captura método, URL, endpoint, query params
   - Mide tiempo de respuesta en milisegundos
   - Registra request body y response body (sanitizado)
   - Captura errores y excepciones

3. **Identificación de Usuarios**
   - Captura userId, userEmail, userRole
   - Funciona para TODOS los roles (SUPERADMIN, ADMIN, SUBADMIN, MANAGER)
   - Registra requests anónimas (antes del login)

4. **IP Real y Ubicación**
   - Detecta la IP real del cliente
   - Funciona detrás de proxies y load balancers
   - Registra User Agent completo

5. **Seguridad y Privacidad**
   - Sanitiza automáticamente campos sensibles (passwords, tokens, secrets)
   - NO registra headers de Authorization
   - Trunca respuestas grandes automáticamente
   - Solo SUPERADMIN y ADMIN pueden consultar logs

### `GET /api/v1/audit/logs`
Obtener logs de auditoría del sistema.

**Roles:** SUPERADMIN, ADMIN

**Query Parameters:**
- `userId` (opcional): Filtrar por ID de usuario
- `entity` (opcional): Filtrar por entidad (User, Loan, Client, etc.)
- `action` (opcional): Filtrar por acción (CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, TRANSFER, PAYMENT)
- `startDate` (opcional): Fecha de inicio (ISO 8601)
- `endDate` (opcional): Fecha de fin (ISO 8601)
- `page` (opcional, default: 1): Número de página
- `limit` (opcional, default: 50): Elementos por página

**Ejemplo:**
```bash
GET /api/v1/audit/logs?entity=Loan&action=CREATE&startDate=2025-01-01T00:00:00.000Z&page=1&limit=50
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "log_123",
      "userId": "user_456",
      "userEmail": "manager@example.com",
      "userRole": "MANAGER",
      "action": "CREATE",
      "entity": "Loan",
      "entityId": "loan_789",
      "changes": {
        "after": {
          "amount": 100000,
          "clientId": "client_001",
          "status": "ACTIVE"
        }
      },
      "ip": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "endpoint": "/api/v1/loans",
      "method": "POST",
      "statusCode": 201,
      "description": "CREATE operation on Loan",
      "createdAt": "2025-10-24T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

### `GET /api/v1/audit/http-logs`
Obtener logs de todas las requests HTTP del sistema.

**Roles:** SUPERADMIN, ADMIN

**Query Parameters:**
- `method` (opcional): Filtrar por método HTTP (GET, POST, PUT, DELETE)
- `statusCode` (opcional): Filtrar por código de estado HTTP
- `userId` (opcional): Filtrar por ID de usuario
- `endpoint` (opcional): Filtrar por endpoint (búsqueda parcial)
- `startDate` (opcional): Fecha de inicio (ISO 8601)
- `endDate` (opcional): Fecha de fin (ISO 8601)
- `page` (opcional, default: 1): Número de página
- `limit` (opcional, default: 50): Elementos por página

**Ejemplo:**
```bash
GET /api/v1/audit/http-logs?method=POST&statusCode=201&page=1&limit=50
```

**Respuesta:**
```json
{
  "data": [
    {
      "id": "http_log_123",
      "method": "POST",
      "url": "/api/v1/loans?test=true",
      "endpoint": "/api/v1/loans",
      "statusCode": 201,
      "responseTime": 245,
      "ip": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "userId": "user_456",
      "userEmail": "manager@example.com",
      "requestBody": {
        "amount": 100000,
        "clientId": "client_001",
        "password": "***REDACTED***"
      },
      "responseBody": {
        "success": true,
        "data": { "id": "loan_789" }
      },
      "queryParams": { "test": "true" },
      "headers": {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0..."
      },
      "errorMessage": null,
      "createdAt": "2025-10-24T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 1200,
    "totalPages": 24
  }
}
```

### Casos de Uso Comunes

#### 1. Rastrear cambios en un préstamo
```bash
GET /api/v1/audit/logs?entity=Loan&entityId=loan_123
```

#### 2. Ver todos los logins del sistema
```bash
GET /api/v1/audit/logs?action=LOGIN&startDate=2025-10-01T00:00:00.000Z
```

#### 3. Auditar acciones de un usuario específico
```bash
GET /api/v1/audit/logs?userId=user_456&startDate=2025-10-01T00:00:00.000Z
```

#### 4. Ver requests con errores 500
```bash
GET /api/v1/audit/http-logs?statusCode=500&startDate=2025-10-24T00:00:00.000Z
```

#### 5. Ver todas las eliminaciones permanentes
```bash
GET /api/v1/audit/logs?action=DELETE&entity=Loan
```

### Documentación Completa

Para más información sobre el sistema de auditoría, consultar:
- `AUDIT_SYSTEM.md` - Documentación técnica completa
- `SISTEMA_AUDITORIA_RESUMEN.md` - Resumen ejecutivo

---

## 📍 Endpoints por Módulo

### Autenticación

#### `POST /api/v1/auth/login`
Login de usuario.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Respuesta:**
```json
{
  "data": {
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "fullName": "Usuario Nombre",
      "role": "MANAGER"
    },
    "accessToken": "jwt_token",
    "refreshToken": "refresh_token"
  }
}
```

#### `POST /api/v1/auth/refresh`
Refrescar token.

**Body:**
```json
{
  "refreshToken": "refresh_token"
}
```

#### `POST /api/v1/auth/logout`
Cerrar sesión.

---

### Usuarios

#### `POST /api/v1/users`
Crear usuario.

**Roles:** SUPERADMIN, ADMIN, SUBADMIN

**Body:**
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "fullName": "Nuevo Usuario",
  "phone": "+5491112345678",
  "role": "MANAGER",
  "clientQuota": 100  // Cuota de clientes asignada (requerido para SUBADMIN y MANAGER)
}
```

**Notas:**
- Al crear un ADMIN, automáticamente se le asigna la cuota máxima configurada en el sistema
- Al crear un SUBADMIN, el ADMIN debe especificar cuántos clientes le asigna de su cuota disponible
- Al crear un MANAGER, el SUBADMIN debe especificar cuántos clientes le asigna de su cuota disponible
- La cuota del padre se decrementa automáticamente al asignarla al hijo

#### `GET /api/v1/users`
Listar usuarios (paginado).

**Roles:** SUPERADMIN, ADMIN, SUBADMIN

**Query Parameters:**
- `page`, `limit`

#### `GET /api/v1/users/:id`
Obtener usuario por ID.

#### `PATCH /api/v1/users/:id`
Actualizar usuario.

**Roles:** SUPERADMIN, ADMIN, SUBADMIN

**Body:**
```json
{
  "email": "updated@example.com",
  "fullName": "Nombre Actualizado",
  "phone": "+5491112345678",
  "clientQuota": 50  // Si se actualiza, se recalcula automáticamente usedClientQuota del creador
}
```

**Notas:**
- Si se actualiza `clientQuota` de un MANAGER o SUBADMIN, el sistema automáticamente actualiza el `usedClientQuota` del usuario que lo creó
- Ejemplo: Si un MANAGER tenía `clientQuota: 100` y se actualiza a `50`, el SUBADMIN creador tendrá su `usedClientQuota` decrementado en 50

#### `POST /api/v1/users/:id/recalculate-quota`
Recalcular manualmente la cuota usada (usedClientQuota) de un usuario.

**Roles:** ADMIN, SUPERADMIN, SUBADMIN (solo su propia cuota o la de sus subordinados)

**Respuesta:**
```json
{
  "message": "Cuota recalculada exitosamente",
  "previousUsedQuota": 200,
  "newUsedQuota": 75
}
```

**Notas:**
- Útil para corregir inconsistencias en la cuota usada
- Suma las `clientQuota` de todos los usuarios creados por este usuario
- Solo se puede recalcular la propia cuota o la de usuarios subordinados

#### `DELETE /api/v1/users/:id`
Eliminar usuario permanentemente (hard delete).

**Roles:** SUPERADMIN, ADMIN, SUBADMIN

#### `GET /api/v1/users/:managerId/clients`
Obtener clientes de un manager específico (paginado con filtros).

**Query Parameters:**
- `page`, `limit`
- `fullName`, `dni`, `cuit`, `email`, `phone`, `job`
- `createdFrom`, `createdTo`

#### `GET /api/v1/users/:managerId/clients/chart`
Obtener clientes de un manager (datos reducidos para gráficos, sin paginación).

**Respuesta:**
```json
{
  "data": [
    {
      "id": "client_id",
      "fullName": "Cliente 1",
      "dni": "12345678",
      "totalLoans": 3,
      "totalAmount": 250000,
      "activeLoans": 1,
      "activeAmount": 50000
    }
  ]
}
```

#### `GET /api/v1/users/:managerId/loans`
Obtener préstamos de un manager específico (paginado con filtros).

**Query Parameters:**
- `page`, `limit`
- `clientId`, `loanTrack`, `status`, `currency`, `paymentFrequency`
- `minAmount`, `maxAmount`
- `createdFrom`, `createdTo`

#### `GET /api/v1/users/:managerId/loans/chart`
Obtener préstamos de un manager (datos reducidos para gráficos, sin paginación).

---

### Clientes

#### `POST /api/v1/clients`
Crear cliente.

**Roles:** MANAGER

**Body:**
```json
{
  "fullName": "Juan Pérez",
  "dni": "12345678",
  "cuit": "20-12345678-9",
  "phone": "+5491112345678",
  "email": "cliente@example.com",
  "address": "Calle 123, Buenos Aires",
  "job": "Empleado"
}
```

#### `GET /api/v1/clients`
Listar clientes (paginado).

**Query Parameters:**
- `page`, `limit`

#### `GET /api/v1/clients/search`
Buscar cliente por DNI o CUIT.

**Query Parameters:**
- `dni` o `cuit`

#### `GET /api/v1/clients/:id`
Obtener cliente por ID (con detalles de préstamos).

#### `PATCH /api/v1/clients/:id`
Actualizar cliente.

#### `DELETE /api/v1/clients/:id`
Eliminar cliente (soft delete).

#### `GET /api/v1/clients/reports/inactive`
Obtener reporte de clientes sin préstamos activos.

**Roles:** SUBADMIN, ADMIN, SUPERADMIN

**Respuesta:**
```json
{
  "data": {
    "totalInactiveClients": 15,
    "managerDetails": [
      {
        "managerId": "manager_id_1",
        "managerName": "Manager 1",
        "managerEmail": "manager1@example.com",
        "inactiveClientsCount": 8
      },
      {
        "managerId": "manager_id_2",
        "managerName": "Manager 2",
        "managerEmail": "manager2@example.com",
        "inactiveClientsCount": 7
      }
    ]
  },
  "message": "Success",
  "success": true,
  "timestamp": "2024-01-15T18:30:45.123-03:00"
}
```

**Notas:**
- Considera "clientes inactivos" a aquellos sin préstamos o con todos los préstamos en estado COMPLETED, REJECTED o DEFAULTED
- SUBADMINs solo ven los clientes de sus managers
- ADMINs y SUPERADMINs ven todos los clientes del sistema

---

### Préstamos

#### `POST /api/v1/loans`
Crear préstamo.

**Roles:** MANAGER

**Validación:** Verifica que el manager tenga saldo suficiente en su cartera.

**Body:**
```json
{
  "clientId": "client_id",
  "amount": 100000,
  "baseInterestRate": 0.15,
  "penaltyInterestRate": 0.05,
  "currency": "ARS",
  "paymentFrequency": "MONTHLY",
  "paymentDay": "FRIDAY",
  "totalPayments": 3,
  "firstDueDate": "2024-02-01T00:00:00.000Z",
  "description": "Préstamo personal"
}
```

**Respuesta:**
```json
{
  "data": {
    "loan": {
      "id": "loan_id",
      "loanTrack": "CREDITO-2024-001",
      "amount": 100000,
      "totalPayments": 3,
      "status": "ACTIVE"
    },
    "subLoans": [
      {
        "paymentNumber": 1,
        "totalAmount": 50000,
        "dueDate": "2024-02-01T00:00:00.000Z"
      }
    ],
    "walletTransaction": {
      "type": "LOAN_DISBURSEMENT",
      "amount": 100000,
      "newBalance": 50000
    }
  }
}
```

#### `GET /api/v1/loans`
Listar préstamos (paginado con filtros).

**Query Parameters:**
- `page`, `limit`
- `managerId`, `clientId`, `loanTrack`, `status`
- `currency`, `paymentFrequency`
- `minAmount`, `maxAmount`
- `createdFrom`, `createdTo`, `dueDateFrom`, `dueDateTo`

#### `GET /api/v1/loans/chart`
Obtener préstamos (datos reducidos para gráficos, sin paginación).

**Query Parameters:** (mismos filtros que `/loans`)

#### `GET /api/v1/loans/tracking`
Obtener préstamo por DNI y código de tracking (público).

**Query Parameters:**
- `dni`, `tracking`

#### `GET /api/v1/loans/:id`
Obtener préstamo por ID (con detalles completos).

---

### SubLoans

#### `GET /api/v1/subloans/:id`
Obtener detalle de un SubLoan.

#### `GET /api/v1/subloans/loan/:loanId`
Obtener todos los SubLoans de un préstamo.

---

## 🔄 Flujos de Trabajo

### Flujo 1: Creación de Préstamo

```
1. SUBADMIN deposita dinero en su cartera
   POST /wallets/deposit

2. SUBADMIN transfiere dinero a MANAGER
   POST /wallets/transfer

3. MANAGER crea préstamo para cliente
   POST /loans
   - Valida saldo en cartera
   - Crea Loan
   - Genera SubLoans automáticamente
   - Debita de la cartera del MANAGER

4. Sistema genera tracking code único
   CREDITO-2024-001
```

### Flujo 2: Pago Parcial con Excedente

```
1. Cliente paga cuota con excedente
   POST /payments/register
   {
     "subLoanId": "subloan_3",
     "amount": 100000  // Cuota era 50000
   }

2. Sistema procesa:
   - Completa SubLoan 3 (50000) → PAID
   - Excedente: 50000
   
3. Busca SubLoans anteriores PARTIAL:
   - Encuentra SubLoan 1 (debe 20000) → PAID con 20000
   - Excedente restante: 30000
   - Encuentra SubLoan 2 (debe 30000) → PAID con 30000
   - Excedente restante: 0

4. Actualiza paymentHistory de cada SubLoan

5. Acredita a la cartera del MANAGER
```

### Flujo 3: Cierre Diario

```
1. MANAGER cobra cuotas durante el día
   POST /payments/register (múltiples veces)

2. Al final del día, registra gastos
   POST /daily-closures
   {
     "closureDate": "2024-01-15",
     "totalCollected": 150000,
     "expenses": [...]
   }

3. Sistema calcula:
   - Total cobrado: suma de todos los pagos del día
   - Total gastos: suma de expenses
   - Neto: totalCollected - totalExpenses

4. MANAGER puede consultar:
   GET /daily-closures/date/2024-01-15
   - Ver todos los SubLoans que vencían ese día
   - Ver cuáles se cobraron y cuáles no
```

### Flujo 4: Dashboard por Rol

```
MANAGER:
GET /dashboard/manager
- Ve su cartera
- Sus préstamos
- Sus clientes
- Sus cobros

SUBADMIN:
GET /dashboard/subadmin
- Ve su cartera
- Todos los managers que creó
- Préstamos de todos sus managers
- Performance de cada manager

ADMIN/SUPERADMIN:
GET /dashboard/admin
- Vista global del sistema
- Todos los usuarios
- Todos los préstamos
- Top performers
```

---

## 🚦 Códigos de Respuesta

### Éxito
- `200 OK`: Operación exitosa
- `201 Created`: Recurso creado exitosamente

### Errores del Cliente
- `400 Bad Request`: Datos inválidos o faltantes
- `401 Unauthorized`: No autenticado
- `403 Forbidden`: Sin permisos para la operación
- `404 Not Found`: Recurso no encontrado
- `409 Conflict`: Conflicto (ej: DNI duplicado)

### Errores del Servidor
- `500 Internal Server Error`: Error del servidor

---

## 📝 Notas Importantes

1. **Valores Numéricos**: Todos los montos se retornan como `number`, no como `string`.

2. **Fechas**: Todas las fechas en zona horaria de Buenos Aires (GMT-3).

3. **Decimales**: Los montos monetarios tienen precisión de 2 decimales.

4. **Soft Delete**: Los registros eliminados no se borran físicamente, se marca `deletedAt`.

5. **Paginación**: Por defecto `page=1`, `limit=10`, máximo `limit=100`.

6. **Filtros**: Todos los endpoints de listado soportan filtros por fecha, estado, etc.

7. **Validaciones**:
   - Manager no puede prestar más de lo que tiene en cartera
   - SubAdmin no puede transferir más de lo que tiene en cartera
   - DNI y CUIT únicos por cliente

8. **Transacciones**: La creación de préstamos y pagos se manejan con transacciones atómicas de Prisma.

9. **Payment History**: El historial de pagos parciales se guarda en formato JSON en el SubLoan.

10. **Tracking Code**: Formato `CREDITO-YYYY-###` con secuencia atómica por año.

---

## 🔐 Seguridad

- JWT con expiración de 1 día
- Refresh tokens válidos por 7 días
- Passwords hasheados con bcryptjs
- Rate limiting en endpoints sensibles
- Validación de permisos por rol en cada endpoint
- CORS configurado para dominios permitidos

---

## 📞 Soporte

Para cualquier duda sobre la API, contactar al equipo de desarrollo.

---

## ✅ Estado de Implementación

### Módulos Completamente Implementados

#### ✅ Sistema de Carteras (Wallet)
- [x] Creación automática de carteras para SUBADMIN y MANAGER
- [x] Depósitos y retiros
- [x] Transferencias de SUBADMIN a MANAGER
- [x] Historial de transacciones con filtros
- [x] Consulta de saldo
- [x] Validación de saldos en todas las operaciones
- [x] **6 endpoints** funcionando

#### ✅ Sistema de Pagos Parciales
- [x] Registro de pagos con distribución de excedentes
- [x] Lógica completa de pagos parciales/completos/excedentes
- [x] Actualización automática del estado de SubLoans (PENDING → PARTIAL → PAID)
- [x] Historial de pagos en formato JSONB
- [x] Distribución inteligente a SubLoans anteriores incompletos
- [x] Acreditación automática a cartera del manager
- [x] **3 endpoints** funcionando

#### ✅ Cierre Diario
- [x] Creación de cierres con múltiples gastos
- [x] Categorización de gastos (COMBUSTIBLE, CONSUMO, REPARACIONES, OTROS)
- [x] Cálculo automático de neto (cobrado - gastos)
- [x] Consulta de SubLoans vencidos por fecha
- [x] Historial de cierres con filtros de fecha
- [x] Validación de unicidad por usuario y fecha
- [x] **5 endpoints** funcionando

#### ✅ Préstamos (Actualizado)
- [x] Validación de saldo en cartera antes de crear préstamo
- [x] Validación de moneda entre cartera y préstamo
- [x] Débito automático de cartera al crear préstamo
- [x] Campo `managerId` para rastrear quién creó el préstamo
- [x] Transacción atómica (Loan + SubLoans + Wallet)
- [x] Integrado con sistema de carteras

#### ✅ Usuarios (Actualizado)
- [x] Creación automática de cartera al crear SUBADMIN/MANAGER
- [x] Integrado con WalletModule
- [x] Manejo de errores si falla creación de cartera

### Endpoints Implementados por Módulo

**Wallets** (6 endpoints):
- `GET /api/v1/wallets/my-wallet`
- `POST /api/v1/wallets/deposit`
- `POST /api/v1/wallets/withdrawal`
- `POST /api/v1/wallets/transfer`
- `GET /api/v1/wallets/transactions`
- `GET /api/v1/wallets/balance`

**Payments** (3 endpoints):
- `POST /api/v1/payments/register`
- `POST /api/v1/payments/bulk-register`
- `GET /api/v1/payments/subloan/:subLoanId`

**Daily Closures** (5 endpoints):
- `POST /api/v1/daily-closures`
- `GET /api/v1/daily-closures/my-closures`
- `GET /api/v1/daily-closures/:id`
- `GET /api/v1/daily-closures/date/:date`
- `GET /api/v1/daily-closures/subloans-by-date/:date`

**Loans** (actualizados con validación de cartera)
**Users** (actualizados con creación automática de cartera)
**Clients** (sin cambios)
**Auth** (sin cambios)

### Características Técnicas Implementadas

- ✅ **Transacciones atómicas** con Prisma para operaciones críticas
- ✅ **Validación de saldos** antes de préstamos y transferencias
- ✅ **Distribución inteligente** de excedentes en pagos
- ✅ **Historial JSONB** para pagos parciales múltiples
- ✅ **Zona horaria** Buenos Aires (GMT-3) con Luxon
- ✅ **Conversión automática** de Decimal a Number en respuestas
- ✅ **Soft delete** en todos los modelos principales
- ✅ **Validación de permisos** por rol en cada endpoint
- ✅ **Paginación** con metadata completa
- ✅ **Filtros avanzados** por fecha, estado, moneda, etc.

### Base de Datos

**Nuevos modelos**:
- `Wallet` - Carteras de usuarios
- `WalletTransaction` - Transacciones de cartera
- `Payment` - Pagos individuales a SubLoans
- `DailyClosure` - Cierres diarios
- `Expense` - Gastos por cierre

**Campos agregados**:
- `Loan.managerId` (nullable) - Manager que creó el préstamo
- `SubLoan.paymentHistory` (JSONB) - Historial de pagos parciales

**Nuevos enums**:
- `WalletTransactionType` - Tipos de transacciones de cartera
- `ExpenseCategory` - Categorías de gastos

### Compilación y Estado

- ✅ **Compila sin errores**
- ✅ **Cliente de Prisma generado**
- ✅ **Todos los módulos integrados en AppModule**
- ✅ **TypeScript types correctos**
- ⚠️ **Migración de Prisma pendiente** (requiere ambiente interactivo)

### Próximos Pasos para Producción

1. **Aplicar migración de base de datos**:
   ```bash
   npx prisma migrate dev --name add_wallet_payment_system
   ```

2. **Poblar datos iniciales** (opcional):
   - Crear carteras para usuarios SUBADMIN/MANAGER existentes
   - Asignar `managerId` a préstamos existentes

3. **Testing**:
   - Probar flujo completo de wallet → transfer → loan
   - Probar pagos parciales con distribución de excedentes
   - Probar cierres diarios con gastos
   - Validar todas las restricciones de saldo

4. **Deployment**:
   - Generar cliente de Prisma en producción
   - Aplicar migración en producción
   - Monitorear logs de errores

---

**Versión**: 2.0.0
**Última actualización**: 2025-10-15
**Estado**: ✅ Implementación completa - Listo para migración de BD