/**
 * 붙여넣기 자동 파싱 기능 테스트
 *
 * Mock API로 로그인 → 마스터 비밀번호 설정 → 메인 화면 진입 후
 * 붙여넣기 모달 열기 → 텍스트 입력 → 파싱 결과 확인
 */

import { createBrowser, logResult, printSummary, delay, SCREENSHOT_DIR, FRONTEND_URL } from './test-utils.mjs';
import path from 'path';

const results = [];

// Mock JWT 토큰
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTcwMDAwMDAwMH0.mock';
const TEST_EMAIL = 'pwtest@example.com';
const TEST_PASSWORD = 'TestPass123!';
const MASTER_PASSWORD = 'Master123!';

/**
 * Mock API 설정
 */
async function setupMockAPI(page) {
    // 회원가입
    await page.route('**/api/auth/register', async (route) => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        const body = JSON.parse(route.request().postData());
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

    // 로그인
    await page.route('**/api/auth/login', async (route) => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        const body = JSON.parse(route.request().postData());
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

    // 사용자 정보
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                user: { id: 1, email: TEST_EMAIL },
                hasVault: false,
                hasMasterPassword: false
            })
        });
    });

    // Vault
    await page.route('**/api/vault', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ masterHash: null, encryptedData: null })
            });
        } else if (method === 'PUT') {
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
 * 로그인 → 마스터 비밀번호 설정 → 메인 화면 진입 헬퍼
 */
async function navigateToMainScreen(page) {
    await setupMockAPI(page);
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await delay(1500);

    // 로그인
    await page.fill('#login-email', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await delay(2000);

    // 마스터 비밀번호 설정
    const lockVisible = await page.isVisible('#lock-screen');
    if (lockVisible) {
        await page.fill('#master-password', MASTER_PASSWORD);
        await page.click('#unlock-btn');
        await delay(2000);
    }

    // 메인 화면 확인
    const mainVisible = await page.isVisible('#main-screen');
    return mainVisible;
}

async function runTests() {
    const { browser, page, consoleLogs, networkErrors } = await createBrowser();

    try {
        // ============================
        // 1단계: 메인 화면 진입
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('1단계: 메인 화면 진입');
        console.log('='.repeat(40));

        const mainReady = await navigateToMainScreen(page);
        logResult(results, '1단계', '로그인 → 메인 화면 진입',
            '메인 화면 표시',
            mainReady ? '메인 화면 표시됨' : '메인 화면 미표시',
            mainReady
        );

        if (!mainReady) {
            console.log('  메인 화면 진입 실패. 현재 화면 상태 확인 중...');
            const screens = await page.evaluate(() => {
                return ['login-screen', 'register-screen', 'lock-screen', 'main-screen', 'edit-screen']
                    .map(id => ({ id, visible: document.getElementById(id)?.classList.contains('active') }));
            });
            console.log('  화면 상태:', JSON.stringify(screens));
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-01-fail.png'), fullPage: true });
            throw new Error('메인 화면 진입 실패');
        }

        // 붙여넣기 FAB 버튼 존재 확인
        const pasteBtnVisible = await page.isVisible('#paste-btn');
        logResult(results, '1단계', '붙여넣기 FAB 버튼 확인',
            '📋 붙여넣기 버튼이 보여야 함',
            pasteBtnVisible ? '버튼 표시됨' : '버튼 미표시',
            pasteBtnVisible
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-01-main.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-01-main.png');

        // ============================
        // 2단계: 붙여넣기 모달 열기/닫기
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('2단계: 붙여넣기 모달 열기/닫기');
        console.log('='.repeat(40));

        // 모달 열기
        await page.click('#paste-btn');
        await delay(500);

        const modalVisible = await page.evaluate(() =>
            document.getElementById('paste-modal')?.classList.contains('show')
        );
        logResult(results, '2단계', '모달 열기',
            '모달이 show 클래스를 가져야 함',
            modalVisible ? '모달 표시됨' : '모달 미표시',
            modalVisible
        );

        // 모달 내 요소 확인
        const modalElements = await page.evaluate(() => ({
            textarea: !!document.getElementById('paste-input'),
            analyzeBtn: !!document.getElementById('paste-analyze-btn'),
            closeBtn: !!document.getElementById('paste-modal-close'),
            placeholder: document.getElementById('paste-input')?.placeholder || ''
        }));

        logResult(results, '2단계', '모달 UI 요소 확인',
            'textarea, 분석 버튼, 닫기 버튼 존재',
            `textarea:${modalElements.textarea}, 분석버튼:${modalElements.analyzeBtn}, 닫기:${modalElements.closeBtn}`,
            modalElements.textarea && modalElements.analyzeBtn && modalElements.closeBtn
        );

        logResult(results, '2단계', 'textarea 플레이스홀더',
            '예시 텍스트 포함',
            `"${modalElements.placeholder.substring(0, 30)}..."`,
            modalElements.placeholder.length > 0
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-02-modal-open.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-02-modal-open.png');

        // 닫기 버튼으로 모달 닫기
        await page.click('#paste-modal-close');
        await delay(300);

        const modalClosed = await page.evaluate(() =>
            !document.getElementById('paste-modal')?.classList.contains('show')
        );
        logResult(results, '2단계', '닫기 버튼으로 모달 닫기',
            '모달이 닫혀야 함',
            modalClosed ? '모달 닫힘' : '모달 여전히 열림',
            modalClosed
        );

        // 배경 클릭으로 모달 닫기 테스트
        await page.click('#paste-btn');
        await delay(500);
        await page.click('#paste-modal', { position: { x: 10, y: 10 } }); // 배경 영역 클릭
        await delay(300);

        const modalClosedByBg = await page.evaluate(() =>
            !document.getElementById('paste-modal')?.classList.contains('show')
        );
        logResult(results, '2단계', '배경 클릭으로 모달 닫기',
            '배경 클릭 시 모달 닫혀야 함',
            modalClosedByBg ? '모달 닫힘' : '모달 여전히 열림',
            modalClosedByBg
        );

        // ============================
        // 3단계: 빈 텍스트 분석 시도 (예외 처리)
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('3단계: 빈 텍스트 분석 시도');
        console.log('='.repeat(40));

        await page.click('#paste-btn');
        await delay(500);

        // textarea 비우고 분석 버튼 클릭
        await page.fill('#paste-input', '');
        await page.click('#paste-analyze-btn');
        await delay(500);

        // 토스트 메시지 확인
        const emptyToast = await page.evaluate(() =>
            document.getElementById('toast')?.textContent || ''
        );

        logResult(results, '3단계', '빈 텍스트 분석 방지',
            '"텍스트를 붙여넣어주세요" 토스트',
            `토스트: "${emptyToast}"`,
            emptyToast.includes('텍스트') || emptyToast.includes('붙여넣')
        );

        // 모달이 여전히 열려있는지 확인 (빈 텍스트이므로 닫히면 안됨)
        const modalStillOpen = await page.evaluate(() =>
            document.getElementById('paste-modal')?.classList.contains('show')
        );
        logResult(results, '3단계', '모달 유지 (빈 텍스트)',
            '빈 텍스트 시 모달이 열려있어야 함',
            modalStillOpen ? '모달 유지됨' : '모달 닫힘',
            modalStillOpen
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-03-empty.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-03-empty.png');

        // 모달 닫기
        await page.click('#paste-modal-close');
        await delay(300);

        // ============================
        // 4단계: 은행 정보 파싱 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('4단계: 은행 정보 파싱 테스트');
        console.log('='.repeat(40));

        const bankText = `신한은행 인터넷뱅킹
아이디: mybank123
비번: s3cret!@#
https://banking.shinhan.com
OTP 카드번호 1234-5678`;

        await page.click('#paste-btn');
        await delay(500);
        await page.fill('#paste-input', bankText);
        await delay(200);

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-04-bank-input.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-04-bank-input.png');

        await page.click('#paste-analyze-btn');
        await delay(1000);

        // 편집 화면으로 이동했는지 확인
        const editVisible = await page.isVisible('#edit-screen');
        logResult(results, '4단계', '편집 화면 전환',
            '분석 후 편집 화면으로 이동',
            editVisible ? '편집 화면 표시됨' : '편집 화면 미표시',
            editVisible
        );

        // 파싱된 값 확인
        const bankParsed = await page.evaluate(() => ({
            siteName: document.getElementById('site-name')?.value || '',
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || '',
            notes: document.getElementById('notes')?.value || '',
            category: document.getElementById('category-select')?.value || '',
            passwordType: document.getElementById('password')?.type || ''
        }));

        logResult(results, '4단계', '사이트명 파싱',
            'banking.shinhan.com (URL 도메인)',
            `"${bankParsed.siteName}"`,
            bankParsed.siteName.includes('shinhan')
        );

        logResult(results, '4단계', '아이디 파싱',
            'mybank123',
            `"${bankParsed.username}"`,
            bankParsed.username === 'mybank123'
        );

        logResult(results, '4단계', '비밀번호 파싱',
            's3cret!@#',
            `"${bankParsed.password}"`,
            bankParsed.password === 's3cret!@#'
        );

        logResult(results, '4단계', '비밀번호 표시 모드',
            '비밀번호가 text 타입으로 보여야 함',
            `type="${bankParsed.passwordType}"`,
            bankParsed.passwordType === 'text'
        );

        logResult(results, '4단계', '카테고리 자동 감지',
            '은행',
            `"${bankParsed.category}"`,
            bankParsed.category === '은행'
        );

        logResult(results, '4단계', '메모에 추가 정보 포함',
            'OTP 카드번호 포함',
            `메모: "${bankParsed.notes.substring(0, 60)}..."`,
            bankParsed.notes.includes('OTP') || bankParsed.notes.includes('카드번호')
        );

        // 토스트 메시지 확인
        const analyzeToast = await page.evaluate(() =>
            document.getElementById('toast')?.textContent || ''
        );
        logResult(results, '4단계', '성공 토스트 메시지',
            '"자동 분류 완료" 메시지',
            `"${analyzeToast}"`,
            analyzeToast.includes('자동 분류') || analyzeToast.includes('완료')
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-04-bank-result.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-04-bank-result.png');

        // ============================
        // 5단계: 이메일+비밀번호 간단 입력 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('5단계: 이메일+비밀번호 간단 입력 테스트');
        console.log('='.repeat(40));

        // 뒤로가기로 메인 화면 복귀
        await page.click('#back-btn');
        await delay(500);

        const simpleText = `test@gmail.com
mypassword123
네이버`;

        await page.click('#paste-btn');
        await delay(500);
        await page.fill('#paste-input', simpleText);
        await delay(200);

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-05-simple-input.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-05-simple-input.png');

        await page.click('#paste-analyze-btn');
        await delay(1000);

        const simpleParsed = await page.evaluate(() => ({
            siteName: document.getElementById('site-name')?.value || '',
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || '',
            category: document.getElementById('category-select')?.value || ''
        }));

        logResult(results, '5단계', '이메일 → 아이디로 인식',
            'test@gmail.com',
            `"${simpleParsed.username}"`,
            simpleParsed.username === 'test@gmail.com'
        );

        logResult(results, '5단계', '다음 줄 → 비밀번호 추론',
            'mypassword123',
            `"${simpleParsed.password}"`,
            simpleParsed.password === 'mypassword123'
        );

        logResult(results, '5단계', '네이버 → 사이트명 + 생활 카테고리',
            '사이트명: 네이버, 카테고리: 생활',
            `사이트명: "${simpleParsed.siteName}", 카테고리: "${simpleParsed.category}"`,
            simpleParsed.siteName === '네이버' && simpleParsed.category === '생활'
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-05-simple-result.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-05-simple-result.png');

        // ============================
        // 6단계: 암호화폐 정보 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('6단계: 암호화폐 정보 테스트');
        console.log('='.repeat(40));

        await page.click('#back-btn');
        await delay(500);

        const cryptoText = `업비트 거래소
ID: crypto_trader
비밀번호: Upb!t2024#secure
https://upbit.com
2FA 시크릿키: JBSWY3DPEHPK3PXP`;

        await page.click('#paste-btn');
        await delay(500);
        await page.fill('#paste-input', cryptoText);
        await delay(200);

        await page.click('#paste-analyze-btn');
        await delay(1000);

        const cryptoParsed = await page.evaluate(() => ({
            siteName: document.getElementById('site-name')?.value || '',
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || '',
            category: document.getElementById('category-select')?.value || '',
            notes: document.getElementById('notes')?.value || ''
        }));

        logResult(results, '6단계', '사이트명 파싱 (URL 도메인)',
            'upbit.com',
            `"${cryptoParsed.siteName}"`,
            cryptoParsed.siteName.includes('upbit')
        );

        logResult(results, '6단계', '아이디 파싱 (ID: 키워드)',
            'crypto_trader',
            `"${cryptoParsed.username}"`,
            cryptoParsed.username === 'crypto_trader'
        );

        logResult(results, '6단계', '비밀번호 파싱',
            'Upb!t2024#secure',
            `"${cryptoParsed.password}"`,
            cryptoParsed.password === 'Upb!t2024#secure'
        );

        logResult(results, '6단계', '카테고리: 암호화폐',
            '암호화폐',
            `"${cryptoParsed.category}"`,
            cryptoParsed.category === '암호화폐'
        );

        logResult(results, '6단계', '2FA 시크릿키 메모 포함',
            '2FA 시크릿키 정보가 메모에 포함',
            `메모: "${cryptoParsed.notes.substring(0, 50)}..."`,
            cryptoParsed.notes.includes('2FA') || cryptoParsed.notes.includes('JBSWY')
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-06-crypto-result.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-06-crypto-result.png');

        // ============================
        // 7단계: 키워드 없는 최소 입력 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('7단계: 키워드 없는 최소 입력 테스트');
        console.log('='.repeat(40));

        await page.click('#back-btn');
        await delay(500);

        const minimalText = `쿠팡
coupang_user
Shop2024!`;

        await page.click('#paste-btn');
        await delay(500);
        await page.fill('#paste-input', minimalText);
        await delay(200);

        await page.click('#paste-analyze-btn');
        await delay(1000);

        const minimalParsed = await page.evaluate(() => ({
            siteName: document.getElementById('site-name')?.value || '',
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || '',
            category: document.getElementById('category-select')?.value || ''
        }));

        // 쿠팡은 카테고리 키워드에 있으므로 사이트명으로 인식될 수 있음
        logResult(results, '7단계', '사이트명 추출 (첫 줄)',
            '쿠팡',
            `"${minimalParsed.siteName}"`,
            minimalParsed.siteName === '쿠팡'
        );

        logResult(results, '7단계', '카테고리 자동 감지 (쿠팡 → 생활)',
            '생활',
            `"${minimalParsed.category}"`,
            minimalParsed.category === '생활'
        );

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-07-minimal-result.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-07-minimal-result.png');

        // ============================
        // 8단계: PasteParser.parse() 직접 단위 테스트
        // ============================
        console.log('\n' + '='.repeat(40));
        console.log('8단계: PasteParser.parse() 단위 테스트');
        console.log('='.repeat(40));

        const unitTests = await page.evaluate(() => {
            const tests = [];

            // 빈 입력
            const r1 = PasteParser.parse('');
            tests.push({
                name: '빈 문자열',
                passed: r1.siteName === '' && r1.username === '' && r1.password === '',
                result: JSON.stringify(r1)
            });

            // null 입력
            const r2 = PasteParser.parse(null);
            tests.push({
                name: 'null 입력',
                passed: r2.siteName === '' && r2.username === '' && r2.password === '',
                result: JSON.stringify(r2)
            });

            // 이메일이 URL로 잘못 인식되지 않는지
            const r3 = PasteParser.parse('user@gmail.com\npass1234');
            tests.push({
                name: '이메일 ≠ URL (gmail.com이 사이트명이 아님)',
                passed: r3.username === 'user@gmail.com' && r3.siteName !== 'gmail.com',
                result: `username="${r3.username}", siteName="${r3.siteName}"`
            });

            // 여러 URL 중 첫 번째 도메인 사용
            const r4 = PasteParser.parse('https://example.com\nhttps://sub.example.org\n아이디: testuser');
            tests.push({
                name: '첫 번째 URL 도메인 = 사이트명',
                passed: r4.siteName === 'example.com',
                result: `siteName="${r4.siteName}"`
            });

            // 증권 키워드 감지
            const r5 = PasteParser.parse('키움증권\n아이디: stock_user\npw: trade123');
            tests.push({
                name: '증권 카테고리 감지 (키움증권)',
                passed: r5.category === '증권' && r5.username === 'stock_user' && r5.password === 'trade123',
                result: `category="${r5.category}", username="${r5.username}", password="${r5.password}"`
            });

            return tests;
        });

        for (const t of unitTests) {
            logResult(results, '8단계', t.name,
                'PASS',
                t.result,
                t.passed
            );
        }

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-08-unit-tests.png'), fullPage: true });
        console.log('  >> 스크린샷: paste-08-unit-tests.png');

    } catch (error) {
        logResult(results, '치명적 오류', error.message, '정상 실행', `오류: ${error.message}`, false, error.message);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'paste-error.png'), fullPage: true }).catch(() => {});
    } finally {
        printSummary(results, { consoleLogs, networkErrors });
        await browser.close();
    }
}

runTests().catch(error => {
    console.error('테스트 실행 치명적 오류:', error);
    process.exit(1);
});
