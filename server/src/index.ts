import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Server } from "socket.io";
import cron from "node-cron";
import { z } from "zod";
import {
  PrismaClient, Role, TaskStatus, Priority, ActivityType
} from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }
});

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

type AuthUser = { id: string; name: string; role: Role; email: string };
type AuthedRequest = Request & { user?: AuthUser };

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 7;

function accessToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function safeUser(u: any): AuthUser {
  return { id: u.id, name: u.name, role: u.role, email: u.email };
}
function error(res: Response, status: number, message: string, details?: unknown) {
  return res.status(status).json({ success: false, error: { message, details } });
}
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return error(res, 401, "Authentication required");
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    next();
  } catch {
    return error(res, 401, "Invalid or expired access token");
  }
}
function roles(...allowed: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) return error(res, 403, "Forbidden");
    next();
  };
}
async function projectAllowed(user: AuthUser, projectId: string) {
  if (user.role === Role.ADMIN) return true;
  if (user.role === Role.PM) {
    return !!await prisma.project.findFirst({ where: { id: projectId, creatorId: user.id } });
  }
  return !!await prisma.task.findFirst({ where: { projectId, assignedDeveloperId: user.id } });
}
async function taskAllowed(user: AuthUser, taskId: number) {
  if (user.role === Role.ADMIN) return true;
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true, assignedDeveloperId: true } });
  if (!task) return false;
  if (user.role === Role.PM) return !!await prisma.project.findFirst({ where: { id: task.projectId, creatorId: user.id } });
  return task.assignedDeveloperId === user.id;
}
function emitActivity(activity: any) {
  io.to(`project:${activity.projectId}`).emit("activity:new", activity);
  io.to("role:ADMIN").emit("activity:global", activity);
}
function notify(userId: string, notification: any) {
  io.to(`user:${userId}`).emit("notification:new", notification);
}

app.get("/health", (_req, res) => res.json({ success: true, service: "velozity-dashboard" }));

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 400, "Invalid login input", parsed.error.flatten());
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return error(res, 401, "Invalid email or password");

  const safe = safeUser(user);
  const access = accessToken(safe);
  const refresh = crypto.randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(refresh), userId: user.id, expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400000) }
  });
  res.cookie("refreshToken", refresh, {
    httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "lax",
    maxAge: REFRESH_DAYS * 86400000, path: "/api/auth"
  });
  res.json({ success: true, accessToken: access, user: safe });
});

app.post("/api/auth/refresh", async (req, res) => {
  const raw = req.cookies.refreshToken;
  if (!raw) return error(res, 401, "Refresh token missing");
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!stored || stored.expiresAt < new Date()) return error(res, 401, "Refresh token expired");
  const user = safeUser(stored.user);
  res.json({ success: true, accessToken: accessToken(user), user });
});

app.post("/api/auth/logout", async (req, res) => {
  const raw = req.cookies.refreshToken;
  if (raw) await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
  res.clearCookie("refreshToken", { httpOnly: true, sameSite: "lax", path: "/api/auth" });
  res.json({ success: true });
});

app.get("/api/me", auth, async (req: AuthedRequest, res) => res.json({ success: true, user: req.user }));

app.get("/api/clients", auth, roles(Role.ADMIN, Role.PM), async (_req, res) => {
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
  res.json({ success: true, clients });
});

app.post("/api/clients", auth, roles(Role.ADMIN), async (req, res) => {
  const p = z.object({ name: z.string().min(2), company: z.string().optional(), email: z.string().email().optional() }).safeParse(req.body);
  if (!p.success) return error(res, 400, "Invalid client data");
  const client = await prisma.client.create({ data: p.data });
  res.status(201).json({ success: true, client });
});

app.get("/api/projects", auth, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const where: any = user.role === Role.ADMIN ? {} : user.role === Role.PM
    ? { creatorId: user.id }
    : { tasks: { some: { assignedDeveloperId: user.id } } };
  const projects = await prisma.project.findMany({
    where, include: { client: true, creator: { select: { id: true, name: true } },
      _count: { select: { tasks: true } } }, orderBy: { updatedAt: "desc" }
  });
  res.json({ success: true, projects });
});

