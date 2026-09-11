# Velozity Real-Time Client Project Dashboard

A full-stack project dashboard built as part of the Velozity Global Solutions Full Stack Developer Technical Hiring Assessment.

The application is designed for a small agency to manage clients, projects, tasks, team activity, notifications, and real-time updates based on user roles.

## Live Application

**Frontend:** `https://YOUR-VERCEL-APP.vercel.app`

**Backend:** `https://YOUR-BACKEND-URL`

> The frontend is deployed on Vercel. The Express + Socket.IO backend is hosted separately on a WebSocket-capable Node.js host.

---

## Features

* Role-based login with Admin, Project Manager, and Developer roles
* Client and project management
* Task creation and assignment
* Task status and priority management
* Project activity feed
* Real-time task/activity updates using Socket.IO
* Role-filtered project updates
* User presence support
* Notifications
* Overdue task detection
* JWT-based authentication
* Refresh token handling using secure HttpOnly cookies
* PostgreSQL database with Prisma ORM
* Input validation using Zod
* Database indexes for frequently queried fields

---

## Tech Stack

### Frontend

* React
* TypeScript
* Vite

### Backend

* Node.js
* Express
* TypeScript
* Socket.IO

### Database

* PostgreSQL
* Prisma ORM

### Other

* JWT
* bcryptjs
* Zod
* node-cron
* Docker / Docker Compose

---

# Architecture

The application follows a simple client-server architecture:

```text
┌─────────────────────────────┐
│        React + Vite         │
│          Frontend           │
└──────────────┬──────────────┘
               │
               │ REST API
               │ WebSocket
               ▼
┌─────────────────────────────┐
│     Node.js + Express       │
│        + Socket.IO           │
│                             │
│ Authentication              │
│ Authorization               │
│ Business Logic              │
│ Real-time Events            │
│ Background Jobs             │
└──────────────┬──────────────┘
               │
               │ Prisma
               ▼
┌─────────────────────────────┐
│         PostgreSQL          │
└─────────────────────────────┘
```

The backend API is the security boundary. Authentication and role/resource authorization are handled on the server rather than relying on frontend restrictions.

The frontend is responsible mainly for presentation and user interaction.

---

# User Roles

The application supports three roles:

| Role          | Responsibility                                    |
| ------------- | ------------------------------------------------- |
| **Admin**     | Administrative access and user/project management |
| **PM**        | Project and task management                       |
| **Developer** | Assigned task work and project activity           |

Authorization is checked on the backend for protected resources.

---

# Real-Time Role-Filtered Feed

Real-time updates are implemented using Socket.IO.

When an important project event occurs, such as a task status change or assignment, the backend creates an activity record and emits the corresponding Socket.IO event.

Users join project-specific rooms instead of receiving every project event.

```text
User
  │
  │ connects
  ▼
Socket.IO Server
  │
  ├── Project Room A
  │      ├── PM
  │      └── Developer
  │
  └── Project Room B
         ├── PM
         └── Developer
```

This prevents unrelated project updates from being broadcast to every connected user.

The server remains responsible for deciding whether a user is allowed to access a project. The database-backed activity feed also provides a way to recover information that may have been missed while a client was disconnected.

---

# Architectural Decisions

## Why Socket.IO?

I used Socket.IO instead of implementing real-time communication directly with the native WebSocket API.

Socket.IO provides:

* Bidirectional communication
* Automatic reconnection
* Rooms
* Event-based communication
* Connection and presence handling

Project-specific rooms make it easier to send updates only to users who are currently working with the relevant project.

For example, a task update in Project A does not need to be broadcast to users who are only viewing Project B.

---

## Why node-cron?

The application needs a recurring check for overdue tasks.

For this assessment, I used `node-cron` because the requirement is a relatively small recurring database operation and does not require a distributed job-processing system.

The worker periodically checks task due dates and handles overdue tasks independently of page loads.

