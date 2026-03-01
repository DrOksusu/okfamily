import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

// === 1단계: 메인 페이지 접속 ===
console.log('=== 1단계: 메인 페이지 접속 ===');
await page.goto('http://localhost:5500');
const title = await page.title();
console.log('타이틀:', title);
console.log('판정:', title.includes('비밀번호') ? 'PASS' : 'FAIL');
await page.screenshot({ path: 'test/screenshots/01-login-page.png' });

// === 2단계: 회원가입 ===
console.log('');
console.log('=== 2단계: 회원가입 ===');
await page.click('text=회원가입');
await page.waitForTimeout(500);

const testEmail = 'pwtest_' + Date.now() + '@example.com';
await page.fill('#register-form input[type="email"]', testEmail);
console.log('테스트 이메일:', testEmail);

const pwFields = await page.$$('#register-form input[type="password"]');
if (pwFields.length >= 2) {
  await pwFields[0].fill('TestPass123!');
  await pwFields[1].fill('TestPass123!');
}
await page.screenshot({ path: 'test/screenshots/02-register-filled.png' });

const [regResponse] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/auth/register'), { timeout: 10000 }).catch(() => null),
  page.click('#register-form button[type="submit"]')
]);

await page.waitForTimeout(2000);
await page.screenshot({ path: 'test/screenshots/03-register-result.png' });

if (regResponse) {
  const status = regResponse.status();
  const body = await regResponse.json().catch(() => ({}));
  console.log('API 응답:', status, JSON.stringify(body).substring(0, 150));
  console.log('판정:', (status === 201 || status === 200) ? 'PASS' : 'FAIL');
} else {
  console.log('API 응답 없음');
  console.log('판정: FAIL');
}

// === 3단계: 방금 가입한 계정으로 로그인 ===
console.log('');
console.log('=== 3단계: 로그인 ===');
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:5500');
await page.waitForTimeout(500);

await page.fill('input[type="email"]', testEmail);
await page.fill('input[type="password"]', 'TestPass123!');
await page.screenshot({ path: 'test/screenshots/04-login-filled.png' });

const [loginResponse] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/auth/login'), { timeout: 10000 }).catch(() => null),
  page.click('#login-form button[type="submit"]')
]);

await page.waitForTimeout(2000);
await page.screenshot({ path: 'test/screenshots/05-login-result.png' });

if (loginResponse) {
  const status = loginResponse.status();
  const body = await loginResponse.json().catch(() => ({}));
  console.log('API 응답:', status, JSON.stringify(body).substring(0, 150));
  if (status === 200) {
    console.log('판정: PASS (로그인 성공)');
    const lockScreen = await page.$('#lock-screen');
    const lockVisible = lockScreen ? await lockScreen.isVisible() : false;
    console.log('마스터 암호 화면:', lockVisible ? '표시됨' : '표시 안 됨');
  } else {
    console.log('판정: FAIL');
  }
} else {
  console.log('API 응답 없음');
  console.log('판정: FAIL');
}

// === 4단계: 잘못된 비밀번호 ===
console.log('');
console.log('=== 4단계: 잘못된 비밀번호 ===');
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:5500');
await page.waitForTimeout(500);

await page.fill('input[type="email"]', testEmail);
await page.fill('input[type="password"]', 'WrongPass999!');

const [wrongResponse] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/auth/login'), { timeout: 10000 }).catch(() => null),
  page.click('#login-form button[type="submit"]')
]);

await page.waitForTimeout(2000);
await page.screenshot({ path: 'test/screenshots/06-wrong-password.png' });

if (wrongResponse) {
  const status = wrongResponse.status();
  console.log('API 응답:', status);
  console.log('판정:', status === 401 ? 'PASS (정상 거부)' : 'FAIL');
}

const toast = await page.$('.toast');
if (toast) {
  const toastText = await toast.textContent();
  console.log('에러 메시지:', toastText);
}

await browser.close();
console.log('');
console.log('=== 테스트 완료 ===');
