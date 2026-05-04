import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { config as loadEnv } from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const prisma = new PrismaClient();

if (!process.env.DATABASE_URL) {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env')
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const loaded = loadEnv({ path: envPath });
      dotenvExpand.expand(loaded);
      break;
    }
  }
}

const DEMO_PROJECT_NAME = 'Docker Demo';
const DEMO_BASE_URL = 'https://scanrole.com';

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function seedAdminUser(email: string, password: string) {
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });
}

async function main() {
  const defaultEmail = process.env.ADMIN_EMAIL ?? 'admin@wrighttest.com';
  const password = process.env.ADMIN_PASSWORD ?? 'changeme';
  const adminEmails = unique([defaultEmail, 'admin@wrighttest.com', 'admin@wrighttest.app']);

  for (const email of adminEmails) {
    await seedAdminUser(email, password);
  }

  console.log(`[Seed] Admin users: ${adminEmails.join(', ')}`);

  const projectCount = await prisma.project.count();
  if (projectCount > 0) {
    console.log('[Seed] Projects exist, skipping demo data');
    return;
  }

  const demo = await prisma.project.create({
    data: {
      name: DEMO_PROJECT_NAME
    }
  });

  const environment = await prisma.environment.create({
    data: {
      name: 'DEV',
      projectId: demo.id,
      variables: {
        BASE_URL: DEMO_BASE_URL
      }
    }
  });

  const desktopTest = await prisma.test.create({
    data: {
      name: "Checking company's page",
      url: '{{BASE_URL}}',
      projectId: demo.id,
      device: 'Desktop Chrome',
      steps: [
        {
          action: 'goto',
          value: DEMO_BASE_URL
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'Role Explorer' })"
        },
        {
          action: 'goto',
          value: `${DEMO_BASE_URL}/role/`
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'Software Engineer' })"
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: '90' })",
          selectorCandidates: [
            "page.getByText('90')",
            "page.locator('a', { hasText: '90' })"
          ]
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: '180' })",
          selectorCandidates: [
            "page.getByText('180')",
            "page.locator('a', { hasText: '180' })"
          ]
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: '365' })",
          selectorCandidates: [
            "page.getByText('365')",
            "page.locator('a', { hasText: '365' })"
          ]
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'United States' }).first()",
          selectorCandidates: [
            "page.getByText('United States')",
            "page.locator('a', { hasText: 'United States' })"
          ]
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'Canada' }).first()",
          selectorCandidates: [
            "page.getByText('Canada')",
            "page.locator('a', { hasText: 'Canada' })"
          ]
        }
      ]
    }
  });

  const mobileTest = await prisma.test.create({
    data: {
      name: "Checking company's page - mobile",
      url: '{{BASE_URL}}',
      projectId: demo.id,
      device: 'Galaxy S9+',
      steps: [
        {
          action: 'goto',
          value: DEMO_BASE_URL
        },
        {
          action: 'click',
          selector: "page.getByRole('button', { name: 'Toggle navigation' })"
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'Companies', exact: true })"
        },
        {
          action: 'goto',
          value: `${DEMO_BASE_URL}/companies/`
        },
        {
          action: 'click',
          selector: "page.getByRole('link', { name: 'Google Mountain View, CA' })"
        },
        {
          action: 'goto',
          value: `${DEMO_BASE_URL}/companies/google/`
        },
        {
          action: 'click',
          selector: "page.getByRole('button', { name: '+15 more roles' })"
        },
        {
          action: 'assertVisible',
          selector: "page.getByText('Software Architect')"
        }
      ]
    }
  });

  const suite = await prisma.suite.create({
    data: {
      name: 'Smoke Test',
      projectId: demo.id,
      testIds: [desktopTest.id, mobileTest.id]
    }
  });

  await prisma.schedule.create({
    data: {
      name: 'Smoke Test',
      cron: '0 * * * *',
      projectId: demo.id,
      suiteId: suite.id,
      environmentId: environment.id,
      enabled: true
    }
  });

  console.log('[Seed] Docker Demo project created with 2 tests');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
