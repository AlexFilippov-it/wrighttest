import bcrypt from 'bcrypt';
import prisma from '../src/prisma';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || !process.env.DATABASE_URL) {
    throw new Error('Screenshot seed requires an isolated database and generated demo credentials.');
  }

  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!databaseUrl.pathname.includes('wrighttest_screenshots_')) {
    throw new Error('Screenshot seed only accepts the temporary WrightTest screenshot database.');
  }

  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 12) }
  });
  const project = await prisma.project.create({ data: { name: 'WrightTest Demo Workspace' } });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, email, role: 'OWNER', status: 'ACTIVE' }
  });

  const editor = await prisma.user.create({
    data: { email: 'editor@example.test', passwordHash: await bcrypt.hash('isolated-only', 12) }
  });
  const viewer = await prisma.user.create({
    data: { email: 'viewer@example.test', passwordHash: await bcrypt.hash('isolated-only', 12) }
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: editor.id, email: editor.email, role: 'EDITOR', status: 'ACTIVE' },
      { projectId: project.id, userId: viewer.id, email: viewer.email, role: 'VIEWER', status: 'ACTIVE' }
    ]
  });

  const environment = await prisma.environment.create({
    data: { name: 'Demo', projectId: project.id, variables: { BASE_URL: 'data:text/html' } }
  });
  const steps = expectedSteps('Cart: 1');
  const test = await prisma.test.create({
    data: {
      name: 'Cart updates after adding an item',
      url: 'data:text/html',
      device: 'Desktop Chrome',
      projectId: project.id,
      environmentId: environment.id,
      useProjectAuthentication: false,
      steps
    }
  });
  const failingTest = await prisma.test.create({
    data: {
      name: 'Cart displays the expected quantity',
      url: 'data:text/html',
      device: 'Desktop Chrome',
      projectId: project.id,
      environmentId: environment.id,
      useProjectAuthentication: false,
      steps: expectedSteps('Cart: 2')
    }
  });
  await prisma.test.create({
    data: {
      name: 'Product page is available',
      url: 'data:text/html',
      device: 'Desktop Chrome',
      projectId: project.id,
      environmentId: environment.id,
      useProjectAuthentication: false,
      steps: [
        { action: 'goto', value: `data:text/html;charset=utf-8,${encodeURIComponent('<title>WrightTest Demo Store</title><h1>Demo Store</h1>')}` },
        { action: 'assertTitle', expected: 'WrightTest Demo Store' }
      ]
    }
  });

  await prisma.suite.create({
    data: { name: 'Demo Store smoke suite', projectId: project.id, testIds: [test.id, failingTest.id] }
  });
  await prisma.schedule.create({
    data: {
      name: 'Daily demo smoke',
      cron: '0 9 * * 1-5',
      projectId: project.id,
      suiteId: (await prisma.suite.findFirstOrThrow({ where: { projectId: project.id } })).id,
      environmentId: environment.id,
      enabled: false
    }
  });
  await prisma.instanceSettings.upsert({
    where: { id: 1 }, update: { activeLocale: 'en' }, create: { id: 1, activeLocale: 'en' }
  });

  console.log('Created isolated WrightTest screenshot fixture.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

function expectedSteps(expected: string) {
  const html = '<title>WrightTest Demo Store</title><main><h1>Demo Store</h1><button id="add">Add to cart</button><p id="cart">Cart: 0</p><script>document.querySelector("#add").onclick=()=>document.querySelector("#cart").textContent="Cart: 1"</script></main>';
  return [
    { action: 'goto', value: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` },
    { action: 'click', selector: "page.getByRole('button', { name: 'Add to cart' })" },
    { action: 'assertText', selector: "page.locator('#cart')", expected }
  ];
}
