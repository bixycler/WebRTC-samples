/** The standard certificate for peer connection */
var stdRSACertificate = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256"
};


/////////////////////// String untils \\\\\\\\\\\\\\\\\\\\\\\

/** Compute an eye-easy string of candidate from `cand` */
function candstr(cand, useFoundation=false){
  let protocol = 'protocol' in cand? cand.protocol.toUpperCase(): '';
  let type = 'candidateType' in cand? cand.candidateType: 'type' in cand? cand.type: '';
  let address = useFoundation? ('foundation' in cand? cand.foundation: ''): 
    (type!='prflx' && 'address' in cand)? cand.address: ''; // peer-reflexive (prflx) IP is redacted anyway!
  let port = 'port' in cand? cand.port: '';
  return `${protocol} ${type} ${address}:${port}`;
}


/////////////////////// DOM untils \\\\\\\\\\\\\\\\\\\\\\\

/** Show the state of action ("click me!" or "done") onto the tooltip of a button */
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
