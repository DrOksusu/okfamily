/**
 * Password Manager 브라우저 테스트
 * Playwright를 사용한 E2E 테스트
 *
 * 백엔드 API를 모킹하여 프론트엔드 동작을 완전히 테스트합니다.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

const FRONTEND_URL = 'http://localhost:5500';
const BACKEND_URL = 'http://localhost:3000';
const TEST_EMAIL = 'pwtest@example.com';
const TEST_PASSWORD = 'TestPass123!';
const WRONG_PASSWORD = 'WrongPass999!';

// Mock JWT 토큰
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTcwMDAwMDAwMH0.mock-token-for-testing';

// 테스트 결과 수집
const results = [];

function logResult(step, action, expected, actual, passed, issue = null) {
    const result = { step, action, expected, actual, passed, issue };
    results.push(result);
    const status = passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${step} - ${action}`);
    if (expected) console.log(`  예상: ${expected}`);
    if (actual) console.log(`  실제: ${actual}`);
    if (!passed && issue) {
        console.log(`  문제점: ${issue}`);
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 백엔드 API 모킹 설정
 * 실제 백엔드가 없어도 프론트엔드의 모든 플로우를 테스트할 수 있도록 합니다.
 */
async function setupMockAPI(page, options = {}) {
    const {
        registerSuccess = true,
        loginSuccess = true,
        isRegisteredUser = false
    } = options;

    // 회원가입 API 모킹
    await page.route('**/api/auth/register', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.fallback();
            return;
        }

        const body = JSON.parse(request.postData());
        console.log(`  [Mock API] 회원가입 요청: ${body.email}`);

        if (!registerSuccess) {
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: '이미 등록된 이메일입니다.' })
            });
            return;
        }

        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                message: '회원가입이 완료되었습니다.',
                token: MOCK_TOKEN,
                user: { id: 1, email: body.email }
            })
        });
    });

    // 로그인 API 모킹
    await page.route('**/api/auth/login', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.fallback();
            return;
        }

        const body = JSON.parse(request.postData());
        console.log(`  [Mock API] 로그인 요청: ${body.email}, 비밀번호길이: ${body.password.length}`);

        if (!loginSuccess || body.password === WRONG_PASSWORD) {
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                message: '로그인되었습니다.',
                token: MOCK_TOKEN,
                user: { id: 1, email: body.email }
            })
        });
    });

    // 사용자 정보 조회 API 모킹
    await page.route('**/api/auth/me', async (route) => {
        console.log(`  [Mock API] 사용자 정보 조회`);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                user: { id: 1, email: TEST_EMAIL },
                hasVault: isRegisteredUser,
                hasMasterPassword: isRegisteredUser
            })
        });
    });

    // Vault 조회 API 모킹
    await page.route('**/api/vault', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
            console.log(`  [Mock API] Vault 조회`);
            if (isRegisteredUser) {
                // 기존 사용자 - masterHash가 있는 vault
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        masterHash: null,
                        encryptedData: null
                    })
                });
            } else {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        masterHash: null,
                        encryptedData: null
                    })
                });
            }
        } else if (method === 'PUT') {
            console.log(`  [Mock API] Vault 저장`);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: '저장되었습니다.' })
            });
        } else if (method === 'DELETE') {
            console.log(`  [Mock API] Vault 삭제`);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: '삭제되었습니다.' })
            });
        } else {
            await route.fallback();
        }
    });
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('Password Manager 브라우저 테스트 시작');
    console.log(`테스트 이메일: ${TEST_EMAIL}`);
    console.log(`프론트엔드: ${FRONTEND_URL}`);
    console.log('백엔드 API: Mock 모드 (네트워크 요청 가로채기)');
    console.log('='.repeat(60));
    console.log('');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, // iPhone 14 사이즈
        bypassCSP: true
    });

    const page = await context.newPage();

    // 콘솔 로그 수집
    const consoleLogs = [];
    page.on('console', msg => {
        consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    // 네트워크 에러 수집
    const networkErrors = [];
    page.on('requestfailed', request => {
        networkErrors.push({ url: request.url(), error: request.failure()?.errorText });
    });

    try {
        // ============================
        // 1단계: 메인 페이지 접속
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('1단계: 메인 페이지 접속');
        console.log('='.repeat(40));

        try {
            const response = await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const statusCode = response?.status();

            logResult(
                '1단계', '페이지 접속',
                'HTTP 200 정상 로드',
                `HTTP ${statusCode}`,
                statusCode === 200
            );

            // 페이지 타이틀 확인
            const title = await page.title();
            logResult(
                '1단계', '페이지 타이틀 확인',
                '"비밀번호 관리" 포함',
                `"${title}"`,
                title.includes('비밀번호')
            );

            // 로그인 화면이 표시되는지 확인 (로컬스토리지에 토큰 없으므로)
            await delay(1500);
            const loginScreenVisible = await page.isVisible('#login-screen');
            logResult(
                '1단계', '로그인 화면 표시',
                '로그인 화면이 보여야 함 (미인증 상태)',
                loginScreenVisible ? '로그인 화면 표시됨' : '로그인 화면 미표시',
                loginScreenVisible
            );

            // 주요 UI 요소 존재 확인
            const elements = {
                '로그인 폼': await page.isVisible('#login-form'),
                '이메일 입력란': await page.isVisible('#login-email'),
                '비밀번호 입력란': await page.isVisible('#login-password'),
                '로그인 버튼': await page.isVisible('#login-form button[type="submit"]'),
                '회원가입 버튼': await page.isVisible('#show-register-btn'),
                '잠금 아이콘': await page.isVisible('.lock-icon'),
                '앱 제목': await page.isVisible('h1')
            };

            const allElementsExist = Object.values(elements).every(v => v);
            const elementDetails = Object.entries(elements).map(([k, v]) => `${k}:${v ? 'O' : 'X'}`).join(', ');
            logResult(
                '1단계', 'UI 요소 존재 확인',
                '모든 주요 UI 요소가 존재해야 함',
                elementDetails,
                allElementsExist
            );

            // 플레이스홀더 텍스트 확인
            const emailPlaceholder = await page.getAttribute('#login-email', 'placeholder');
            const pwPlaceholder = await page.getAttribute('#login-password', 'placeholder');
            logResult(
                '1단계', '입력란 플레이스홀더',
                '이메일/비밀번호 플레이스홀더 한국어',
                `이메일:"${emailPlaceholder}", 비밀번호:"${pwPlaceholder}"`,
                emailPlaceholder === '이메일' && pwPlaceholder === '비밀번호'
            );

            // 회원가입 버튼 텍스트 확인
            const registerBtnText = await page.textContent('#show-register-btn');
            logResult(
                '1단계', '회원가입 버튼 텍스트',
                '"회원가입"',
                `"${registerBtnText}"`,
                registerBtnText.includes('회원가입')
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-main-page.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 01-main-page.png');

        } catch (error) {
            logResult('1단계', '페이지 접속', '정상 로드', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-main-page-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 2단계: 회원가입 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('2단계: 회원가입 테스트');
        console.log('='.repeat(40));

        try {
            // Mock API 설정 (회원가입 성공)
            await setupMockAPI(page, { registerSuccess: true, isRegisteredUser: false });

            // 회원가입 버튼 클릭
            await page.click('#show-register-btn');
            await delay(500);

            const registerScreenVisible = await page.isVisible('#register-screen');
            const loginScreenHidden = !(await page.isVisible('#login-screen'));
            logResult(
                '2단계', '회원가입 화면 전환',
                '회원가입 화면 표시, 로그인 화면 숨김',
                `회원가입화면:${registerScreenVisible}, 로그인화면숨김:${loginScreenHidden}`,
                registerScreenVisible && loginScreenHidden
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-register-screen.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 02-register-screen.png');

            // 회원가입 폼 요소 확인
            const regElements = {
                '이메일 입력란': await page.isVisible('#register-email'),
                '비밀번호 입력란': await page.isVisible('#register-password'),
                '비밀번호 확인 입력란': await page.isVisible('#register-password-confirm'),
                '가입하기 버튼': await page.isVisible('#register-form button[type="submit"]'),
                '로그인 링크': await page.isVisible('#show-login-btn')
            };
            const allRegElements = Object.values(regElements).every(v => v);
            logResult(
                '2단계', '회원가입 폼 요소 확인',
                '이메일, 비밀번호, 비밀번호 확인, 가입 버튼, 로그인 링크',
                Object.entries(regElements).map(([k, v]) => `${k}:${v ? 'O' : 'X'}`).join(', '),
                allRegElements
            );

            // 회원가입 정보 입력
            await page.fill('#register-email', TEST_EMAIL);
            await page.fill('#register-password', TEST_PASSWORD);
            await page.fill('#register-password-confirm', TEST_PASSWORD);

            const emailVal = await page.inputValue('#register-email');
            const pwVal = await page.inputValue('#register-password');
            const pwConfirmVal = await page.inputValue('#register-password-confirm');
            logResult(
                '2단계', '회원가입 정보 입력',
                `이메일:${TEST_EMAIL}, 비밀번호 입력 완료, 비밀번호 확인 일치`,
                `이메일:${emailVal}, 비밀번호길이:${pwVal.length}, 확인일치:${pwVal === pwConfirmVal}`,
                emailVal === TEST_EMAIL && pwVal === TEST_PASSWORD && pwVal === pwConfirmVal
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-register-filled.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 02-register-filled.png');

            // 회원가입 제출
            await page.click('#register-form button[type="submit"]');
            await delay(3000);

            // 결과 확인 - 회원가입 성공 시 lock-screen으로 이동 (마스터 비밀번호 설정)
            const lockScreenVisible = await page.isVisible('#lock-screen');
            const toastText = await page.evaluate(() => document.getElementById('toast')?.textContent || '');

            if (lockScreenVisible) {
                logResult(
                    '2단계', '회원가입 성공',
                    '회원가입 후 마스터 비밀번호 설정 화면으로 이동',
                    '마스터 비밀번호 설정 화면(lock-screen) 표시됨',
                    true
                );

                // 마스터 비밀번호 설정 화면 메시지 확인
                const lockMsg = await page.textContent('#lock-message');
                logResult(
                    '2단계', '마스터 비밀번호 설정 안내',
                    '"새 마스터 비밀번호를 설정하세요" 메시지',
                    `"${lockMsg}"`,
                    lockMsg.includes('마스터') || lockMsg.includes('설정')
                );

                const unlockBtnText = await page.textContent('#unlock-btn');
                logResult(
                    '2단계', '설정 버튼 텍스트',
                    '"설정하기"',
                    `"${unlockBtnText}"`,
                    unlockBtnText.includes('설정')
                );
            } else {
                const registerStill = await page.isVisible('#register-screen');
                logResult(
                    '2단계', '회원가입 결과',
                    '마스터 비밀번호 설정 화면으로 이동',
                    `회원가입화면유지:${registerStill}, 토스트:"${toastText}"`,
                    false,
                    toastText || '화면 전환 실패'
                );
            }

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-register-result.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 02-register-result.png');

        } catch (error) {
            logResult('2단계', '회원가입', '성공', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-register-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 3단계: 로그인 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('3단계: 로그인 테스트');
        console.log('='.repeat(40));

        try {
            // 로그아웃 및 초기화
            await page.evaluate(() => localStorage.clear());

            // Mock API 설정 (로그인 성공, 기존 사용자)
            await setupMockAPI(page, { loginSuccess: true, isRegisteredUser: false });

            await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await delay(1500);

            // 로그인 화면 확인
            const loginVisible = await page.isVisible('#login-screen');
            logResult(
                '3단계', '로그인 화면 표시 (로그아웃 상태)',
                '로그인 화면이 보여야 함',
                loginVisible ? '로그인 화면 표시됨' : '로그인 화면 미표시',
                loginVisible
            );

            // 로그인 정보 입력
            await page.fill('#login-email', TEST_EMAIL);
            await page.fill('#login-password', TEST_PASSWORD);

            const emailVal = await page.inputValue('#login-email');
            logResult(
                '3단계', '로그인 정보 입력',
                `이메일: ${TEST_EMAIL}`,
                `이메일: ${emailVal}`,
                emailVal === TEST_EMAIL
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-login-filled.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 03-login-filled.png');

            // 로그인 제출
            await page.click('#login-form button[type="submit"]');
            await delay(3000);

            // 결과 확인 - 로그인 성공 시 lock-screen으로 이동
            const lockScreenVisible = await page.isVisible('#lock-screen');
            const toastText = await page.evaluate(() => document.getElementById('toast')?.textContent || '');

            if (lockScreenVisible) {
                logResult(
                    '3단계', '로그인 성공',
                    '로그인 후 마스터 비밀번호 화면으로 이동',
                    '마스터 비밀번호 화면(lock-screen) 표시됨',
                    true
                );

                // lock-screen 메시지 확인
                const lockMsg = await page.textContent('#lock-message');
                logResult(
                    '3단계', '마스터 비밀번호 화면 안내 메시지',
                    '마스터 비밀번호 관련 메시지',
                    `"${lockMsg}"`,
                    lockMsg.includes('마스터') || lockMsg.includes('비밀번호')
                );

                // 로그아웃 버튼 존재 확인
                const logoutBtnVisible = await page.isVisible('#logout-btn');
                logResult(
                    '3단계', '로그아웃 버튼 존재',
                    '로그아웃 버튼이 보여야 함',
                    logoutBtnVisible ? '로그아웃 버튼 표시됨' : '로그아웃 버튼 미표시',
                    logoutBtnVisible
                );
            } else {
                const loginStill = await page.isVisible('#login-screen');
                logResult(
                    '3단계', '로그인 결과',
                    '마스터 비밀번호 화면으로 이동',
                    `로그인화면유지:${loginStill}, 토스트:"${toastText}"`,
                    false,
                    toastText || '로그인 실패'
                );
            }

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-login-result.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 03-login-result.png');

        } catch (error) {
            logResult('3단계', '로그인', '성공', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-login-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 4단계: 잘못된 비밀번호 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('4단계: 잘못된 비밀번호 테스트');
        console.log('='.repeat(40));

        try {
            // 로그아웃 및 초기화
            await page.evaluate(() => localStorage.clear());

            // Mock API 설정 (잘못된 비밀번호 시 거부)
            await setupMockAPI(page, { loginSuccess: true }); // WRONG_PASSWORD는 자동 거부

            await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await delay(1500);

            // 잘못된 비밀번호로 로그인 시도
            await page.fill('#login-email', TEST_EMAIL);
            await page.fill('#login-password', WRONG_PASSWORD);

            logResult(
                '4단계', '잘못된 비밀번호 입력',
                `이메일: ${TEST_EMAIL}, 잘못된 비밀번호: ${WRONG_PASSWORD}`,
                `입력 완료`,
                true
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-wrong-password-filled.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 04-wrong-password-filled.png');

            // 로그인 제출
            await page.click('#login-form button[type="submit"]');
            await delay(2000);

            // 에러 메시지 확인
            const toastText = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
            const toastVisible = await page.evaluate(() => {
                const toast = document.getElementById('toast');
                return toast?.classList.contains('show') || false;
            });

            // 로그인 화면에 머물러 있는지 확인
            const loginStillVisible = await page.isVisible('#login-screen');
            const lockScreenVisible = await page.isVisible('#lock-screen');

            logResult(
                '4단계', '잘못된 비밀번호 - 로그인 거부',
                '로그인 실패, 로그인 화면 유지',
                `로그인화면유지:${loginStillVisible}, lock화면전환:${lockScreenVisible}`,
                loginStillVisible && !lockScreenVisible
            );

            logResult(
                '4단계', '에러 메시지 표시',
                '에러 토스트 메시지가 표시되어야 함',
                `토스트내용: "${toastText}", 표시여부: ${toastVisible || toastText.length > 0}`,
                toastText.length > 0
            );

            // 에러 메시지 내용이 적절한지 확인
            const isAppropriateError = toastText.includes('이메일') || toastText.includes('비밀번호') || toastText.includes('올바르지');
            logResult(
                '4단계', '에러 메시지 내용 적절성',
                '"이메일 또는 비밀번호가 올바르지 않습니다" 등',
                `"${toastText}"`,
                isAppropriateError
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-wrong-password-result.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 04-wrong-password-result.png');

            // 추가 테스트: 빈 필드 유효성 검사
            console.log('\n  [추가 테스트] 빈 이메일/비밀번호로 로그인 시도');
            await page.fill('#login-email', '');
            await page.fill('#login-password', '');

            // HTML5 required 속성에 의해 폼 제출이 막히는지 확인
            await page.click('#login-form button[type="submit"]');
            await delay(1000);

            const stillOnLogin = await page.isVisible('#login-screen');
            logResult(
                '4단계', '빈 필드 유효성 검사 (HTML5 required)',
                '빈 필드로 제출 시 HTML5 유효성 검사가 막아야 함',
                `로그인화면유지:${stillOnLogin}`,
                stillOnLogin
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-empty-fields.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 04-empty-fields.png');

            // 추가 테스트: 잘못된 이메일 형식
            console.log('\n  [추가 테스트] 잘못된 이메일 형식으로 로그인 시도');
            await page.fill('#login-email', 'not-an-email');
            await page.fill('#login-password', TEST_PASSWORD);
            await page.click('#login-form button[type="submit"]');
            await delay(1000);

            const stillOnLoginAfterBadEmail = await page.isVisible('#login-screen');
            logResult(
                '4단계', '잘못된 이메일 형식 유효성 검사',
                '잘못된 이메일 형식 시 HTML5 유효성 검사가 막아야 함',
                `로그인화면유지:${stillOnLoginAfterBadEmail}`,
                stillOnLoginAfterBadEmail
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-invalid-email.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: 04-invalid-email.png');

        } catch (error) {
            logResult('4단계', '잘못된 비밀번호', '에러 메시지 표시', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 테스트 결과 요약
        // ============================
        console.log('\n');
        console.log('='.repeat(60));
        console.log('                 테스트 결과 요약 보고서');
        console.log('='.repeat(60));

        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;
        const total = results.length;

        console.log('');
        console.log(`  총 테스트: ${total}개`);
        console.log(`  성공: ${passed}개`);
        console.log(`  실패: ${failed}개`);
        console.log(`  성공률: ${Math.round((passed / total) * 100)}%`);
        console.log('');

        // 단계별 요약
        const steps = ['1단계', '2단계', '3단계', '4단계'];
        steps.forEach(step => {
            const stepResults = results.filter(r => r.step === step);
            const stepPassed = stepResults.filter(r => r.passed).length;
            const stepTotal = stepResults.length;
            const icon = stepPassed === stepTotal ? 'PASS' : 'FAIL';
            console.log(`  [${icon}] ${step}: ${stepPassed}/${stepTotal} 성공`);
        });

        if (failed > 0) {
            console.log('');
            console.log('-'.repeat(40));
            console.log('  실패한 테스트 목록:');
            console.log('-'.repeat(40));
            results.filter(r => !r.passed).forEach(r => {
                console.log(`  [FAIL] ${r.step} - ${r.action}`);
                if (r.issue) console.log(`         문제: ${r.issue}`);
            });
        }

        console.log('');
        console.log('-'.repeat(40));
        console.log('  전체 테스트 결과:');
        console.log('-'.repeat(40));
        results.forEach(r => {
            const icon = r.passed ? 'PASS' : 'FAIL';
            console.log(`  [${icon}] ${r.step} - ${r.action}`);
        });

        // 콘솔 에러 확인
        const consoleErrors = consoleLogs.filter(l => l.type === 'error');
        if (consoleErrors.length > 0) {
            console.log('');
            console.log('-'.repeat(40));
            console.log('  브라우저 콘솔 에러:');
            console.log('-'.repeat(40));
            consoleErrors.forEach(e => console.log(`  ${e.text}`));
        } else {
            console.log('');
            console.log('  브라우저 콘솔 에러: 없음');
        }

        // 네트워크 에러 확인
        if (networkErrors.length > 0) {
            console.log('');
            console.log('-'.repeat(40));
            console.log('  네트워크 에러:');
            console.log('-'.repeat(40));
            networkErrors.forEach(e => console.log(`  ${e.url}: ${e.error}`));
        } else {
            console.log('  네트워크 에러: 없음');
        }

        console.log('');
        console.log(`  스크린샷 저장 위치: ${SCREENSHOT_DIR}`);
        console.log('='.repeat(60));

        // 종료 코드 설정
        if (failed > 0) {
            process.exitCode = 1;
        }

    } finally {
        await browser.close();
    }
}

runTests().catch(error => {
    console.error('테스트 실행 치명적 오류:', error);
    process.exit(1);
});
