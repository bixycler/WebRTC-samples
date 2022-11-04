


/////////////////////// JS untils \\\\\\\\\\\\\\\\\\\\\\\

/** Simulate sleep(ms) using setTimeout() */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Auto-init getter of dict[] */
function idict(dict, key, init){
  if(!(key in dict)){ dict[key] = init; }
  return dict[key];
}

/** Check equality of sets */
function eqSets(s1, s2){
  if(s1.size != s2.size){return false}
  return [...s1].every(ele => s2.has(ele));
}

/////////////////////// String untils \\\\\\\\\\\\\\\\\\\\\\\

/** Simple hash from string, like in Java */
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

/** Compress the string using compression `format` and optionally convert to `base64` */
async function deflateStr(s, base64 = false, format = 'gzip'){
  const ss = new Blob([s]).stream().pipeThrough(new CompressionStream(format)); //stream of deflated string
  const sb = await new Response(ss).arrayBuffer().then(b => new Uint8Array(b)); //deflated byte array
  return base64? btoa(String.fromCharCode.apply(null,sb)): sb;
}

/** Decompress the input `sb` (a base64 string or a byte array) using compression `format` */
async function inflateStr(sb, format = 'gzip'){
  if(!(sb instanceof Uint8Array || typeof sb == 'string')){ 
    throw new TypeError('Parameter sb is not an instance of Uint8Array nor a string.');}
  if(typeof sb == 'string'){ sb = Uint8Array.from(atob(sb), c => c.charCodeAt(0));}
  const ss = new Blob([sb]).stream().pipeThrough(new DecompressionStream(format)); //stream of inflated sb
  const s = await new Response(ss).text(); //inflated string
  return s;
}

/** Compute the diff between 2 strings */
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


/////////////////////// Clipboard untils \\\\\\\\\\\\\\\\\\\\\\\

/** Compute the diff between current clipboard and the given text */
async function diffClipboard(str) {
  let s = await navigator.clipboard.readText();
  return strDiff(s, str);
}

/** Copy the given text `txt.value` into clipboard with optional deflation */
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

/** Paste the clipboard into `txt.value` optional inflation */
async function pasteFromClipboard(txt, deflated=false) {
  let txtval = await navigator.clipboard.readText();
  txt.value = deflated? await inflateStr(txtval): txtval;
}


/** Request the media stream with fallback: getUserMedia() > getDisplayMedia() */
async function getLocalStream(fallBackOnNotAllowed=true){
  let stream = null;
  console.log('Requesting local stream (user media or screen capture) ...');
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
  } catch (e) {
    if(errFallBack(e,fallBackOnNotAllowed)){
      try {
        stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      } catch (e) {
        if(errFallBack(e,fallBackOnNotAllowed)){
          try {
            stream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
          } catch (e) {
            if(errFallBack(e,fallBackOnNotAllowed)){
              try {
                stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
              } catch (e) {
                handleError('getDisplayMedia(video[,audio]):', e);
                return null;
              }
            }else{
              handleError('getUserMedia(audio):', e);
              return null;
            }
          }
        }else{
          handleError('getUserMedia(video):', e);
          return null;
        }
      }
    }else{
      handleError('getUserMedia(video,audio):', e);
      return null;
    }
  }
  return stream;
}
function errFallBack(e, fallBackOnNotAllowed){
  return (e.name=='NotFoundError' || e.name=='NotReadableError'
  || (fallBackOnNotAllowed && e.name=='NotAllowedError'));
}

/////////////////////// DOM untils \\\\\\\\\\\\\\\\\\\\\\\

/** Automatically shrink and expand the height of a `dom` to its content, using `dom.scrollHeight` */
function updateHeight(dom, max){
  dom.style.height = 0; // shrink (reset)
  let h = dom.scrollHeight;
  if(h > max){ h = max; }
  dom.style.height = h + "px"; // expand
  dom.scrollTop = dom.scrollHeight; // scroll to bottom
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