app.post("/api/projects", auth, roles(Role.ADMIN, Role.PM), async (req: AuthedRequest, res) => {
  const p = z.object({ name: z.string().min(2), description: z.string().optional(), clientId: z.string() }).safeParse(req.body);
  if (!p.success) return error(res, 400, "Invalid project data");
  const project = await prisma.project.create({ data: { ...p.data, creatorId: req.user!.id } });
  res.status(201).json({ success: true, project });
});

app.get("/api/projects/:projectId/tasks", auth, async (req: AuthedRequest, res) => {
  const projectId = req.params.projectId;
  if (!(await projectAllowed(req.user!, projectId))) return error(res, 403, "You cannot access this project");
  const q = z.object({
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
  }).safeParse(req.query);
  if (!q.success) return error(res, 400, "Invalid filters");
  const where: any = { projectId };
  if (req.user!.role === Role.DEVELOPER) where.assignedDeveloperId = req.user!.id;
  if (q.data.status) where.status = q.data.status;
  if (q.data.priority) where.priority = q.data.priority;
  if (q.data.from || q.data.to) where.dueDate = { ...(q.data.from ? { gte: new Date(q.data.from) } : {}), ...(q.data.to ? { lte: new Date(q.data.to) } : {}) };
  const tasks = await prisma.task.findMany({
    where, include: { assignedDeveloper: { select: { id: true, name: true } } },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }]
  });
  res.json({ success: true, tasks });
});

app.post("/api/projects/:projectId/tasks", auth, roles(Role.ADMIN, Role.PM), async (req: AuthedRequest, res) => {
  const projectId = req.params.projectId;
  if (!(await projectAllowed(req.user!, projectId))) return error(res, 403, "You cannot manage this project");
  const p = z.object({
    title: z.string().min(2), description: z.string().optional(),
    assignedDeveloperId: z.string().optional(), status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
    priority: z.nativeEnum(Priority).default(Priority.MEDIUM), dueDate: z.string().datetime()
  }).safeParse(req.body);
  if (!p.success) return error(res, 400, "Invalid task data", p.error.flatten());
  if (p.data.assignedDeveloperId) {
    const dev = await prisma.user.findFirst({ where: { id: p.data.assignedDeveloperId, role: Role.DEVELOPER } });
    if (!dev) return error(res, 400, "Assigned user must be a developer");
  }
  const task = await prisma.task.create({ data: { ...p.data, projectId, dueDate: new Date(p.data.dueDate) } });
  if (task.assignedDeveloperId) {
    const n = await prisma.notification.create({
      data: { userId: task.assignedDeveloperId, title: "New task assigned", body: `You were assigned "${task.title}".` }
    });
    notify(task.assignedDeveloperId, n);
  }
  res.status(201).json({ success: true, task });
});

app.patch("/api/tasks/:taskId/status", auth, async (req: AuthedRequest, res) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId) || !(await taskAllowed(req.user!, taskId))) return error(res, 403, "You cannot update this task");
  const p = z.object({ status: z.nativeEnum(TaskStatus).refine(v => v !== TaskStatus.OVERDUE) }).safeParse(req.body);
  if (!p.success) return error(res, 400, "Invalid status");
  const old = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true, assignedDeveloper: true } });
  if (!old) return error(res, 404, "Task not found");
  const updated = await prisma.task.update({ where: { id: taskId }, data: { status: p.data.status } });
  if (old.status !== updated.status) {
    const activity = await prisma.activity.create({
      data: {
        type: ActivityType.TASK_STATUS_CHANGED,
        message: `${req.user!.name} moved Task #${taskId} from ${old.status.replaceAll("_", " ")} → ${updated.status.replaceAll("_", " ")}`,
        projectId: old.projectId, taskId, actorId: req.user!.id,
        metadata: { from: old.status, to: updated.status }
      },
      include: { actor: { select: { id: true, name: true } } }
    });
    emitActivity(activity);

    if (updated.status === TaskStatus.IN_REVIEW && old.project.creatorId !== req.user!.id) {
      const n = await prisma.notification.create({
        data: { userId: old.project.creatorId, title: "Task ready for review", body: `${req.user!.name} moved "${old.title}" to In Review.` }
      });
      notify(old.project.creatorId, n);
    }
  }
  res.json({ success: true, task: updated });
});

