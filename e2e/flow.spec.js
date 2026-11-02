import { expect, test } from '@playwright/test';

// Walks one member from sign-up to leaving the car park, starting from an empty
// database. It writes real rows named "E2E", and those with history can't be
// deleted from the app, so run it against a project that holds no live data.
const run = String(Date.now()).slice(-8);
const zone = `E2E โซน ${run}`;
const packageName = `E2E แพ็กเกจ ${run}`;
const memberName = `E2E สมาชิก ${run}`;
const phone = `08${run}`;
const plate = `9กย${run}`;

const nav = (page, label) =>
  page.locator('.sidebar nav').getByRole('link', { name: label, exact: true }).click();
const save = (page) => page.getByRole('button', { name: 'บันทึก', exact: true }).click();
const toast = (page, text) => expect(page.locator('.toast', { hasText: text }).first()).toBeVisible();

test('a member signs up, pays, parks, leaves and shows up in history', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());

  await test.step('sign in', async () => {
    await page.goto('/');
    await page.getByLabel('อีเมล').fill(process.env.E2E_EMAIL);
    await page.getByLabel('รหัสผ่าน').fill(process.env.E2E_PASSWORD);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page.getByRole('heading', { name: 'ภาพรวม' })).toBeVisible();
  });

  await test.step('set up a zone with spots', async () => {
    await nav(page, 'ช่องจอด');
    await page.getByRole('button', { name: 'เพิ่มโซน' }).click();
    await page.getByLabel('ชื่อโซน').fill(zone);
    await save(page);
    const section = page.locator('section', { hasText: zone });
    await section.getByRole('button', { name: 'เพิ่มช่องจอด' }).click();
    await page.getByLabel('คำนำหน้ารหัส').fill('E-');
    await page.getByLabel('จำนวนช่อง').fill('2');
    await page.getByRole('dialog').getByRole('button', { name: 'เพิ่มช่องจอด' }).click();
    await expect(section.locator('.spot-available')).toHaveCount(2);
  });

  await test.step('create a package that charges every hour', async () => {
    await nav(page, 'แพ็กเกจ');
    await page.getByRole('button', { name: 'เพิ่มแพ็กเกจ' }).click();
    await page.getByLabel('ชื่อแพ็กเกจ').fill(packageName);
    await page.getByLabel('ราคา (บาท)').fill('500');
    await page.getByLabel('ชั่วโมงจอดต่อรอบ').fill('0');
    await page.getByLabel('ค่าจอดส่วนเกิน (บาท/ชั่วโมง)').fill('20');
    await page.getByRole('checkbox', { name: zone }).check();
    await save(page);
    await expect(page.locator('.package', { hasText: packageName })).toContainText(zone);
  });

  await test.step('register a member and a vehicle', async () => {
    await nav(page, 'สมาชิก');
    await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
    await page.getByLabel('ชื่อ–นามสกุล').fill(memberName);
    await page.getByLabel('เบอร์โทรศัพท์').fill(phone);
    await save(page);
    await expect(page.getByRole('heading', { name: memberName })).toBeVisible();

    await page.getByRole('button', { name: 'เพิ่มรถ' }).click();
    await page.getByLabel('ทะเบียนรถ').fill(`9กย ${run}`);
    await page.getByLabel('จังหวัด').fill('กรุงเทพมหานคร');
    await save(page);
    await expect(page.getByRole('cell', { name: plate })).toBeVisible();
  });

  await test.step('the gate refuses a member with no paid term', async () => {
    await nav(page, 'เข้า–ออก');
    await page.getByLabel('ทะเบียนรถ').fill(plate);
    await page.getByRole('button', { name: 'ค้นหา' }).click();
    await expect(page.getByText('เข้าไม่ได้')).toBeVisible();
  });

  await test.step('subscribe unpaid, then record the payment', async () => {
    await nav(page, 'สมัคร/ต่ออายุ');
    await page.getByRole('button', { name: 'สมัคร / ต่ออายุ' }).click();
    await page.getByLabel('ค้นหาสมาชิก').fill(memberName);
    await page.locator('.pick-list button', { hasText: memberName }).click();
    await page.getByLabel('แพ็กเกจ').selectOption({ label: `${packageName} — ฿500.00 / 30 วัน (0 ชม.)` });
    await save(page);
    await toast(page, 'รอชำระเงิน');

    await nav(page, 'การชำระเงิน');
    await page.getByRole('row', { name: new RegExp(memberName) }).getByRole('button', { name: 'รับชำระ' }).click();
    await page.getByRole('button', { name: 'บันทึกการรับเงิน' }).click();
    await toast(page, 'บันทึกการรับชำระแล้ว');
  });

  await test.step('check in and appear on the spot board', async () => {
    await nav(page, 'เข้า–ออก');
    await page.getByLabel('ทะเบียนรถ').fill(`9กย ${run}`);
    await page.getByRole('button', { name: 'ค้นหา' }).click();
    await page.getByRole('button', { name: 'บันทึกรถเข้า' }).click();
    await toast(page, 'บันทึกรถเข้าแล้ว');

    await nav(page, 'ช่องจอด');
    await expect(page.locator('.spot-occupied', { hasText: plate })).toBeVisible();
  });

  await test.step('check out and pay the overage', async () => {
    await nav(page, 'เข้า–ออก');
    await page.locator('.parked-list button', { hasText: plate }).click();
    await expect(page.locator('.fee-total')).toContainText('฿20.00');
    await page.getByRole('button', { name: 'บันทึกรถออก' }).click();
    await toast(page, 'รับชำระ ฿20.00');
  });

  await test.step('history shows the finished visit', async () => {
    await nav(page, 'ประวัติการเข้าใช้');
    await page.getByLabel('ค้นหาประวัติ').fill(plate);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).not.toContainText('ยังจอดอยู่');
    await expect(page.locator('tbody tr')).toContainText('฿20.00');
  });

  await test.step('a page reload keeps the session and the route', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ประวัติการเข้าใช้บริการ' })).toBeVisible();
  });
});
