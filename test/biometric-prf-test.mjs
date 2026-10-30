/**
 * 생체인증 키 보관 방식 테스트 (이슈 #1)
 *
 * CDP 가상 인증기(WebAuthn.addVirtualAuthenticator)로 실제 WebAuthn 흐름을 실행한다.
 * - PRF 지원 인증기 → scheme 'prf' (키를 어디에도 저장하지 않음)
 * - PRF 미지원 인증기 → scheme 'idb' (IndexedDB에 non-extractable 키)
 * - 구 형식(localStorage device_key) → 잠금 해제 시 새 방식으로 전환
 *
 * 실행: node test/biometric-prf-test.mjs  (서버 불필요, frontend/를 자체 서빙)
 */

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logResult, printSummary } from './test-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

const MASTER = 'Master-Test-1234';
const EMAIL = 'prftest@example.com';
const LOGIN_PW = 'LoginTest123!';

const results = [];

const CONTENT_TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

/**
 * frontend/ 정적 서빙 (WebAuthn RP ID가 localhost여야 하므로 자체 서버 사용)
 */
function startStaticServer() {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(FRONTEND_DIR, urlPath === '/' ? 'index.html' : urlPath);
        if (!filePath.startsWith(FRONTEND_DIR) || !fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
    return new Promise(resolve => server.listen(0, 'localhost', () => resolve(server)));
}

/**
 * 가상 인증기가 붙은 새 페이지 생성
 */
async function openPage(browser, baseUrl, { hasPrf }) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            ctap2Version: 'ctap2_1',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            hasPrf,
            automaticPresenceSimulation: true
        }
    });
    await page.goto(baseUrl);
    await page.waitForFunction(() => typeof Biometric !== 'undefined');
    return { context, page };
}

/**
 * 페이지 저장소 상태 스냅샷
 */
async function storageState(page) {
    return page.evaluate(async () => {
        const idbKey = await Biometric.loadStoredKey().catch(() => null);
        let idbExtractable = null;
        if (idbKey) {
            idbExtractable = await crypto.subtle.exportKey('raw', idbKey).then(() => true, () => false);
        }
        return {
            scheme: localStorage.getItem('biometric_scheme'),
            hasDeviceKey: localStorage.getItem('device_key') !== null,
            enabled: Biometric.isEnabled(),
            hasIdbKey: !!idbKey,
            idbExtractable
        };
    });
}

/**
 * 등록 → 세션 초기화 → 재인증 → 자격증명 → 마스터 변경까지 공통 시나리오
 */
async function runRegisterScenario(page, label, expectedScheme) {
    await page.evaluate(([m, e, p]) => Biometric.register(m, e, p), [MASTER, EMAIL, LOGIN_PW]);
    const state = await storageState(page);

    logResult(results, label, '등록 후 scheme', expectedScheme, String(state.scheme), state.scheme === expectedScheme);
    logResult(results, label, '등록 후 localStorage device_key 없음', 'false', String(state.hasDeviceKey), state.hasDeviceKey === false);

    if (expectedScheme === 'prf') {
        logResult(results, label, 'IndexedDB에 키 없음', 'false', String(state.hasIdbKey), state.hasIdbKey === false);
    } else {
        logResult(results, label, 'IndexedDB에 키 있음', 'true', String(state.hasIdbKey), state.hasIdbKey === true);
        logResult(results, label, 'IndexedDB 키 추출 불가', 'false', String(state.idbExtractable), state.idbExtractable === false);
    }

    // 메모리 세션 키를 버리고 다시 인증 (앱 재시작 상황)
    const unlocked = await page.evaluate(async () => {
        Biometric.clearSession();
        return Biometric.authenticate();
    });
    logResult(results, label, '세션 초기화 후 재인증으로 마스터 복원', MASTER, unlocked, unlocked === MASTER);

    const creds = await page.evaluate(() => Biometric.getLoginCredentials());
    const credsOk = creds && creds.email === EMAIL && creds.password === LOGIN_PW;
    logResult(results, label, '로그인 자격증명 복원', EMAIL, creds && creds.email, !!credsOk);

    // 세션 키 없이 마스터 변경 → 다시 인증 시 새 마스터
    const afterChange = await page.evaluate(async () => {
        Biometric.clearSession();
        await Biometric.updateMaster('Changed-Master-5678');
        Biometric.clearSession();
        return Biometric.authenticate();
    });
    logResult(results, label, '마스터 변경 반영', 'Changed-Master-5678', afterChange, afterChange === 'Changed-Master-5678');
}

/**
 * 구 형식(평문 device_key) 데이터를 만든다 — 변경 전 biometric.js 로직 그대로
 */
