import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Captures the production renderer. Start the Vite dev server on port 4173 first.
const output = resolve(process.argv[2] ?? 'artifacts/animation-examples');
await mkdir(output, {recursive: true});
const browser = await chromium.launch({args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
const examples = [
  {id: '01-armies', label: 'Army arrival and casualties', buttons: ['ARMY ARRIVAL', 'DEFENDER LOSS'], durations: [1400, 2200]},
  {id: '02-decisions', label: 'Decision feedback', buttons: ['DECISION PREVIEW'], durations: [1700]},
  {id: '03-faction-power', label: 'Faction power', buttons: ['POWER'], durations: [1500]},
  {id: '04-legacy', label: 'Permanent legacy marking', buttons: ['WORLD NAME'], durations: [2400]},
  {id: '05-elimination', label: 'Player elimination', buttons: ['ELIMINATION'], durations: [2200]},
  {id: '06-envelope', label: 'Sealed envelope reveal', buttons: ['MODULE'], durations: [2800]},
];
try {
  for (const example of examples) {
    const context = await browser.newContext({viewport: {width: 1100, height: 760}, deviceScaleFactor: 1});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.clock.resume();
    await page.goto('http://127.0.0.1:4173/?table-demo=1&showcase=1&animation-showcase=1');
    await page.waitForFunction(() => document.querySelector('.game-table')?.dataset.presentationStatus === 'idle');
    await page.getByRole('button', {name: 'READY ARMIES', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.game-table')?.dataset.presentationStatus === 'idle');
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 3000));
    await page.addStyleTag({content: 'main > div.absolute.bottom-4 { opacity: 0; pointer-events: none; } [role=tooltip] { visibility: hidden; }'});
    await page.mouse.move(0, 0);
    const directory = join(output, example.id);
    await mkdir(directory, {recursive: true});
    let frame = 0;
    const screenshot = async () => page.screenshot({path: join(directory, `${String(frame++).padStart(4, '0')}.png`)});
    await screenshot();
    for (let index = 0; index < example.buttons.length; index++) {
      await page.getByRole('button', {name: example.buttons[index], exact: true}).dispatchEvent('click');
      for (let time = 0; time < example.durations[index]; time += 50) {
        await page.clock.runFor(50);
        await screenshot();
      }
    }
    for (let beat = 0; beat < 8; beat++) await page.clock.fastForward(1000);
    const health = await page.evaluate(() => globalThis.__riskTableDiagnostics.capture());
    if (errors.length || health.contextLosses || health.activeParticles) throw new Error(JSON.stringify({example: example.id, errors, health}));
    const encoded = spawnSync('python', [resolve('scripts/encode-animation-gif.py'), directory, join(output, `${example.id}.gif`)], {encoding: 'utf8'});
    if (encoded.status !== 0) throw new Error(encoded.stderr);
    console.log(`${example.label}: ${join(output, `${example.id}.gif`)} (${frame} real frames)`);
    await context.close();
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({source: 'Production Pixi renderer captured with Playwright at 20 fps', examples}, null, 2));
} finally {
  await browser.close();
}
