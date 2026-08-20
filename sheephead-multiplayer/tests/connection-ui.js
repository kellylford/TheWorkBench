/* The connection, as the player experiences it during a game.
 *
 * What happened at a live table: a seat's socket closed, and the player was told
 * exactly once — into a live region that then held nothing — while the board
 * went on drawing a hand that had stopped being true. There was no standing
 * indication anywhere and no way back short of reloading and retyping a code
 * that was no longer on screen.
 *
 * The cause was structural rather than subtle. Connection state was written only
 * to the lobby's status line, and the lobby is hidden the moment the first hand
 * is dealt. ui.js even said the seat list carried the standing version "for
 * anyone who wants to check" — and the seat list is in the lobby too. So during
 * play there was no standing version of anything.
 *
 * js/net.js opens by saying that silence is the failure a screen reader user
 * cannot diagnose. This is that guarantee, asserted at the level the player
 * meets it.
 *
 * Requires jsdom:  npm install --no-save jsdom
 */
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('SKIP: jsdom is not installed. Run: npm install --no-save jsdom');
  process.exit(0);
}

const root = path.join(__dirname, '..');
(async () => {
const dom=await JSDOM.fromFile(path.join(root,'index.html'),{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,
  beforeParse(w){const s={};Object.defineProperty(w,'localStorage',{configurable:true,value:{getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{delete s[k];},clear:()=>{},key:i=>Object.keys(s)[i]||null,get length(){return Object.keys(s).length;}}});}});
const {window}=dom,d=window.document;
await new Promise(r=>{if(d.readyState==='complete')r();else window.addEventListener('load',r);});
['rules-dialog','a11y-dialog','export-dialog','bug-dialog','settings-dialog'].forEach(id=>{const g=d.getElementById(id);if(g&&typeof g.showModal!=='function'){g.showModal=()=>{g.open=true;};g.close=()=>{g.open=false;};}});

const line=d.getElementById('net-line'), acts=d.getElementById('net-actions'), btn=d.getElementById('net-reconnect');
const fails=[];
const check=(c,m)=>{if(!c)fails.push(m);};
check(!!line,'no net-line element'); check(!!acts,'no net-actions'); check(!!btn,'no reconnect button');
check(line.getAttribute('role')==='status','the connection line is not a status region, so it is never spoken');
check(line.hidden,'the connection notice is showing before anything went wrong');
check(acts.hidden,'a reconnect button is offered before anything went wrong');

// Drive the real status handler the way net.js does.
let statusFn=null;
window.SH.Net.connect = function(opts, onMessage, onStatus){ statusFn=onStatus; return {send(){},close(){}}; };
d.getElementById('opt-name').value='Kelly';
d.getElementById('setup-online').click();
d.getElementById('lobby-code').value='V7KY8';
d.getElementById('lobby-join-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
check(typeof statusFn==='function','joining never installed a status handler');

if (statusFn) {
  statusFn({state:'lost', detail:'the connection closed'});
  check(!line.hidden,'the connection was lost and the game screen said nothing that stays on screen');
  check(/lost/i.test(line.textContent),'the standing notice does not say the connection was lost: '+line.textContent);
  check(!/\. [a-z]/.test(line.textContent),'two sentences run together with a lower case start: '+line.textContent);
  check(!acts.hidden,'no way back was offered after the connection was lost');
  check(/reconnect/i.test(btn.textContent),'the button does not offer to reconnect: '+btn.textContent);

  statusFn({state:'connected'});
  check(line.hidden,'the lost-connection notice stayed up after reconnecting');
  check(acts.hidden,'the reconnect button stayed up after reconnecting');
}
window.close();
if (fails.length) {
  console.error('FAILED:');
  [...new Set(fails)].forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('a lost connection stays on screen during play, and offers a way back');
})();
