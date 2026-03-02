/**
 * 생체인증(지문) 자동 실행 브라우저 테스트
 *
 * 잠금 화면 진입 시 handleBiometricUnlock이 자동으로 호출되는지,
 * navigator.credentials.get 호출 여부를 모킹하여 검증합니다.
 *
 * WebAuthn API는 headless 브라우저에서 실제 동작하지 않으므로,
 * navigator.credentials.get을 래핑하여 호출 감지 방식으로 테스트합니다.
 */

import { createBrowser, logResult, printSummary, delay, SCREENSHOT_DIR, FRONTEND_URL } from './test-utils.mjs';
import path from 'path';

// Mock JWT 토큰
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTcwMDAwMDAwMH0.mock-token-for-testing';
const TEST_EMAIL = 'biotest@example.com';
const TEST_PASSWORD = 'BioTest123!';

// 테스트 결과 수집
const results = [];

/**
 * Mock API 설정 - 로그인 성공, Vault 존재, 마스터비밀번호 있음
 */
async function setupMockAPI(page, options = {}) {
    const {
        loginSuccess = true,
        hasVault = true,
        hasMasterPassword = true,
        masterHash = 'mock-master-hash-for-testing'
    } = options;

    // 로그인 API 모킹
    await page.route('**/api/auth/login', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.fallback();
            return;
        }

        const body = JSON.parse(request.postData());
        console.log(`  [Mock API] 로그인 요청: ${body.email}`);

        if (!loginSuccess) {
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
        console.log(`  [Mock API] 사용자 정보 조회 (hasVault: ${hasVault}, hasMasterPassword: ${hasMasterPassword})`);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                user: { id: 1, email: TEST_EMAIL },
                hasVault: hasVault,
                hasMasterPassword: hasMasterPassword
            })
        });
    });

    // Vault 조회 API 모킹
    await page.route('**/api/vault', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
            console.log(`  [Mock API] Vault 조회`);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    masterHash: hasVault ? masterHash : null,
                    encryptedData: null
                })
            });
        } else if (method === 'PUT') {
            console.log(`  [Mock API] Vault 저장`);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: '저장되었습니다.' })
            });
        } else {
            await route.fallback();
        }
    });
}

/**
 * navigator.credentials.get을 모킹하여 호출 감지
 * WebAuthn은 headless에서 실제 동작하지 않으므로 호출 여부만 확인
 */
async function setupWebAuthnMock(page) {
    await page.evaluate(() => {
        // 호출 기록용 전역 변수
        window.__biometricTestState = {
            credentialsGetCalled: false,
            credentialsGetCallCount: 0,
            credentialsGetTimestamps: [],
            credentialsCreateCalled: false
        };

        // PublicKeyCredential 지원 모킹
        window.PublicKeyCredential = window.PublicKeyCredential || {};
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;

        // navigator.credentials.get 래핑
        const originalGet = navigator.credentials?.get?.bind(navigator.credentials);
        if (!navigator.credentials) {
            Object.defineProperty(navigator, 'credentials', {
                value: {},
                writable: true,
                configurable: true
            });
        }

        navigator.credentials.get = async function (options) {
            console.log('[Biometric Test] navigator.credentials.get 호출 감지!');
            window.__biometricTestState.credentialsGetCalled = true;
            window.__biometricTestState.credentialsGetCallCount++;
            window.__biometricTestState.credentialsGetTimestamps.push(Date.now());

            // NotAllowedError를 발생시켜 생체인증 취소로 처리
            // (headless 환경에서는 실제 지문을 읽을 수 없으므로)
            const error = new DOMException('생체인증 테스트: 사용자 취소', 'NotAllowedError');
            throw error;
        };

        // navigator.credentials.create도 모킹 (등록용)
        navigator.credentials.create = async function (options) {
            console.log('[Biometric Test] navigator.credentials.create 호출 감지!');
            window.__biometricTestState.credentialsCreateCalled = true;
            const error = new DOMException('생체인증 테스트: 사용자 취소', 'NotAllowedError');
            throw error;
        };
    });
}

/**
 * localStorage에 생체인증 관련 데이터 설정
 */
