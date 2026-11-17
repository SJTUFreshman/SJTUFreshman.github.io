'use strict';
// Real browser checks of every map hit, independent of the sky and article UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const maps = [['china', 'china'], ['east-asia', 'east_asia'], ['euro-usa', 'europe_usa']];
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webp':'image/webp'};
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/access-test.html') return res.writeHead(200, {'Content-Type':'text/html'}).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/life/styles/07-overlays-responsive.css"><link rel="stylesheet" href="assets/life/styles/12-region-explorer.css"><style>body{margin:16px;background:#f5f3ec}main{max-width:1100px;margin:auto}.map-box{position:relative;width:100%}.map-card{margin-bottom:32px}</style></head><body><main id="maps"></main><script>window.opened=[];window.footprintsRegions={open(value){window.opened.push({map:value.map,id:value.region.id,view:value.view,visited:value.region.visited})},updateLanguage(){}};</script><script src="assets/life/scripts/22-footprints-atlas.js"></script><script>footprintsAtlas.init({root:document.getElementById('maps'),language:'zh-CN'}).then(()=>window.ready=true);</script></body></html>`);
    const file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (path.relative(root, file).startsWith('..') || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
});
let checks = 0;
const check = (value, message) => {assert(value, message); checks++; console.log('PASS ' + message);};
async function selectView(scope, mode) {
    const select = scope.locator('[data-map-action="select-view"]');
    if (await select.count()) await select.selectOption(mode);
    else if (await scope.locator('.footprints-map-shell').first().getAttribute('data-map-view') !== mode)
        await scope.locator('[data-map-action="toggle-view"]').click();
}
async function allActivate(page, elements, message) {
    const result = await elements.evaluateAll(nodes => {
        window.opened=[];
        const expected=nodes.map(n=>{const item=n._region || n._footprintsCity.data;return {id:item.id,visited:item.visited};});
        for (const node of nodes) node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        return {expected,opened:window.opened,disabled:nodes.some(n=>n.getAttribute('aria-disabled')==='true')};
    });
    assert.deepEqual(result.opened.map(x=>({id:x.id,visited:x.visited})),result.expected,message);
    check(result.expected.length>0&&!result.disabled,message+' ('+result.expected.length+' regions; visited status preserved)');
    await elements.first().focus();
    await page.evaluate(()=>window.opened=[]);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>window.opened[0]?.id),result.expected[0].id,message+' native Space activation');
}
async function interior(locator) {
    return locator.evaluate(node=>{
        const shape=node.matches('path')?node:node.querySelector('path');
        const b=shape.getBBox(),ctm=shape.getScreenCTM();
        for (let y=1;y<25;y++)for(let x=1;x<25;x++) {
            const local=new DOMPoint(b.x+b.width*x/25,b.y+b.height*y/25);
            if(!shape.isPointInFill(local))continue;
            const p=local.matrixTransform(ctm),hit=document.elementFromPoint(p.x,p.y);
            if(hit===node||node.contains(hit))return {x:p.x,y:p.y};
        }
        return null;
    });
}
async function pointerOpensInset(page,elements,mobile,label) {
    for(let i=0;i<await elements.count();i++) {
        const element=elements.nth(i),point=await interior(element);
        if(!point)continue;
        const id=await element.getAttribute('data-region-id');
        await page.evaluate(()=>window.opened=[]);
        if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
        check(await page.evaluate(expected=>window.opened.length===1&&window.opened[0].id===expected,id),label+' owns its '+(mobile?'touch':'pointer')+' hit');
        return;
    }
    assert.fail(label+' has no reachable native pointer target');
}
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true});
    try {
        for (const mobile of [false,true]) {
            const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile});
            const page=await context.newPage();
            const errors=[];page.on('pageerror',e=>errors.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/access-test.html`);
            await page.waitForFunction(()=>window.ready);
            for(const[id,key]of maps) {
                const card=page.locator(`[data-atlas-card="${id}"]`);
                await card.scrollIntoViewIfNeeded();
                await card.locator('.footprints-preview-hits').waitFor();
                const hitData=read(`assets/maps/relief/${key}-hits.json`);
                for(const view of Object.keys(hitData.views)) {
                    await selectView(card,view);
                    const hits=card.locator(`[data-hit-view="${view}"] [data-region-id]`);
                    await allActivate(page,hits,`${mobile?'mobile':'desktop'} ${id} card ${view}`);
                }
                for(const inset of hitData.insets||[]) {
                    if(!inset.regions?.length)continue;
                    const hits=card.locator(`[data-inset-id="${inset.id}"] [data-region-id]`);
                    await allActivate(page,hits,`${id} card inset ${inset.id}`);
                    await pointerOpensInset(page,hits,mobile,`${id} card inset ${inset.id}`);
                }
                await selectView(card,Object.keys(hitData.views)[0]);
                const candidates=card.locator(`[data-hit-view="${Object.keys(hitData.views)[0]}"] [data-region-id]`);
                let tapped=false;
                for(let i=0;i<await candidates.count();i++) {
                    const candidate=candidates.nth(i);
                    if(await candidate.evaluate(n=>n._region.visited===true))continue;
                    const point=await interior(candidate);if(!point)continue;
                    await page.evaluate(()=>window.opened=[]);
                    if(mobile)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
                    check(await page.evaluate(()=>window.opened.length===1),'unvisited '+id+' opens by '+(mobile?'touch':'pointer'));
                    tapped=true;break;
                }
                check(tapped,id+' has an accessible unvisited pointer target');
                await card.locator('.footprints-map-open').click();
                const viewer=page.locator('.footprints-map-viewer[open]');
                await viewer.locator('[data-atlas-view]').first().waitFor({state:'attached'});
                for(const view of Object.keys(hitData.views)) {
                    await selectView(viewer,view);
                    await allActivate(page,viewer.locator(`[data-atlas-view="${view}"] .footprints-city`),`${mobile?'mobile':'desktop'} ${id} large ${view}`);
                }
                for(const inset of hitData.insets||[]) {
                    if(!inset.regions?.length)continue;
                    const hits=viewer.locator(`[data-inset-id="${inset.id}"] .footprints-city`);
                    await allActivate(page,hits,`${id} large inset ${inset.id}`);
                    await pointerOpensInset(page,hits,mobile,`${id} large inset ${inset.id}`);
                }
                await viewer.locator('.footprints-viewer-close').click();
            }
            check(errors.length===0,'no browser errors: '+errors.join('; '));
            await context.close();
        }
        console.log(`${checks} region access checks passed.`);
    } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