app.get("/api/projects/:projectId/activity", auth, async (req: AuthedRequest, res) => {
  const projectId = req.params.projectId;
  if (!(await projectAllowed(req.user!, projectId))) return error(res, 403, "You cannot access this project");
  const activities = await prisma.activity.findMany({
    where: { projectId }, include: { actor: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" }, take: 20
  });
  res.json({ success: true, activities: activities.reverse() });
});

app.get("/api/activity/global", auth, roles(Role.ADMIN), async (_req, res) => {
  const activities = await prisma.activity.findMany({
    include: { actor: { select: { id: true, name: true } }, task: { select: { id: true, title: true } }, project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }, take: 50
  });
  res.json({ success: true, activities });
});

app.get("/api/notifications", auth, async (req: AuthedRequest, res) => {
  const notifications = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const unread = notifications.filter(n => !n.isRead).length;
  res.json({ success: true, notifications, unread });
});
app.patch("/api/notifications/:id/read", auth, async (req: AuthedRequest, res) => {
  const n = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { isRead: true } });
  res.json({ success: true, updated: n.count });
});
app.patch("/api/notifications/read-all", auth, async (req: AuthedRequest, res) => {
  const n = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  res.json({ success: true, updated: n.count });
});

app.get("/api/users/developers", auth, roles(Role.ADMIN, Role.PM), async (_req, res) => {
  const developers = await prisma.user.findMany({ where: { role: Role.DEVELOPER }, select: { id: true, name: true, email: true } });
  res.json({ success: true, developers });
});

app.get("/api/dashboard", auth, async (req: AuthedRequest, res) => {
  const u = req.user!;
  if (u.role === Role.ADMIN) {
    const [projects, tasksByStatus, overdue] = await Promise.all([
      prisma.project.count(),
      prisma.task.groupBy({ by: ["status"], _count: true }),
      prisma.task.count({ where: { status: TaskStatus.OVERDUE } })
    ]);
    return res.json({ success: true, role: u.role, projects, tasksByStatus, overdue });
  }
  if (u.role === Role.PM) {
    const projectIds = (await prisma.project.findMany({ where: { creatorId: u.id }, select: { id: true } })).map(p => p.id);
    const [projects, priority] = await Promise.all([
      prisma.project.findMany({ where: { creatorId: u.id }, include: { _count: { select: { tasks: true } } } }),
      prisma.task.groupBy({ by: ["priority"], where: { projectId: { in: projectIds } }, _count: true })
    ]);
    return res.json({ success: true, role: u.role, projects, priority });
  }
  const tasks = await prisma.task.findMany({
    where: { assignedDeveloperId: u.id },
    include: { project: { select: { name: true } } },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }]
  });
  res.json({ success: true, role: u.role, tasks });
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    (socket.data as any).user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch { next(new Error("Invalid socket token")); }
});

io.on("connection", socket => {
  const user = socket.data.user as AuthUser;
  socket.join(`user:${user.id}`);
  socket.join(`role:${user.role}`);
  socket.on("project:join", async (projectId: string) => {
    if (await projectAllowed(user, projectId)) socket.join(`project:${projectId}`);
  });
  socket.on("project:leave", (projectId: string) => socket.leave(`project:${projectId}`));
  socket.on("presence:request", () => {
    const online = new Set<string>();
    for (const [, s] of io.sockets.sockets) online.add((s.data.user as AuthUser).id);
    io.emit("presence:update", { count: online.size });
  });
});

cron.schedule("* * * * *", async () => {
  const overdue = await prisma.task.findMany({
    where: { dueDate: { lt: new Date() }, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] } },
    include: { project: true }
  });
  for (const task of overdue) {
    await prisma.task.update({ where: { id: task.id }, data: { status: TaskStatus.OVERDUE } });
    const activity = await prisma.activity.create({
      data: { type: ActivityType.TASK_OVERDUE, message: `Task #${task.id} "${task.title}" was automatically flagged as Overdue`, projectId: task.projectId, taskId: task.id, actorId: task.project.creatorId }
    });
    emitActivity(activity);
  }
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  error(res, 500, "Internal server error");
});

const port = Number(process.env.PORT || 4000);
server.listen(port, () => console.log(`API + Socket.IO running on http://localhost:${port}`));