For a larger production system running across multiple backend instances, I would move this work to a dedicated worker and use a queue such as BullMQ with Redis.

---

## Token Storage

The application uses JWT authentication with two types of tokens:

* Short-lived access token
* Refresh token

The access token is kept in client memory instead of `localStorage`.

The refresh token is stored in an HttpOnly, SameSite cookie. This prevents JavaScript running in the browser from directly accessing the refresh token.

A page refresh can therefore obtain a new access token using the refresh cookie.

For production, cookies should be configured with secure settings when the application is served over HTTPS.

---

# Database Schema

The application uses PostgreSQL with Prisma.

Main entities:

```text
User
 │
 ├── creates ───────────────► Project
 │
 ├── assigned to ───────────► Task
 │
 ├── creates ───────────────► Activity
 │
 ├── receives ──────────────► Notification
 │
 └── owns ──────────────────► RefreshToken


Client
 │
 └── has ───────────────────► Project


Project
 │
 ├── belongs to ────────────► Client
 ├── created by ────────────► User
 ├── contains ──────────────► Task
 └── contains ──────────────► Activity


Task
 │
 ├── belongs to ────────────► Project
 ├── assigned to ───────────► User
 └── has ───────────────────► Activity


Activity
 │
 ├── belongs to ────────────► Project
 ├── optionally references ─► Task
 └── created by ────────────► User
```

### Tables

**User**

Stores application users, their roles, password hashes, and relationships with projects, tasks, activities, notifications, and refresh tokens.

**Client**

Stores client information such as name, company, and email.

**Project**

Stores projects belonging to a client and created by a user. A project can contain multiple tasks and activities.

**Task**

Stores task details including status, priority, due date, project, and assigned developer.

**Activity**

Stores project activity such as task status changes and task assignments. Activity records are also useful for recovering information that may have been missed through a real-time connection.

**Notification**

Stores user-specific notifications and their read/unread state.

**RefreshToken**

Stores hashed refresh tokens, their associated user, and expiration time.

### Important relationships

* One Client can have many Projects.
* One Project can have many Tasks.
* One Project can have many Activities.
* One User can create many Projects.
* One Developer can be assigned many Tasks.
* One User can receive many Notifications.
* One User can have multiple RefreshToken records.

---

# Database Indexing

Indexes were added to fields that are frequently used for filtering and sorting:

```text
Task(projectId, status)
Task(assignedDeveloperId, status)
Task(dueDate)
Task(priority)

Activity(projectId, createdAt)
Activity(actorId, createdAt)

Notification(userId, isRead, createdAt)

Project(creatorId)
Project(clientId)

RefreshToken(userId)

User(email) -- unique
```

These indexes help queries involving project tasks, developer assignments, activity feeds, notifications, and authentication.

---

# Local Setup

## Requirements

Install the following before starting:

* Node.js 20+
* Docker Desktop
* Git
* npm

Docker is preferred for running PostgreSQL locally because it keeps the database setup consistent between environments.

---

## 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd YOUR_PROJECT_FOLDER
```

---

## 2. Start PostgreSQL

From the project root:

```bash
docker compose up -d db
```

Check that the database container is running:

```bash
docker compose ps
```

---

## 3. Configure the server

Open a terminal:

```bash
cd server
```

Install dependencies:

```bash
npm install
```

Create the environment file:

### Windows

```powershell
copy .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Update `.env` with the required database and application configuration.

Example:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/DATABASE_NAME"
JWT_SECRET="your-development-secret"
CLIENT_URL="http://localhost:5173"
```

Do not commit the `.env` file to GitHub.

---

## 4. Create the database schema

Run:

```bash
npx prisma migrate dev --name init
```

---

## 5. Seed demo data

Run:

```bash
npm run seed
```

The seed script creates demo users, clients, projects, tasks, activities, and notifications.

---

## 6. Start the backend

Run:

```bash
npm run dev
```

The backend will run on:

```text
http://localhost:4000
```

---

## 7. Start the frontend

Open another terminal from the project root:

```bash
cd client
```

Install dependencies:

```bash
npm install
```

Create the environment file:

### Windows

```powershell
copy .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Then start the development server:

