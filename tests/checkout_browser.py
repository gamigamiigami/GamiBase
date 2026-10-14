"""Exercise real coupon checkout and installation guidance using a temporary server/DB."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'test-results'
OUTPUT.mkdir(exist_ok=True)

with tempfile.TemporaryDirectory(prefix='shigodeki-checkout-') as tmp:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = {**os.environ, 'PORT': str(port), 'HOST': '127.0.0.1', 'APP_ORIGIN': base,
           'SHIGODEKI_DATA_DIR': tmp, 'SHIGODEKI_COUPON_CODE': 'browser-coupon-only'}
    with (OUTPUT / 'checkout-server.log').open('w') as log:
        entry = 'tests/supabase-dev-server.mjs' if os.environ.get('SHIGODEKI_TEST_BACKEND') == 'supabase' else 'server/index.mjs'
        server = subprocess.Popen(['node', entry], cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            for _ in range(60):
                try:
                    with urlopen(base + '/healthz', timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError('Test server did not start')
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
                context = browser.new_context(viewport={'width': 1440, 'height': 1100})
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(base + '/tools/shigodeki-sensei/')
                expect(page.locator('[data-checkout]').first).to_have_attribute('href', base + '/tools/shigodeki-sensei/checkout.html')
                assert '50,000' not in page.locator('body').inner_text()
                page.locator('[data-checkout]').first.click()
                expect(page.locator('#checkout')).to_be_visible()
                expect(page.locator('#registration')).not_to_be_visible()
                assert '50,000' not in page.locator('body').inner_text()
                page.screenshot(path=str(OUTPUT / 'checkout-before.png'), full_page=True)
                page.locator('#coupon').fill('invalid-code')
                page.locator('#apply-coupon').click()
                expect(page.locator('#coupon-error')).to_contain_text('コードを確認')
                expect(page.locator('#registration')).not_to_be_visible()
                page.locator('#coupon').fill(env['SHIGODEKI_COUPON_CODE'])
                page.locator('#apply-coupon').click()
                expect(page.locator('#coupon-discount')).to_have_text('−50,000円')
                expect(page.locator('#total')).to_have_text('0円')
                expect(page.locator('#registration')).to_be_visible()
                page.screenshot(path=str(OUTPUT / 'checkout-applied.png'), full_page=True)
                page.locator('#coupon').fill('another-code')
                expect(page.locator('#quote')).not_to_be_visible()
                expect(page.locator('#registration')).not_to_be_visible()
                page.locator('#coupon').fill(env['SHIGODEKI_COUPON_CODE'])
                page.locator('#apply-coupon').click()
                expect(page.locator('#registration')).to_be_visible()
                password = secrets.token_hex(24)
                email = 'coupon-browser@example.com'
                page.locator('#buyer-email').fill(email)
                page.locator('#buyer-password').fill(password)
                page.locator('#password-confirm').fill('does-not-match-password')
                page.locator('#get-app').click()
                expect(page.locator('#register-error')).to_contain_text('一致しません')
                page.locator('#password-confirm').fill(password)
                page.locator('#get-app').click()
                expect(page.locator('#complete')).to_be_visible()
                expect(page.locator('#receipt')).to_contain_text('お支払い額 0円')
                page.reload()
                expect(page.locator('#complete')).to_be_visible()
                page.screenshot(path=str(OUTPUT / 'checkout-complete.png'), full_page=True)
                print('PASS: hidden discount, invalid/changed coupons, 50,000-yen discount, zero total, registration and receipt recovery', flush=True)

                page.locator('#open-app').click()
                expect(page.locator('#app-view')).to_be_visible()
                expect(page.locator('#settings-dialog')).to_be_visible()
                page.locator('#owner').fill('クーポン取得テスト')
                page.locator('#add-lesson').click()
                page.locator('[data-lesson-name]').last.fill('2年3組 国語')
                page.locator('#settings-form button[type=submit]').click()
                expect(page.locator('#settings-dialog')).not_to_be_visible()
                expect(page.locator('#save-status')).to_have_text('保存済み')
                expect(page.locator('#install-button')).to_be_visible()
                # Real browser fallback guidance; native OS installation is tested on device.
                page.locator('#install-button').click()
                expect(page.locator('#install-dialog')).to_be_visible()
                expect(page.locator('#install-dialog')).to_contain_text('ホーム画面に追加')
                page.screenshot(path=str(OUTPUT / 'app-install-guide.png'), full_page=True)
                page.locator('[data-close="install-dialog"]').click()
                page.evaluate('''() => {
                  const e = new Event('beforeinstallprompt', {cancelable: true});
                  e.prompt = async () => {window.testInstallPrompted = true;};
                  e.userChoice = Promise.resolve({outcome:'accepted'});
                  window.dispatchEvent(e);
                }''')
                page.locator('#install-button').click()
                expect(page.locator('#install-button')).to_be_disabled()
                assert page.evaluate('window.testInstallPrompted')
                page.evaluate('navigator.serviceWorker.ready')
                assert page.evaluate("""async () => {
                  const cache = await caches.open('shigodeki-shell-v3');
                  const urls = (await cache.keys()).map(r => r.url);
                  return urls.some(u => u.endsWith('/install.mjs')) && !urls.some(u => u.includes('/api/'));
                }""")
                page.reload()
                expect(page.locator('#owner-label')).to_have_text('クーポン取得テスト')
                print('PASS: acquired account opens app, saves timetable, install guidance and native-prompt event; service worker excludes APIs', flush=True)

                other = browser.new_context(viewport={'width': 390, 'height': 844})
                mobile = other.new_page()
                mobile.on('pageerror', lambda error: errors.append(str(error)))
                mobile.goto(base + '/tools/shigodeki-sensei/checkout.html')
                mobile.locator('#coupon').fill(env['SHIGODEKI_COUPON_CODE'])
                mobile.locator('#apply-coupon').click()
                expect(mobile.locator('#registration')).to_be_visible()
                assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
                mobile.screenshot(path=str(OUTPUT / 'checkout-mobile.png'), full_page=True)
                mobile.locator('#buyer-email').fill(email)
                mobile.locator('#buyer-password').fill('a-new-password-for-attack')
                mobile.locator('#password-confirm').fill('a-new-password-for-attack')
                mobile.locator('#get-app').click()
                expect(mobile.locator('#register-error')).to_contain_text('登録済み')
                expect(mobile.locator('#complete')).not_to_be_visible()
                # Price/quote/checkout/state responses use no-store; copying an app URL gives no data.
                anonymous = other.request.get(base + '/api/shigodeki/state')
                assert anonymous.status == 401
                assert anonymous.headers.get('cache-control') == 'no-store'
                print('PASS: mobile layout, existing-account protection and URL-sharing denial', flush=True)

                # Same page on an unconfigured static host must not pretend to grant access.
                mobile.route('**/commerce-config.json', lambda route: route.fulfill(status=200, content_type='application/json', body='{"appOrigin":null}'))
                mobile.reload()
                expect(mobile.locator('#unavailable')).to_be_visible()
                expect(mobile.locator('#checkout')).not_to_be_visible()
                assert not mobile.locator('#buyer-email').is_visible()
                mobile.screenshot(path=str(OUTPUT / 'checkout-pending.png'), full_page=True)
                print('PASS: unconfigured static hosting does not collect credentials or claim completion', flush=True)
                assert not errors, errors
                browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
