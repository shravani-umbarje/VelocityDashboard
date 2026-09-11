import { PrismaClient, Role, Priority, TaskStatus, ActivityType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.activity.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password@123", 12);

  const admin = await prisma.user.create({
    data: { name: "Admin User", email: "admin@velozity.local", passwordHash, role: Role.ADMIN }
  });
  const pm1 = await prisma.user.create({
    data: { name: "Ravi Sharma", email: "pm1@velozity.local", passwordHash, role: Role.PM }
  });
  const pm2 = await prisma.user.create({
    data: { name: "Priya Patil", email: "pm2@velozity.local", passwordHash, role: Role.PM }
  });

  const devs = [];
  for (let i = 1; i <= 4; i++) {
    devs.push(await prisma.user.create({
      data: { name: `Developer ${i}`, email: `dev${i}@velozity.local`, passwordHash, role: Role.DEVELOPER }
    }));
  }

  const clients = await Promise.all([
    prisma.client.create({ data: { name: "Acme Retail", company: "Acme Retail", email: "ops@acme.local" } }),
    prisma.client.create({ data: { name: "Northstar Health", company: "Northstar Health", email: "team@northstar.local" } }),
    prisma.client.create({ data: { name: "BluePeak Finance", company: "BluePeak Finance", email: "product@bluepeak.local" } })
  ]);

  const projects = await Promise.all([
    prisma.project.create({ data: { name: "Acme Commerce Portal", description: "Customer-facing commerce modernization.", clientId: clients[0].id, creatorId: pm1.id } }),
    prisma.project.create({ data: { name: "Northstar Patient App", description: "Mobile-first patient experience.", clientId: clients[1].id, creatorId: pm1.id } }),
    prisma.project.create({ data: { name: "BluePeak Analytics", description: "Analytics and reporting platform.", clientId: clients[2].id, creatorId: pm2.id } })
  ]);

  const now = new Date();
  const days = (n: number) => new Date(now.getTime() + n * 86400000);

  const taskSeed = [
    ["Storefront wireframes", TaskStatus.IN_PROGRESS, Priority.HIGH, 0],
    ["Product API", TaskStatus.IN_REVIEW, Priority.CRITICAL, 1],
    ["Checkout validation", TaskStatus.TODO, Priority.MEDIUM, 2],
    ["Order history", TaskStatus.DONE, Priority.LOW, 3],
    ["Payment webhook", TaskStatus.TODO, Priority.HIGH, 0],

    ["Login flow", TaskStatus.DONE, Priority.HIGH, 1],
    ["Appointment calendar", TaskStatus.IN_PROGRESS, Priority.CRITICAL, 2],
    ["Push notification UI", TaskStatus.TODO, Priority.MEDIUM, 3],
    ["Profile page", TaskStatus.IN_REVIEW, Priority.LOW, 1],
    ["Medication list", TaskStatus.TODO, Priority.HIGH, 2],

    ["Revenue dashboard", TaskStatus.IN_PROGRESS, Priority.CRITICAL, 0],
    ["CSV export", TaskStatus.TODO, Priority.MEDIUM, 1],
    ["KPI cards", TaskStatus.DONE, Priority.HIGH, 2],
    ["Role permissions", TaskStatus.IN_REVIEW, Priority.HIGH, 3],
    ["Audit report", TaskStatus.TODO, Priority.LOW, 0]
  ] as const;

  for (let i = 0; i < taskSeed.length; i++) {
    const project = projects[Math.floor(i / 5)];
    const [title, status, priority, devIndex] = taskSeed[i];
    const overdue = i === 2 || i === 9;
    await prisma.task.create({
      data: {
        title, status, priority, projectId: project.id,
        assignedDeveloperId: devs[devIndex].id,
        dueDate: overdue ? days(-3) : days(i % 7 + 1)
      }
    });
  }

  const tasks = await prisma.task.findMany({ orderBy: { id: "asc" } });
  for (const task of tasks.slice(0, 8)) {
    const actor = task.assignedDeveloperId ? devs.find(d => d.id === task.assignedDeveloperId)! : pm1;
    await prisma.activity.create({
      data: {
        type: ActivityType.TASK_STATUS_CHANGED,
        message: `${actor.name} updated Task #${task.id} to ${task.status.replaceAll("_", " ")}`,
        projectId: task.projectId,
        taskId: task.id,
        actorId: actor.id
      }
    });
  }

  await prisma.notification.create({
    data: { userId: devs[0].id, title: "New task assigned", body: "You have been assigned to Storefront wireframes." }
  });
  await prisma.notification.create({
    data: { userId: pm1.id, title: "Task ready for review", body: "Product API was moved to In Review." }
  });

  console.log("Seed complete.");
  console.log("Login password for all users: Password@123");
  console.log(`Admin: ${admin.email}`);
  console.log(`PMs: ${pm1.email}, ${pm2.email}`);
  console.log("Developers: dev1@velozity.local ... dev4@velozity.local");
}

main().catch(console.error).finally(() => prisma.$disconnect());
