"""Real-browser smoke test; needs Python Playwright and Chromium. No production data is used."""
import json
import math
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

with tempfile.TemporaryDirectory(prefix='shigodeki-browser-') as tmp:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = {**os.environ, 'PORT': str(port), 'HOST': '127.0.0.1', 'APP_ORIGIN': base,
           'SHIGODEKI_DATA_DIR': tmp, 'TEST_SEED_PATH': str(Path(tmp) / 'seed.json')}
    subprocess.run(['node', '--input-type=module', '-e', '''
      import {openStore,issueLicense} from './server/store.mjs';
      import {writeFileSync} from 'node:fs';
      import {randomBytes} from 'node:crypto';
      const db=openStore(process.env.SHIGODEKI_DATA_DIR+'/app.sqlite');
      writeFileSync(process.env.TEST_SEED_PATH,JSON.stringify({email:'browser-test@example.com',code:issueLicense(db,'browser-test@example.com'),password:randomBytes(24).toString('hex')}),{mode:0o600});
      db.close();
    '''], cwd=ROOT, env=env, check=True, capture_output=True)
    seed = json.loads(Path(env['TEST_SEED_PATH']).read_text())
    with (OUTPUT / 'browser-server.log').open('w') as log:
        entry = 'tests/supabase-dev-server.mjs' if os.environ.get('SHIGODEKI_TEST_BACKEND') == 'supabase' else 'server/index.mjs'
        server = subprocess.Popen(['node', entry], cwd=ROOT, env=env, stdout=log, stderr=log)
        try:
            for _ in range(60):
                try:
                    with urlopen(base + '/tools/shigodeki-sensei/app/', timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError('Test server did not start')
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
                context = browser.new_context(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: dialog.accept())
                page.goto(base + '/tools/shigodeki-sensei/app/')
                expect(page.locator('#auth-view')).to_be_visible()
                page.locator('#auth-toggle').click()
                page.locator('#email').fill(seed['email'])
                page.locator('#password').fill(seed['password'])
                page.locator('#license-code').fill(seed['code'])
                page.locator('#auth-submit').click()
                expect(page.locator('#settings-dialog')).to_be_visible()
                page.locator('#owner').fill('テスト先生の週案')
                page.locator('#year').fill('2026')
                page.locator('#year').dispatch_event('change')
                for name in ['2年3組 国語', '1年1組 国語']:
                    page.locator('#add-lesson').click()
                    page.locator('[data-lesson-name]').last.fill(name)
                page.locator('#template-from').fill('2026-04-01')
                page.locator('#template-from').dispatch_event('change')
                for day in range(5):
                    page.locator(f'[data-template="{day}:1"]').select_option(label='2年3組 国語' if day < 3 else '1年1組 国語')
                page.locator('#settings-form button[type=submit]').click()
                expect(page.locator('#settings-dialog')).not_to_be_visible()
                expect(page.locator('#save-status')).to_have_text('保存済み')
                page.locator('#jump-date').fill('2026-04-06')
                page.locator('#jump-date').dispatch_event('change')
                a = page.locator('.count-card').filter(has_text='2年3組 国語')
                expect(a.locator('[data-count=week]')).to_have_text('3時間')
                print('PASS: purchaser registration and personal timetable', flush=True)

                page.locator('[data-date="2026-04-06"][data-period="1"]').click()
                page.locator('#slot-status').select_option('cancelled')
                page.locator('#slot-form button[type=submit]').click()
                expect(a.locator('[data-count=week]')).to_have_text('2時間')
                page.locator('[data-date="2026-04-07"][data-period="1"]').click()
                page.locator('#slot-status').select_option('done')
                page.locator('#slot-note').fill('物語の構成を考える。次回は視点の違い。')
                page.locator('#slot-form button[type=submit]').click()
                expect(a.locator('[data-count=done]')).to_have_text('1時間')
                page.locator('[data-date="2026-04-08"][data-period="1"]').click()
                page.locator('#slot-dialog summary').click()
                page.locator('#swap-date').fill('2026-04-13')
                page.locator('#swap-period').select_option('2')
                page.locator('#swap-button').click()
                expect(a.locator('[data-count=week]')).to_have_text('1時間')
                page.locator('#next-week').click()
                expect(a.locator('[data-count=week]')).to_have_text('4時間')
                page.locator('#prev-week').click()
                print('PASS: cancellations, completed totals and cross-week transfers', flush=True)

                page.locator('[data-mode=pen]').click()
                canvas = page.locator('#ink-canvas')
                canvas.scroll_into_view_if_needed()
                box = canvas.bounding_box()
                # Draw through actual pointer events, on the memo area below the timetable.
                start_x = box['x'] + box['width'] * .15
                start_y = box['y'] + box['height'] * .87
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                for i in range(30):
                    page.mouse.move(start_x + i * 4, start_y + math.sin(i / 3) * 13)
                page.mouse.up()
                expect(page.locator('#undo')).to_be_enabled()
                expect(page.locator('#save-status')).to_have_text('保存済み')
                saved = page.request.get(base + '/api/shigodeki/state').json()
                assert len(saved['state']['ink']['2026-04-06']) == 1
                assert len(saved['state']['ink']['2026-04-06'][0]['points']) > 10

                # Chromium's pen pointer path includes variable pressure; the eraser removes a whole stroke.
                cdp = context.new_cdp_session(page)
                pen_x, pen_y = start_x + 240, start_y
                cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': pen_x, 'y': pen_y, 'button': 'left', 'buttons': 1, 'clickCount': 1, 'pointerType': 'pen', 'force': .2})
                cdp.send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': pen_x + 45, 'y': pen_y + 10, 'buttons': 1, 'pointerType': 'pen', 'force': .8})
                cdp.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': pen_x + 45, 'y': pen_y + 10, 'button': 'left', 'buttons': 0, 'clickCount': 1, 'pointerType': 'pen'})
                expect(page.locator('#save-status')).to_have_text('保存済み')
                strokes = page.request.get(base + '/api/shigodeki/state').json()['state']['ink']['2026-04-06']
                assert len(strokes) == 2
                assert max(point[2] for point in strokes[-1]['points']) > .7
                assert min(point[2] for point in strokes[-1]['points']) < .3
                page.locator('[data-mode=eraser]').click()
                canvas.scroll_into_view_if_needed()
                # Recompute after toolbar scrolling.
                eraser_box = canvas.bounding_box()
                point = strokes[-1]['points'][0]
                page.mouse.click(eraser_box['x'] + point[0] / 1200 * eraser_box['width'], eraser_box['y'] + point[1] / 920 * eraser_box['height'])
                expect(page.locator('#save-status')).to_have_text('保存済み')
                assert len(page.request.get(base + '/api/shigodeki/state').json()['state']['ink']['2026-04-06']) == 1
                page.locator('#undo').click()
                expect(page.locator('#redo')).to_be_enabled()
                page.locator('#redo').click()
                expect(page.locator('#save-status')).to_have_text('保存済み')
                page.locator('[data-mode=edit]').click()
                page.reload()
                expect(page.locator('#app-view')).to_be_visible()
                page.locator('#jump-date').fill('2026-04-06')
                page.locator('#jump-date').dispatch_event('change')
                assert page.evaluate("document.getElementById('ink-canvas').getContext('2d').getImageData(0,0,1200,920).data.some((v,i)=>i%4===3 && v>0)")
                expect(page.locator('[data-date="2026-04-07"][data-period="1"]')).to_contain_text('物語の構成')
                print('PASS: pen pressure, stroke eraser, undo/redo, server persistence and reload', flush=True)

                context.set_offline(True)
                page.locator('#week-note').fill('オフラインで書いたふりかえり')
                expect(page.locator('#save-status')).to_have_text('未同期の変更あり', timeout=10000)
                context.set_offline(False)
                expect(page.locator('#save-status')).to_have_text('保存済み', timeout=10000)
                assert page.request.get(base + '/api/shigodeki/state').json()['state']['notes']['2026-04-06'] == 'オフラインで書いたふりかえり'
                print('PASS: offline local draft and reconnect synchronization', flush=True)

                # Export and restore the real notebook; the previous copy is exported before replacement.
                with page.expect_download() as exported:
                    page.locator('#backup').click()
                backup_path = Path(tmp) / 'notebook-backup.json'
                exported.value.save_as(backup_path)
                page.locator('#week-note').fill('バックアップ後の変更')
                expect(page.locator('#save-status')).to_have_text('保存済み')
                with page.expect_download() as before_restore:
                    page.locator('#restore-file').set_input_files(backup_path)
                before_restore.value.save_as(Path(tmp) / 'before-restore.json')
                expect(page.locator('#notice')).to_have_text('バックアップから復元しました。')
                expect(page.locator('#week-note')).to_have_value('オフラインで書いたふりかえり')
                assert json.loads((Path(tmp) / 'before-restore.json').read_text())['state']['notes']['2026-04-06'] == 'バックアップ後の変更'
                print('PASS: backup export and validated restoration with pre-restore backup', flush=True)

                # A stale second tab must not overwrite a newer notebook.
                stale = context.new_page()
                stale.on('dialog', lambda dialog: dialog.accept())
                stale.goto(base + '/tools/shigodeki-sensei/app/')
                expect(stale.locator('#app-view')).to_be_visible()
                page.locator('#week-note').fill('先に保存された記録')
                expect(page.locator('#save-status')).to_have_text('保存済み')
                stale.locator('#week-note').fill('競合した端末の記録')
                expect(stale.locator('#notice')).to_contain_text('別の画面の変更')
                stale.reload()
                expect(stale.locator('#recovery')).to_be_visible()
                with stale.expect_download() as recovered:
                    stale.locator('#recovery-download').click()
                recovered.value.save_as(Path(tmp) / 'conflict-backup.json')
                assert '競合した端末の記録' in (Path(tmp) / 'conflict-backup.json').read_text()
                stale.locator('#recovery-server').click()
                expect(stale.locator('#recovery')).not_to_be_visible()
                assert '先に保存された記録' in json.dumps(stale.request.get(base + '/api/shigodeki/state').json(), ensure_ascii=False)
                stale.close()
                print('PASS: stale-tab conflict never overwrites a newer notebook; recovery preserves drafts', flush=True)

                page.evaluate('navigator.serviceWorker.ready')
                assert page.evaluate('navigator.serviceWorker.controller !== null')
                cached = page.evaluate('(async()=>{const names=await caches.keys();return (await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>r.url)))).flat()})()')
                assert not any('/api/' in url for url in cached)
                assert any('icon-512.png' in url for url in cached)
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(OUTPUT / 'notebook-desktop.png'), full_page=True)
                page.set_viewport_size({'width': 1024, 'height': 1366})
                page.screenshot(path=str(OUTPUT / 'notebook-tablet.png'), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(OUTPUT / 'notebook-mobile.png'), full_page=True)
                print('PASS: PWA shell caching and tablet/mobile layout', flush=True)

                # A new browser login invalidates the previous session.
                other = browser.new_context()
                login = other.request.post(base + '/api/shigodeki/login', headers={'Origin': base}, data={'email': seed['email'], 'password': seed['password']})
                assert login.status == 200
                assert page.request.get(base + '/api/shigodeki/state').status == 401
                page.locator('#week-note').fill('失効後の変更は送信されない')
                expect(page.locator('#auth-view')).to_be_visible(timeout=10000)
                assert '失効後の変更' not in json.dumps(other.request.get(base + '/api/shigodeki/state').json(), ensure_ascii=False)
                assert not errors, errors
                other.close()
                browser.close()
                print('PASS: second-device session invalidation; no browser exceptions', flush=True)
        finally:
            server.terminate()
            server.wait(timeout=10)