async function setupBiometricLocalStorage(page) {
    await page.evaluate(() => {
        localStorage.setItem('biometric_enabled', 'true');
        localStorage.setItem('credential_id', 'dGVzdC1jcmVkZW50aWFsLWlk'); // base64('test-credential-id')
        localStorage.setItem('encrypted_master', 'dGVzdC1lbmNyeXB0ZWQtbWFzdGVy'); // 더미 암호화 데이터
        localStorage.setItem('device_key', 'dGVzdC1kZXZpY2Uta2V5LTMyYnl0ZXMtcGFkZGluZzEy'); // 더미 키
    });
}

/**
 * 호출 기록 초기화
 */
async function resetBiometricCallState(page) {
    await page.evaluate(() => {
        if (window.__biometricTestState) {
            window.__biometricTestState.credentialsGetCalled = false;
            window.__biometricTestState.credentialsGetCallCount = 0;
            window.__biometricTestState.credentialsGetTimestamps = [];
        }
    });
}

/**
 * 생체인증 호출 상태 조회
 */
async function getBiometricCallState(page) {
    return await page.evaluate(() => window.__biometricTestState || {});
}

async function runTests() {
    console.log('='.repeat(60));
    console.log('생체인증 자동 실행 브라우저 테스트');
    console.log(`프론트엔드: ${FRONTEND_URL}`);
    console.log('백엔드 API: Mock 모드 (네트워크 요청 가로채기)');
    console.log('='.repeat(60));
    console.log('');

    const { browser, context, page, consoleLogs, networkErrors } = await createBrowser();

    try {
        // ============================
        // 1단계: 메인 페이지 접속 확인
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('1단계: 메인 페이지 접속 확인');
        console.log('='.repeat(40));

        try {
            const response = await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const statusCode = response?.status();

            logResult(results, '1단계', '페이지 접속',
                'HTTP 200 정상 로드',
                `HTTP ${statusCode}`,
                statusCode === 200
            );

            const title = await page.title();
            logResult(results, '1단계', '페이지 타이틀 확인',
                '"비밀번호 관리" 포함',
                `"${title}"`,
                title.includes('비밀번호')
            );

            await delay(1000);
            const loginScreenVisible = await page.isVisible('#login-screen');
            logResult(results, '1단계', '로그인 화면 표시',
                '로그인 화면이 보여야 함 (미인증 상태)',
                loginScreenVisible ? '로그인 화면 표시됨' : '로그인 화면 미표시',
                loginScreenVisible
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-01-main-page.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-01-main-page.png');

        } catch (error) {
            logResult(results, '1단계', '페이지 접속',
                '정상 로드', `오류: ${error.message}`, false, error.message);
        }

        // ============================
        // 2단계: Mock API 설정 + 로그인 수행
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('2단계: Mock API 설정 및 로그인');
        console.log('='.repeat(40));

        try {
            // Mock API 설정 (로그인 성공, Vault 있음, 마스터비밀번호 있음)
            await setupMockAPI(page, {
                loginSuccess: true,
                hasVault: true,
                hasMasterPassword: true,
                masterHash: 'mock-master-hash'
            });

            logResult(results, '2단계', 'Mock API 설정',
                '로그인 성공, hasVault=true, hasMasterPassword=true',
                'Mock API 설정 완료',
                true
            );

            // WebAuthn 모킹 설정 (로그인 전)
            await setupWebAuthnMock(page);

            logResult(results, '2단계', 'WebAuthn 모킹 설정',
                'navigator.credentials.get 래핑 완료',
                'WebAuthn 모킹 설정 완료',
                true
            );

            // 생체인증 localStorage 설정
            await setupBiometricLocalStorage(page);

            logResult(results, '2단계', '생체인증 localStorage 설정',
                'biometric_enabled=true, credential_id, encrypted_master, device_key 설정',
                'localStorage 설정 완료',
                true
            );

            // 로그인 수행
            await page.fill('#login-email', TEST_EMAIL);
            await page.fill('#login-password', TEST_PASSWORD);

            const emailVal = await page.inputValue('#login-email');
            logResult(results, '2단계', '로그인 정보 입력',
                `이메일: ${TEST_EMAIL}`,
                `이메일: ${emailVal}`,
                emailVal === TEST_EMAIL
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-02-login-filled.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-02-login-filled.png');

            // 로그인 버튼 클릭
            await page.click('#login-form button[type="submit"]');
            await delay(2000);

            // 잠금 화면으로 이동했는지 확인
            const lockScreenVisible = await page.isVisible('#lock-screen');
            logResult(results, '2단계', '로그인 후 잠금 화면 이동',
                '잠금 화면(lock-screen) 표시',
                lockScreenVisible ? '잠금 화면 표시됨' : '잠금 화면 미표시',
                lockScreenVisible
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-02-login-result.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-02-login-result.png');

        } catch (error) {
            logResult(results, '2단계', '로그인', '성공', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-02-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 3단계: 잠금 화면 진입 시 생체인증 자동 호출 확인 (checkAuth 경로)
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('3단계: 잠금 화면 진입 시 생체인증 자동 호출 확인');
        console.log('='.repeat(40));

        try {
            // checkAuth가 호출되면서 Biometric.isEnabled()가 true이면
            // setTimeout(() => this.handleBiometricUnlock(), 300) 이 호출되어야 함
            // handleBiometricUnlock -> Biometric.authenticate -> navigator.credentials.get 호출

            // WebAuthn mock 재설정 (로그인 과정에서 페이지가 다시 로드되진 않으나 상태 확인)
            // checkAuth에서 자동으로 호출된 결과를 확인
            // 300ms 지연 + 네트워크 시간 등을 고려하여 충분히 대기
            await delay(2000);

            const state = await getBiometricCallState(page);
            const credGetCalled = state.credentialsGetCalled === true;
            const callCount = state.credentialsGetCallCount || 0;

            logResult(results, '3단계', 'navigator.credentials.get 호출 여부',
                '잠금 화면 진입 시 자동으로 호출되어야 함',
                `호출됨: ${credGetCalled}, 호출 횟수: ${callCount}`,
                credGetCalled
            );

            // 생체인증 버튼 표시 여부 확인
            const biometricBtnVisible = await page.isVisible('#biometric-btn');
            logResult(results, '3단계', '생체인증 버튼 표시',
                '생체인증 활성화 시 버튼이 보여야 함',
                biometricBtnVisible ? '생체인증 버튼 표시됨' : '생체인증 버튼 미표시',
                biometricBtnVisible
            );

            // 토스트 메시지 확인 (NotAllowedError 발생으로 취소 메시지)
            const toastText = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
            logResult(results, '3단계', '생체인증 취소 후 토스트 메시지',
                '생체인증 취소 관련 메시지 표시',
                `토스트: "${toastText}"`,
                toastText.includes('취소') || toastText.includes('실패') || toastText.length > 0
            );

            // 잠금 화면에 여전히 있는지 확인 (생체인증 실패이므로 잠금 화면 유지)
            const stillOnLockScreen = await page.isVisible('#lock-screen');
            logResult(results, '3단계', '생체인증 실패 후 잠금 화면 유지',
                '생체인증 실패 시 잠금 화면에 머물러야 함',
                stillOnLockScreen ? '잠금 화면 유지됨' : '다른 화면으로 전환됨',
                stillOnLockScreen
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-03-auto-biometric.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-03-auto-biometric.png');

        } catch (error) {
            logResult(results, '3단계', '생체인증 자동 호출',
                '정상 호출', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-03-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 4단계: lock() 호출 후 생체인증 자동 호출 확인
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('4단계: lock() 후 생체인증 자동 호출 확인');
        console.log('='.repeat(40));

        try {
            // 먼저 메인 화면으로 이동 시키기 위해 직접 App.showScreen('main') 호출
            // (마스터 비밀번호를 실제로 검증할 수 없으므로 직접 상태 전환)
            await page.evaluate(() => {
                App.masterPassword = 'test-master';
                App.showScreen('main');
            });
            await delay(500);

            const mainScreenVisible = await page.isVisible('#main-screen');
            logResult(results, '4단계', '메인 화면 수동 전환',
                '메인 화면 표시',
                mainScreenVisible ? '메인 화면 표시됨' : '메인 화면 미표시',
                mainScreenVisible
            );

            // 호출 기록 초기화
            await resetBiometricCallState(page);

            // WebAuthn mock이 유지되는지 확인
            const mockAvailable = await page.evaluate(() => !!window.__biometricTestState);
            logResult(results, '4단계', 'WebAuthn 모킹 상태 유지',
                '모킹이 유지되어야 함',
                mockAvailable ? '모킹 유지됨' : '모킹 해제됨',
                mockAvailable
            );

            // biometric_enabled가 여전히 true인지 확인
            const biometricEnabled = await page.evaluate(() => localStorage.getItem('biometric_enabled'));
            logResult(results, '4단계', 'biometric_enabled localStorage 상태',
                'true',
                `"${biometricEnabled}"`,
                biometricEnabled === 'true'
            );

            // lock 버튼 클릭하여 잠금 화면으로 전환
            const lockBtnExists = await page.isVisible('#lock-btn');
            if (lockBtnExists) {
                await page.click('#lock-btn');
                console.log('  잠금(lock) 버튼 클릭');
            } else {
                // 직접 lock() 호출
                await page.evaluate(() => App.lock());
                console.log('  App.lock() 직접 호출');
            }

            // lock() 내부에서 setTimeout(() => this.handleBiometricUnlock(), 300) 호출 대기
            await delay(2000);

            const lockVisible = await page.isVisible('#lock-screen');
            logResult(results, '4단계', '잠금 화면 전환',
                '잠금 화면 표시',
                lockVisible ? '잠금 화면 표시됨' : '잠금 화면 미표시',
                lockVisible
            );

            // navigator.credentials.get 호출 여부 확인
            const stateAfterLock = await getBiometricCallState(page);
            const credGetCalledAfterLock = stateAfterLock.credentialsGetCalled === true;
            const callCountAfterLock = stateAfterLock.credentialsGetCallCount || 0;

            logResult(results, '4단계', 'lock() 후 navigator.credentials.get 자동 호출',
                'lock() 시 생체인증 자동 호출되어야 함',
                `호출됨: ${credGetCalledAfterLock}, 호출 횟수: ${callCountAfterLock}`,
                credGetCalledAfterLock
            );

            // 생체인증 버튼 다시 표시되는지 확인
            const biometricBtnAfterLock = await page.isVisible('#biometric-btn');
            logResult(results, '4단계', 'lock() 후 생체인증 버튼 표시',
                '생체인증 버튼이 다시 표시되어야 함',
                biometricBtnAfterLock ? '표시됨' : '미표시',
                biometricBtnAfterLock
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-04-after-lock.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-04-after-lock.png');

        } catch (error) {
            logResult(results, '4단계', 'lock() 후 생체인증',
                '자동 호출', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-04-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 5단계: 생체인증 비활성화 시 자동 호출 안 됨 확인
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('5단계: 생체인증 비활성화 시 자동 호출 안 됨 확인');
        console.log('='.repeat(40));

        try {
            // 메인 화면 전환
            await page.evaluate(() => {
                App.masterPassword = 'test-master';
                App.showScreen('main');
            });
            await delay(500);

            // 생체인증 비활성화
            await page.evaluate(() => {
                localStorage.setItem('biometric_enabled', 'false');
            });

            // 호출 기록 초기화
            await resetBiometricCallState(page);

            // lock() 호출
            await page.evaluate(() => App.lock());
            console.log('  생체인증 비활성화 후 App.lock() 호출');

            await delay(2000);

            const stateDisabled = await getBiometricCallState(page);
            const credGetCalledDisabled = stateDisabled.credentialsGetCalled === true;
            const callCountDisabled = stateDisabled.credentialsGetCallCount || 0;

            logResult(results, '5단계', '생체인증 비활성화 시 자동 호출 안 됨',
                '비활성화 상태에서는 credentials.get이 호출되지 않아야 함',
                `호출됨: ${credGetCalledDisabled}, 호출 횟수: ${callCountDisabled}`,
                !credGetCalledDisabled
            );

            // 생체인증 버튼도 숨겨져야 함
            const biometricBtnHidden = !(await page.isVisible('#biometric-btn'));
            logResult(results, '5단계', '생체인증 비활성화 시 버튼 숨김',
                '생체인증 버튼이 숨겨져야 함',
                biometricBtnHidden ? '버튼 숨겨짐' : '버튼 표시됨',
                biometricBtnHidden
            );

            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-05-disabled.png'), fullPage: true });
            console.log('  >> 스크린샷 저장: bio-05-disabled.png');

        } catch (error) {
            logResult(results, '5단계', '생체인증 비활성화 테스트',
                '호출 안 됨', `오류: ${error.message}`, false, error.message);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bio-05-error.png'), fullPage: true }).catch(() => {});
        }

        // ============================
        // 결과 출력
        // ============================
        printSummary(results, { consoleLogs, networkErrors });

    } finally {
        await browser.close();
    }
}

runTests().catch(error => {
    console.error('테스트 실행 치명적 오류:', error);
    process.exit(1);
});
