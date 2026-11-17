'use strict';
// Real settlement data, flat SVGs and rendered WebGL pixels; no fixture geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {serve} = require('./validate-admin-explorer.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const ROOT = path.resolve(__dirname,'..');
const OUT = path.join(ROOT,'.render-work/settlement-validation');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
let checks=0;
const check=(condition,label)=>{assert(condition,label);checks++;console.log('PASS '+label);};
async function open(page,options) {
    await page.evaluate(value=>window.footprintsRegions.open({...value,language:'zh-CN'}),options);
    const dialog=page.locator('.region-explorer[open]');
    await dialog.locator('.region-landscape-svg').waitFor();
    return dialog;
}
async function pixelsChanged(page,on,off) {
    return page.evaluate(async([a,b])=>{
        const pixels=async src=>{const image=new Image();image.src='data:image/png;base64,'+src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);return {data:c.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};};
        const [first,second]=await Promise.all([pixels(a),pixels(b)]);
        if(first.width!==second.width||first.height!==second.height)throw new Error('Canvas capture changed size');
        let changed=0;
        for(let y=5;y<first.height-5;y++)for(let x=5;x<first.width-5;x++){
            const i=(y*first.width+x)*4;
            if(Math.max(...[0,1,2].map(c=>Math.abs(first.data[i+c]-second.data[i+c])))>8)changed++;
        }
        return changed;
    },[on.toString('base64'),off.toString('base64')]);
}
async function toggleCheck(page,panel,device,view) {
    const layer=panel.locator('.settlement-layer');
    const toggle=panel.locator('.settlement-switch').first();
    check(await layer.locator('path').count()>0,`${device} ${view} contains real built-up polygons`);
    check(await toggle.isEnabled(),`${device} ${view} built-up layer available`);
    await toggle.click();
    check(await layer.evaluate(el=>getComputedStyle(el).display==='none'),`${device} ${view} flat layer can hide`);
    await toggle.click();
    check(await layer.evaluate(el=>getComputedStyle(el).display!=='none'),`${device} ${view} flat layer can return`);
    await panel.locator('.admin-model-toggle').click();
    const canvas=panel.locator('.admin-terrain-canvas');
    await canvas.waitFor();
    await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.vertices,
        `[data-admin-view="${view}"] .admin-terrain-canvas`);
    await canvas.scrollIntoViewIfNeeded();
    const on=await canvas.screenshot({path:path.join(OUT,`${device}-${view}-built-up.png`)});
    await toggle.click();
    const off=await canvas.screenshot({path:path.join(OUT,`${device}-${view}-terrain-only.png`)});
    check(await pixelsChanged(page,on,off)>50,`${device} ${view} toggle changes actual 3D surface pixels`);
    await toggle.click();
    await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');
    const rotatedOn=await canvas.screenshot({path:path.join(OUT,`${device}-${view}-rotated.png`)});
    await toggle.click();
    const rotatedOff=await canvas.screenshot();
    check(await pixelsChanged(page,rotatedOn,rotatedOff)>50,`${device} ${view} built-up layer follows rotated terrain`);
    await toggle.click();
    await panel.locator('.admin-model-toggle').click();
    check(await panel.locator('.admin-terrain-canvas').count()===0,`${device} ${view} returns to flat guide`);
    check(await layer.evaluate(el=>getComputedStyle(el).display!=='none'),`${device} ${view} flat overlay remains enabled after 3D`);
}
async function test(browser,url,mobile) {
    const device=mobile?'mobile':'desktop';
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(30000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try {
        await page.goto(url,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.footprintsRegions);
        const dialog=await open(page,{map:'china',view:'cultural',region:{id:'CHN:yanzhao'}});
        const title=await dialog.locator('.region-explorer-title').textContent();
        check(await dialog.locator('.settlement-layer path').count()>0,device+' cultural region shows built-up extent');
        const markers=dialog.locator('.region-visited-city');
        const manifest=read('assets/maps/settlements/manifest.json');
        const data=read(manifest.regions['CHN:yanzhao'].file||manifest.regions['CHN:yanzhao']);
        assert.deepEqual((await markers.evaluateAll(nodes=>nodes.map(n=>n.dataset.unit))).sort(),data.visitedCities.map(c=>c.unitId||c.id).sort());
        check(await markers.count()>0,device+' visited-city markers match the route data');
        check(/边界|邊界|概略|精度|分辨率/.test(await dialog.locator('.settlement-explanation').textContent()),device+' extent precision is explained');
        check(await dialog.locator('.settlement-explanation a[href]').count()>0,device+' settlement source is linked');
        const visits=dialog.locator('.settlement-visits-key');
        await visits.click();
        check(await dialog.locator('.region-visited-cities').evaluate(el=>getComputedStyle(el).display==='none'),device+' visited-city markers can hide');
        await visits.click();
        const beijing=dialog.locator('.region-visited-city[data-unit="110000"]');
        await beijing.focus();await page.keyboard.press('Enter');
        await dialog.locator('.admin-explorer-layout').waitFor();
        check(await dialog.locator('[data-admin-view]').count()===2,device+' visited marker opens the two-view administrative guide');
        for(const view of ['whole','urban']) await toggleCheck(page,dialog.locator(`[data-admin-view="${view}"]`),device,view);
        check(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),device+' guide has no horizontal overflow');
        await dialog.locator('.region-explorer-close').click();
        await dialog.locator('.region-landscape-svg').waitFor();
        check(await dialog.locator('.region-explorer-title').textContent()===title,device+' administrative return restores cultural overview');
        check(await dialog.locator('.region-visited-city[data-unit="110000"]').count()===1,device+' return preserves visited markers');
        await dialog.locator('.region-explorer-close').click();
        await open(page,{map:'china',view:'cultural',region:{id:'CHN:yanzhao'}});
        check(await dialog.locator('.settlement-layer path').count()>0,device+' reopen restores extent layer');
        await dialog.locator('.region-explorer-close').click();
        if(!process.argv.includes('--china-only')) {
            const registry=read('assets/maps/regions/manifest.json').regions;
            const foreign=Object.entries(registry).find(([key,value])=>key.startsWith('east_asia:overview:')&&(()=>{const doc=read('assets/maps/regions/'+(typeof value==='string'?value:value.file));return doc.subregions?.some(unit=>unit.explore);})());
            assert(foreign,'Published foreign cultural guide with a related-region drilldown is required');
            const id=foreign[0].slice('east_asia:overview:'.length);
            const parent=read('assets/maps/regions/'+(typeof foreign[1]==='string'?foreign[1]:foreign[1].file));
            const child=parent.subregions.find(unit=>unit.explore);
            await open(page,{map:'east-asia',view:'overview',region:{id}});
            const foreignTitle=await dialog.locator('.region-explorer-title').textContent();
            const parentMap=await dialog.locator('.region-landscape-svg').elementHandle();
            await dialog.locator(`.region-district-tabs button[data-unit="${child.id}"]`).click();
            await page.waitForFunction(element=>!element.isConnected,parentMap);
            await dialog.locator('.region-landscape-svg').waitFor();
            check(await dialog.locator('.region-load-retry').count()===0,device+' foreign district loads a related guide');
            await dialog.locator('.region-explorer-close').click();
            await dialog.locator('.region-landscape-svg').waitFor();
            check(await dialog.locator('.region-explorer-title').textContent()===foreignTitle,device+' foreign child returns to the same regional overview');
            await dialog.locator('.region-explorer-close').click();
        }
        check(errors.length===0,device+' no browser errors: '+errors.join('; '));
    } finally {await context.close();}
}
(async()=>{
    fs.mkdirSync(OUT,{recursive:true});
    assert(fs.existsSync(path.join(ROOT,'assets/maps/settlements/manifest.json')),'Generate the published settlement datasets first');
    const {server,url}=await serve();
    const browser=await chromium.launch({headless:true});
    try {await test(browser,url,false);await test(browser,url,true);console.log(`${checks} settlement UI checks passed.`);}
    finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