```bash
npm run dev
```

The frontend will normally be available at:

```text
http://localhost:5173
```

---

# Demo Login Credentials

The seed script creates demo accounts for testing.

**Password for all seeded users:**

```text
Password@123
```

### Admin

```text
admin@velozity.local
```

### Project Managers

```text
pm1@velozity.local
pm2@velozity.local
```

### Developers

```text
dev1@velozity.local
dev2@velozity.local
dev3@velozity.local
dev4@velozity.local
```

These accounts are intended only for local/demo assessment use.

---

# Production Deployment

The frontend can be deployed on Vercel.

Because the backend uses a persistent Socket.IO connection, the Express + Socket.IO server should run on a WebSocket-capable Node.js hosting environment rather than as a standard serverless function.

The production setup is therefore:

```text
                    ┌───────────────┐
                    │    Vercel     │
                    │ React + Vite  │
                    └───────┬───────┘
                            │
                      HTTPS / Socket.IO
                            │
                            ▼
                    ┌───────────────┐
                    │ Node.js Host  │
                    │ Express       │
                    │ Socket.IO     │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ PostgreSQL    │
                    │ Managed DB    │
                    └───────────────┘
```

Production environment variables should include appropriate values for:

```text
DATABASE_URL
JWT_SECRET
CLIENT_URL
COOKIE_SECURE
```

A strong secret should be used for `JWT_SECRET`.

When running behind HTTPS, secure cookies should be enabled.

---

# Known Limitations

### 1. Process-local presence

Presence information is currently maintained by the backend process.

This works well for a single backend instance, but a horizontally scaled deployment would need shared presence/state, such as Redis and the Socket.IO Redis adapter.

### 2. In-memory access token

The access token is intentionally stored in client memory.

This avoids putting the access token in `localStorage`, but it means a page reload requires the refresh token flow to obtain a new access token.

### 3. node-cron worker

The overdue-task worker runs periodically rather than using a distributed job queue.

For a multi-instance production deployment, I would move scheduled work to a dedicated worker with a queue such as BullMQ and Redis.

### 4. Demo seed data

The repository includes sample users and project data for assessment/testing purposes. These credentials and records should not be used as production data.

---

# What I Would Improve for Production

If this application were taken beyond the assessment, I would consider:

* Redis-backed Socket.IO scaling and presence
* BullMQ/Redis for background jobs
* Centralized logging and monitoring
* Automated tests and CI/CD
* Rate limiting for authentication endpoints
* More granular permissions
* Production-grade secret management
* Automated database backups
* More extensive error tracking

---

# Assessment Explanation

The hardest part of this project was coordinating authentication, authorization, database updates, and real-time changes without making the frontend responsible for security. I kept the API as the security boundary, so every protected request checks the user's identity and role before accessing a resource. For real-time updates, I used Socket.IO project rooms. When a task changes, the server stores an activity record and emits an event to the relevant project room instead of broadcasting the update to every connected user. This keeps the feed relevant to the user's project context. The database activity feed also acts as a recovery mechanism if a user misses a WebSocket event while disconnected. I chose node-cron for overdue-task checks because the assessment only requires a simple recurring database operation; a distributed queue would add unnecessary complexity at this stage. If I were doing the project again, I would design the background-job layer around a dedicated queue such as BullMQ with Redis from the beginning. That would make the overdue processing and future scheduled jobs easier to scale across multiple backend instances. I would also add more automated integration tests around authorization and real-time event delivery.

---

# Project Structure

```text
project-root/
│
├── client/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── .env.example
│
├── server/
│   ├── src/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── package.json
│   └── .env.example
│
├── docker-compose.yml
├── README.md
└── .gitignore
```

---