async function seedLegacyData(page) {
    await page.evaluate(async ([m, e, p]) => {
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: '비밀번호 관리', id: 'localhost' },
                user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'user@passwordmanager', displayName: '사용자' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
                attestation: 'none'
            }
        });
        localStorage.setItem('credential_id', btoa(String.fromCharCode(...new Uint8Array(credential.rawId))));

        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
        localStorage.setItem('device_key', btoa(String.fromCharCode(...raw)));

        const enc = async (text) => {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
            const combined = new Uint8Array(iv.length + ct.length);
            combined.set(iv, 0);
            combined.set(ct, iv.length);
            return btoa(String.fromCharCode(...combined));
        };
        localStorage.setItem('encrypted_master', await enc(m));
        localStorage.setItem('encrypted_login_credentials', await enc(JSON.stringify({ email: e, password: p })));
        localStorage.setItem('biometric_enabled', 'true');
    }, [MASTER, EMAIL, LOGIN_PW]);
}

async function testPrf(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await runRegisterScenario(page, 'PRF', 'prf');
    await context.close();
}

async function testIdbFallback(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: false });
    await runRegisterScenario(page, 'IDB폴백', 'idb');
    await context.close();
}

async function testLegacyMigration(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await seedLegacyData(page);

    const unlocked = await page.evaluate(() => Biometric.authenticate());
    logResult(results, '마이그레이션', '구 형식으로 잠금 해제', MASTER, unlocked, unlocked === MASTER);

    const state = await storageState(page);
    logResult(results, '마이그레이션', '전환 후 scheme', 'prf', String(state.scheme), state.scheme === 'prf');
    logResult(results, '마이그레이션', '전환 후 device_key 삭제', 'false', String(state.hasDeviceKey), state.hasDeviceKey === false);

    const creds = await page.evaluate(() => Biometric.getLoginCredentials());
    logResult(results, '마이그레이션', '자격증명 유지', EMAIL, creds && creds.email, !!creds && creds.email === EMAIL);

    const again = await page.evaluate(async () => {
        Biometric.clearSession();
        return Biometric.authenticate();
    });
    logResult(results, '마이그레이션', '전환 후 재인증', MASTER, again, again === MASTER);
    await context.close();
}

async function testLegacyMigrationFailure(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await seedLegacyData(page);

    // 재등록 실패(예: 사용자가 두 번째 지문을 취소) 상황
    const outcome = await page.evaluate(async () => {
        Biometric.register = async () => { throw new Error('생체인증이 취소되었습니다.'); };
        const master = await Biometric.authenticate();
        const creds = await Biometric.getLoginCredentials();
        return { master, email: creds && creds.email };
    });
    logResult(results, '전환실패', '잠금 해제는 성공', MASTER, outcome.master, outcome.master === MASTER);
    logResult(results, '전환실패', '이번 세션 자격증명은 사용 가능', EMAIL, outcome.email, outcome.email === EMAIL);

    const state = await storageState(page);
    logResult(results, '전환실패', '구 키 삭제', 'false', String(state.hasDeviceKey), state.hasDeviceKey === false);
    logResult(results, '전환실패', '생체인증 해제(재설정 유도)', 'false', String(state.enabled), state.enabled === false);
    await context.close();
}

async function testLegacyMigrationCancelled(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await seedLegacyData(page);

    // 재등록 지문 프롬프트를 사용자가 취소 → 구 데이터 유지, 다음 해제 때 재시도
    const master = await page.evaluate(async () => {
        Biometric.createCredential = async () => {
            const error = new Error('cancelled');
            error.name = 'NotAllowedError';
            throw error;
        };
        return Biometric.authenticate();
    });
    logResult(results, '전환취소', '잠금 해제는 성공', MASTER, master, master === MASTER);

    const state = await storageState(page);
    logResult(results, '전환취소', '구 데이터 유지(재시도 대상)', 'true', String(state.hasDeviceKey), state.hasDeviceKey === true);
    logResult(results, '전환취소', '생체인증 유지', 'true', String(state.enabled), state.enabled === true);
    await context.close();
}

async function testLegacyUpdateMasterCancelled(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await seedLegacyData(page);

    // 구 형식 상태에서 마스터 변경 중 전환 취소 → 다음 해제 시 새 마스터가 나와야 함
    const unlocked = await page.evaluate(async () => {
        const originalCreate = Biometric.createCredential;
        Biometric.createCredential = async () => {
            const error = new Error('cancelled');
            error.name = 'NotAllowedError';
            throw error;
        };
        await Biometric.updateMaster('New-Master-9999');
        Biometric.createCredential = originalCreate;
        Biometric.clearSession();
        return Biometric.authenticate();
    });
    logResult(results, '구형마스터변경', '취소 후에도 새 마스터 복원', 'New-Master-9999', unlocked, unlocked === 'New-Master-9999');
    await context.close();
}

async function testLegacyCancelLimit(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });
    await seedLegacyData(page);

    // 전환을 계속 취소하면 3회째에 구 데이터 삭제 (평문 키가 영구히 남지 않도록)
    const states = await page.evaluate(async () => {
        Biometric.createCredential = async () => {
            const error = new Error('cancelled');
            error.name = 'NotAllowedError';
            throw error;
        };
        const seen = [];
        for (let i = 0; i < 3; i++) {
            await Biometric.authenticate();
            seen.push(localStorage.getItem('device_key') !== null);
        }
        return seen;
    });
    const ok = JSON.stringify(states) === JSON.stringify([true, true, false]);
    logResult(results, '취소상한', '3회째 취소 시 구 키 삭제', '[true,true,false]', JSON.stringify(states), ok);
    await context.close();
}

