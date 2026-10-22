// Run against a local dev server on 127.0.0.1:3100. All external requests are mocked or blocked.
// npm install --no-save playwright && npx playwright install chromium (in an authorized environment).
const { chromium } = require('playwright');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {})}); const page=await browser.newPage({viewport:{width:1280,height:900}}); const calls=[]; const failures=[];page.on('pageerror',e=>failures.push(e.message));
await page.route('**/*', async route=>{
 const url=route.request().url(); if(url.startsWith('http://127.0.0.1:3100')) return route.continue();
 const fn=url.split('/').pop(); let data={}; try { data=route.request().postDataJSON()?.data || {}; } catch {}
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
 if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
 let result;
 if(fn==='space_getPublishedCatalog')result={setups:[{id:'test-room',name:'Workshop layout',serviceType:'CONFERENCE',resourceId:'mode-conference',capacity:10,description:'Published test setup',arrangement:'Boardroom',addOnIds:['projector'],layoutPath:'locations/test/floors/test/layouts/test',published:true}],addOns:[{id:'projector',name:'Projector',priceCents:2500,serviceTypes:['CONFERENCE'],published:true}]};
 if(fn==='booking_getDaySchedule')result={date:data.date,timeZone:'America/New_York',isOpen:true,intervals:[{startTime:'08:00',endTime:'20:00'}],hasException:false};
 if(fn==='booking_getAvailability')result={start:data.start,end:data.end,options:[{resourceId:'mode-conference',name:'Conference room',type:'MODE',available:true}],deskChangeOptions:[]};
 if(fn==='booking_createQuote'){calls.push(data);const addon=data.addOnIds?.includes('projector');result={resourceId:'mode-conference',resourceName:'Conference room',resourceType:'MODE',bookingKind:'single',durationHours:2,membershipName:null,includedHoursRemaining:0,includedHoursApplied:0,billableHours:2,hourlyRateCents:5000,subtotalCents:10000+(addon?2500:0),spaceSubtotalCents:10000,accountCreditAvailableCents:0,accountCreditAppliedCents:0,totalCents:10000+(addon?2500:0),dailyCapApplied:false,currency:'USD',setup:{id:'test-room',name:'Workshop layout',capacity:10},attendeeCount:data.attendeeCount||1,addOns:addon?[{id:'projector',name:'Projector',priceCents:2500}]:[],addOnTotalCents:addon?2500:0};}
 if(result)return route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({result})});
 return route.abort();
});
await page.goto('http://127.0.0.1:3100/book');
await page.getByRole('button',{name:/Meeting room Check/}).click();
await page.getByLabel('Published setup (optional)').selectOption('test-room');
await page.getByRole('button',{name:'Check meeting room',exact:true}).click();
await page.getByRole('checkbox').check();
await page.getByText('$125.00 due').waitFor();
await page.getByRole('button',{name:'Review booking',exact:true}).click();
await page.getByRole('button',{name:'Pay $125.00',exact:true}).waitFor();
await page.screenshot({path:'/tmp/catalog-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/catalog-mobile.png',fullPage:true});
if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw Error('Horizontal overflow');
console.log(JSON.stringify({quoteCalls:calls,failures,screenshots:['/tmp/catalog-desktop.png','/tmp/catalog-mobile.png']}));
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
