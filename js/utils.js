var stdRSACertificate = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256"
};

String.prototype.hashCode = function(hex=false) {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    //hash  = 31*hash + this.charCodeAt(i);
    hash  = Math.imul(31, hash) + this.charCodeAt(i);
  }
  hash = hash>>>0; // Convert to unsigned (32-bit) integer
  if(hex){ hash = hash.toString(16); }
  return hash;
};

async function getLocalStream(fallBackOnNotAllowed=true){
  let stream = null;
  console.log('Requesting local stream (user media or screen capture) ...');
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
  } catch (e) {
    if(e.name=='NotFoundError' || e.name=='NotReadableError'
      || (fallBackOnNotAllowed && e.name=='NotAllowedError')){
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({audio: true, video: true});
      } catch (e) {
        handleError('getDisplayMedia():', e);
        return null;
      }
    }else{
      handleError('getUserMedia():', e);
      return null;
    }
  }
  return stream;
}

function strDiff(str1, str2){
  // normalize strings
  if(!str1){ str1 = ''; }
  if(!str2){ str2 = ''; }
  str1 = str1.replace(/\r\n/g,'\n');
  str2 = str2.replace(/\r\n/g,'\n');
  // find diff
  let ds1 = '', ds2 = '', di = -1, oi = -1, c1 = '', c2 = '';
  for(let i=0; i<Math.max(str1.length,str2.length); i++){
    c1 = i<str1.length? str1.charAt(i): '';
    c2 = i<str2.length? str2.charAt(i): '';
    if(c1 != c2){
      ds1 += c1;
      ds2 += c2;
      if(di < 0){ di = i; }
      if(oi < 0 || oi + 1 == i){ oi = i; }else{break;}
    }
  }
  let res = {di, ds1, ds2};
  if(!ds1){ return null; }
  else{ 
    //console.log('strDiff(',{str1,str2},'): ',res); 
    return res;
  }
}

async function diffClipboard(str) {
  let s = await navigator.clipboard.readText();
  return strDiff(s, str);
}

async function copyToClipboard(txt, deflate=false) {
  let txtval = deflate? await deflateStr(txt.value, base64=true): txt.value;
  await navigator.clipboard.writeText(txtval);
  let diff = await diffClipboard(txtval);
  if(diff){
    handleError(`copyToClipboard(${txt.id}${deflate?', deflate':''}):`, `Mismatch result: clipboard[${diff.di}..] = "${diff.ds1}" <> "${diff.ds2}"`);
    return false;
  }
  console.log(`copyToClipboard(${txt.id}): done${deflate?' (deflated)':''}.`);
  return true;
}

async function pasteFromClipboard(txt, deflated=false) {
  let txtval = await navigator.clipboard.readText();
  txt.value = deflated? await inflateStr(txtval): txtval;
}

async function updateTooltip(but, txt, tip, deflated=false){
  if(but.disabled){ return; }
  try{
    let diff = await diffClipboard(deflated? await deflateStr(txt.value, base64=true): txt.value);
    but.title = diff? 'click me!': tip;
    //console.log(`updateTooltip(${but.id}): ${but.title}`);
  }catch(e){
    if(e instanceof DOMException && e.name=='NotAllowedError'){
      but.title = 'click me!';
    }else{ throw e; }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*** Detect HTMLTextAreaElement.value change:
  onchange: completely useless; oninput: cannot detect 'value' assignment; MutationObserver: cannot observe 'value'
  ==> Use Object.defineProperty to hook oninput to the 'value' setter
  <= Reason: textarea only has 'value' property but no 'value' attribute! [https://stackoverflow.com/a/47835796]
***/
let DOMValueDsc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
const DOMValueSet = DOMValueDsc.set;
DOMValueDsc.set = function(val){
  DOMValueSet.apply(this, [val]);
  //console.log(`${this.id}.set:`,{val});
  this.dispatchEvent(new Event('input'));
  this.dispatchEvent(new Event('change'));
}
Object.defineProperty(HTMLTextAreaElement.prototype, 'value', DOMValueDsc);
/* Nope!!!
const DOMSetAttrSet = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(attr,val){
  DOMSetAttrSet.apply(this, [attr,val]);
  if(! this instanceof HTMLTextAreaElement){return}
  console.log(`${this.id}.set:`,{attr,val});
  this.dispatchEvent(new Event('input'));
}
*/


function candstr(cand, useFoundation=false){
  let protocol = 'protocol' in cand? cand.protocol.toUpperCase(): '';
  let type = 'candidateType' in cand? cand.candidateType: 'type' in cand? cand.type: '';
  let address = useFoundation? ('foundation' in cand? cand.foundation: ''): 
    (type!='prflx' && 'address' in cand)? cand.address: ''; // peer-reflexive (prflx) IP is redacted anyway!
  let port = 'port' in cand? cand.port: '';
  return `${protocol} ${type} ${address}:${port}`;
}

function updateHeight(dom, max){
  dom.style.height = 0; // shrink (reset)
  let h = dom.scrollHeight;
  if(h > max){ h = max; }
  dom.style.height = h + "px"; // expand
  dom.scrollTop = dom.scrollHeight; // scroll to bottom
}

async function deflateStr(s, base64 = false, format = 'gzip'){
  const ss = new Blob([s]).stream().pipeThrough(new CompressionStream(format)); //stream of deflated string
  const sb = await new Response(ss).arrayBuffer().then(b => new Uint8Array(b)); //deflated byte array
  return base64? btoa(String.fromCharCode.apply(null,sb)): sb;
}

async function inflateStr(sb, format = 'gzip'){
  if(!(sb instanceof Uint8Array || typeof sb == 'string')){ 
    throw new TypeError('Parameter sb is not an instance of Uint8Array nor a string.');}
  if(typeof sb == 'string'){ sb = Uint8Array.from(atob(sb), c => c.charCodeAt(0));}
  const ss = new Blob([sb]).stream().pipeThrough(new DecompressionStream(format)); //stream of inflated sb
  const s = await new Response(ss).text(); //inflated string
  return s;
}