async function testRegisterFailureLeavesNoState(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });

    // 키 유도 이후 단계에서 실패 → 저장소에 반쪽 상태가 남지 않아야 함
    const leftovers = await page.evaluate(async ([m, e, p]) => {
        Biometric.encryptWithKey = async () => { throw new Error('encrypt failed'); };
        await Biometric.register(m, e, p).catch(() => {});
        return ['biometric_enabled', 'encrypted_master', 'credential_id', 'biometric_scheme']
            .filter(k => localStorage.getItem(k) !== null);
    }, [MASTER, EMAIL, LOGIN_PW]);
    logResult(results, '등록실패', '저장소에 반쪽 상태 없음', '[]', JSON.stringify(leftovers), leftovers.length === 0);
    await context.close();
}

async function testStableUserHandle(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: true });

    // 재등록 시 같은 user.id를 써야 기기에 패스키가 쌓이지 않음
    const ids = await page.evaluate(async ([m, e, p]) => {
        const seen = [];
        const originalCreate = navigator.credentials.create.bind(navigator.credentials);
        navigator.credentials.create = (options) => {
            seen.push(btoa(String.fromCharCode(...new Uint8Array(options.publicKey.user.id))));
            return originalCreate(options);
        };
        await Biometric.register(m, e, p);
        Biometric.disable();
        await Biometric.register(m, e, p);
        return seen;
    }, [MASTER, EMAIL, LOGIN_PW]);
    const same = ids.length === 2 && ids[0] === ids[1];
    logResult(results, '패스키', '재등록 시 user.id 유지', 'same', same ? 'same' : JSON.stringify(ids), same);
    await context.close();
}

async function testDisable(browser, baseUrl) {
    const { context, page } = await openPage(browser, baseUrl, { hasPrf: false });
    await page.evaluate(([m, e, p]) => Biometric.register(m, e, p), [MASTER, EMAIL, LOGIN_PW]);
    await page.evaluate(() => Biometric.disable());
    // disable의 IndexedDB 삭제는 비동기이므로 완료 대기
    await page.waitForFunction(async () => !(await Biometric.loadStoredKey()));

    const leftovers = await page.evaluate(() =>
        ['biometric_enabled', 'encrypted_master', 'encrypted_login_credentials', 'credential_id', 'device_key', 'biometric_scheme']
            .filter(k => localStorage.getItem(k) !== null)
    );
    logResult(results, '비활성화', 'localStorage 잔여 항목 없음', '[]', JSON.stringify(leftovers), leftovers.length === 0);
    const state = await storageState(page);
    logResult(results, '비활성화', 'IndexedDB 키 삭제', 'false', String(state.hasIdbKey), state.hasIdbKey === false);
    await context.close();
}

/**
 * 서비스워커 설치 성공 + 생체인증 모듈 캐시 여부 (캐시 목록에 없는 파일이 있으면 설치 실패)
 */
async function testServiceWorkerCache(browser, baseUrl) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(baseUrl);

    const cached = await page.evaluate(async () => {
        const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 5000));
        const ready = navigator.serviceWorker.ready.then(() => 'ready');
        if (await Promise.race([ready, timeout]) !== 'ready') return null;
        const keys = await caches.keys();
        const cache = await caches.open(keys[0]);
        return (await cache.keys()).map(r => new URL(r.url).pathname);
    });
    logResult(results, '서비스워커', '설치 완료', 'ready', cached ? 'ready' : 'timeout', !!cached);
    const hasBiometric = !!cached && cached.includes('/js/biometric.js');
    logResult(results, '서비스워커', 'biometric.js 캐시', 'true', String(hasBiometric), hasBiometric);
    await context.close();
}

async function main() {
    const server = await startStaticServer();
    const baseUrl = `http://localhost:${server.address().port}/`;
    // Playwright 번들 브라우저가 없으면 설치된 Chrome 사용
    const browser = await chromium.launch({ headless: true })
        .catch(() => chromium.launch({ headless: true, channel: 'chrome' }));

    const tests = [
        testPrf, testIdbFallback, testLegacyMigration, testLegacyMigrationFailure,
        testLegacyMigrationCancelled, testLegacyUpdateMasterCancelled, testLegacyCancelLimit,
        testRegisterFailureLeavesNoState, testStableUserHandle,
        testDisable, testServiceWorkerCache
    ];
    for (const test of tests) {
        try {
            await test(browser, baseUrl);
        } catch (error) {
            logResult(results, test.name, '실행', '예외 없음', error.message.split('\n')[0], false, error.message);
        }
    }

    await browser.close();
    server.close();
    printSummary(results);
}

main();
