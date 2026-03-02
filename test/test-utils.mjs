/**
 * 브라우저 테스트 공통 유틸리티
 *
 * 사용법:
 *   import { createBrowser, logResult, printSummary, checkServers } from './test-utils.mjs';
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// 기본 URL
export const FRONTEND_URL = 'http://localhost:5500';
export const BACKEND_URL = 'http://localhost:3000';

// 테스트 데이터 (실제 비밀번호 사용 금지)
export const TEST_EMAIL = 'pwtest@example.com';
export const TEST_PASSWORD = 'TestPass123!';

/**
 * 브라우저 + 컨텍스트 + 페이지 생성 (headless, 모바일 뷰포트)
 * @returns {{ browser, context, page, consoleLogs: Array, networkErrors: Array }}
 */
export async function createBrowser() {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
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

    return { browser, context, page, consoleLogs, networkErrors };
}

/**
 * 테스트 결과 기록
 * @param {Array} results - 결과를 저장할 배열
 * @param {string} step - 단계명 (예: '1단계')
 * @param {string} action - 동작 설명
 * @param {string} expected - 예상 결과
 * @param {string} actual - 실제 결과
 * @param {boolean} passed - 통과 여부
 * @param {string} [issue] - 실패 시 문제점
 */
export function logResult(results, step, action, expected, actual, passed, issue = null) {
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

/**
 * 테스트 결과 요약 출력
 * @param {Array} results - logResult로 수집한 결과 배열
 * @param {{ consoleLogs?: Array, networkErrors?: Array }} [extras] - 콘솔/네트워크 에러
 */
export function printSummary(results, extras = {}) {
    const { consoleLogs = [], networkErrors = [] } = extras;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    console.log('\n');
    console.log('='.repeat(60));
    console.log('                 테스트 결과 요약 보고서');
    console.log('='.repeat(60));
    console.log('');
    console.log(`  총 테스트: ${total}개`);
    console.log(`  성공: ${passed}개`);
    console.log(`  실패: ${failed}개`);
    console.log(`  성공률: ${total > 0 ? Math.round((passed / total) * 100) : 0}%`);
    console.log('');

    // 단계별 요약
    const steps = [...new Set(results.map(r => r.step))];
    steps.forEach(step => {
        const stepResults = results.filter(r => r.step === step);
        const stepPassed = stepResults.filter(r => r.passed).length;
        const stepTotal = stepResults.length;
        const icon = stepPassed === stepTotal ? 'PASS' : 'FAIL';
        console.log(`  [${icon}] ${step}: ${stepPassed}/${stepTotal} 성공`);
    });

    // 실패 목록
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

    // 전체 결과
    console.log('');
    console.log('-'.repeat(40));
    console.log('  전체 테스트 결과:');
    console.log('-'.repeat(40));
    results.forEach(r => {
        const icon = r.passed ? 'PASS' : 'FAIL';
        console.log(`  [${icon}] ${r.step} - ${r.action}`);
    });

    // 콘솔 에러
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

    // 네트워크 에러
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
}

/**
 * 프론트엔드/백엔드 서버 상태 확인
 * @param {string} [frontendUrl] - 프론트엔드 URL
 * @param {string} [backendUrl] - 백엔드 URL
 * @returns {{ frontend: boolean, backend: boolean }}
 */
export async function checkServers(frontendUrl = FRONTEND_URL, backendUrl = BACKEND_URL) {
    const result = { frontend: false, backend: false };

    try {
        const res = await fetch(frontendUrl, { signal: AbortSignal.timeout(5000) });
        result.frontend = res.ok;
    } catch {
        result.frontend = false;
    }

    try {
        const res = await fetch(backendUrl, { signal: AbortSignal.timeout(5000) });
        result.backend = res.ok || res.status < 500;
    } catch {
        result.backend = false;
    }

    return result;
}

/**
 * 짧은 대기 (waitForTimeout 대체)
 * @param {number} ms - 밀리초
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 단독 실행 시 유틸리티 검증
if (process.argv[1] && process.argv[1].includes('test-utils')) {
    console.log('test-utils.mjs 검증 시작');
    console.log('  SCREENSHOT_DIR:', SCREENSHOT_DIR);
    console.log('  FRONTEND_URL:', FRONTEND_URL);
    console.log('  BACKEND_URL:', BACKEND_URL);

    // logResult + printSummary 테스트
    const testResults = [];
    logResult(testResults, '검증', 'logResult 동작', '결과 배열에 추가', '추가됨', true);
    logResult(testResults, '검증', 'printSummary 동작', '요약 출력', '출력됨', true);
    printSummary(testResults);

    // 서버 확인 (실패해도 정상)
    console.log('\n서버 상태 확인 중...');
    const servers = await checkServers();
    console.log('  프론트엔드:', servers.frontend ? 'ON' : 'OFF');
    console.log('  백엔드:', servers.backend ? 'ON' : 'OFF');

    console.log('\ntest-utils.mjs 검증 완료 (에러 없음)');
}
