'use strict';

//require '[../../]../../js/utils.js';

var localStream = null; // the media stream on this peer
var pc = null, transports = [/*{id,dtls,components,coll#,dtlsStates,iceStates,candStates}*/], ices = new Set(); // the peer connection with its transports
var dc = {local:null, remote:null, connected:false}; // the data channels of pc
var pid = null; // the certificate of the identity of this peer
var dummyServerURL = 'turn:turn.beowulfchain.com:12345';
var pc_config = {
  'iceServers': [
    {
      'urls': 'stun:stun.l.google.com:19302'
    },
    { 'urls': dummyServerURL, // dummy server for crypto params
          'username': 'crypto:AES_CM_128_HMAC_SHA1_80',
          'credential': "inline:aKeyWithLength30bytes/40charsInBase64+++" // To be parsed by SrtpTransport::ParseKeyParams()
    },
    { 'urls': dummyServerURL, // dummy server for audio params
          'username': 'audio:0',
          'credential': "SSRC:1111 FID:1112 FEC:1113"
    },
    { 'urls': dummyServerURL, // dummy server for video params
          'username': 'video:0',
          'credential': "SSRC:961 FID:962 FEC:963"
    },
  ],
  'bundlePolicy': 'balanced', // number of transports. Note: some old peer is still bundle-unaware
    // - "max-bundle" = only 1 transport (for each layer: DTLS and ICE)
    // - "balanced" (default) = 1 transport for each type: video, audio, data channel
    // - "max-compat" = 1 transport for each track (and 1 for data channel)
  'certificates': [/*pid*/], // fix the id of this peer, to avoid regenerating new keys in subsequent calls
};
const dc_config = {
  ordered: true, // [default] guarantee in-order delivery of messages
  negotiated: false, // [default] let WebRTC automatically negotiate using its DTLS
};

//////////////////////// DOM elements & Data \\\\\\\\\\\\\\\\\\\\\\\\

const localStylesheet = document.getElementById('local-stylesheet').sheet;
const cssDeleted = localStylesheet.cssRules[0];

const masterKey = document.getElementById('master-key');
const cipherSuite = document.getElementById('cipher-suite');
const videoTrackConfig = document.getElementById('video-track-config');
const audioTrackConfig = document.getElementById('audio-track-config');

const localHashId = document.getElementById('local-hash-id');
const remoteHashId = document.getElementById('remote-hash-id');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const sourceVidres = document.getElementById('source-vidres');
const sentVidres = document.getElementById('sent-vidres');
const recvVidres = document.getElementById('recv-vidres');
sentVidres.trackId = sentVidres.senderId = null;
recvVidres.trackId = recvVidres.senderId = null;
var started = false;
localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});
localVideo.addEventListener('resize', function() {
  console.log(`Local video size changed to ${localVideo.videoWidth}x${localVideo.videoHeight}`);
});
remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});
remoteVideo.addEventListener('resize', function() {
  if(!started){// We use the first onsize callback as an indication that video stream has started
    console.log(`Remote video stream started`);
    started = true;
  }
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
});
const localMessage = document.getElementById('local-message');
const remoteMessage = document.getElementById('remote-message');
const localMessageLog = document.getElementById('local-message-log');
const remoteMessageLog = document.getElementById('remote-message-log');
localMessage.addEventListener('change', sendMessage);
localMessageLog.addEventListener('change', (e)=>{ updateHeight(e.target, 100); });
remoteMessageLog.addEventListener('change', (e)=>{ updateHeight(e.target, 100); });

const signalingState = document.getElementById('signaling-state');
const signst = {state:'signalingState', dome:signalingState, caption:'Signaling state',
  colormap:{'':'black', 'stable':'blue', 'closed':'purple'}};
const connectionState = document.getElementById('connection-state');
const connst = {state:'connectionState', dome:connectionState, caption:'Peer Connection state',
  colormap:{'':'black', 'connected':'blue', 'disconnected':'orange', 'closed':'purple', 'failed':'red'}};
const iconnectionState = document.getElementById('iconnection-state');
const conist = {state:'iceConnectionState', dome:iconnectionState, caption:'ICE Connection state',
  colormap:{'':'black', 'connected':'blue','completed':'blue', 'disconnected':'orange', 'closed':'purple', 'failed':'red'}};
const candidateState = document.getElementById('candidate-state');
const candst = {state:'iceGatheringState', dome:candidateState, caption:'ICE Candidate state',
  colormap:{'':'black', 'complete':'blue'}};
function updateState({state, dome, caption, colormap}, comment=''){
  let value = pc[state] + (comment? ` (${comment})`: '');
  console.log(`${caption}: ${value}`);
  let color = pc[state] in colormap? colormap[pc[state]]: colormap[''];
  dome.innerHTML += (dome.innerHTML? ' >> ':'') + `<span style="color:${color}">${value}</span>`;
}
const candPairState = document.getElementById('candidate-pair-state');
const candPairTable = document.getElementById('candidate-pair-table');
const candpcmap = {'':'black', 'succeeded':'blue', 'frozen':'orange', 'failed':'red'};
var candPairs = {}, candAddrs = {}; // pairId->[candPairs]->pairNode, address->[candAddrs]->candId
var selectedPairId = '';
const transportTable = document.getElementById('transport-table');
const hideDeleted = document.getElementById('hide-deleted-entries');
hideDeleted.addEventListener('change', (e)=>{ cssDeleted.style.display = (hideDeleted.checked)?'none':''; });
var statsUpdater = null;

const errmsg = document.getElementById('error-message');
const errmsgDiv = document.getElementById('error-message-div');
const errmsgClear = document.getElementById('error-message-clear');
const errmsgCopy = document.getElementById('error-message-copy');
function handleError(msg, e) {
  console.log('ERROR', msg, e);
  errmsg.value = errmsg.innerText = `${msg} ${e}`;
  errmsgDiv.hidden = false;
}
errmsgClear.addEventListener('click', ()=>{ errmsg.value = errmsg.innerText = ''; errmsgDiv.hidden = true;})
errmsgCopy.addEventListener('click', async()=>{ 
  await copyToClipboard(errmsg);
  updateTooltip(errmsgCopy,errmsg,'(done)');
})

function updateOnly(also, only, video, vidres){
  only.hidden = also.checked;
  video.hidden = vidres.hidden = !only.hidden;
}

//////////////////////// Action functions \\\\\\\\\\\\\\\\\\\\\\\\

function sendMessage(e){
  if(!dc.local || dc.local.readyState!='open'){return;}
  let msg = localMessage.value;
  dc.local.send(msg);
  console.log('Send message:', msg);
  localMessageLog.value += msg+'\n'; localMessage.value = '';
}


//////////////////////// Helper functions \\\\\\\\\\\\\\\\\\\\\\\\

async function startLocalStream(){
  if (!localStream) {
    let stream = await getLocalStream();
    if (stream) {
      console.log('Received local stream:');
      localVideo.srcObject = localStream = stream;
    }
  }
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    if (videoTracks && videoTracks.length > 0) {
      console.log(`- Video device: ${videoTracks[0].label}`);
    }
    if (audioTracks && audioTracks.length > 0) {
      console.log(`- Audio device: ${audioTracks[0].label}`);
    }
  }
}

const TransCompClassName = {
  '[object RTCSctpTransport]':'DataChannel',
  '[object RTCRtpSender]':'Sender',
  '[object RTCRtpReceiver]':'Receiver',
};
function transCompName(comp){
  let name = "";
  if(comp.track){ name = comp.track.kind+".";}
  name += TransCompClassName[Object.getPrototypeOf(comp).toString()];
  return name;
}

/**
 * Update the given transport in the dict `transports`
 */
 var trIdBase = 0; // transport id base
 function updateTransport(dtls, component, coll){
  if(!dtls){return;}
  let id=-1, idx=-1, ice = dtls.iceTransport;
  for(let i in transports){ if(transports[i].dtls==dtls){ idx = i; id = idx + trIdBase; break} }
  if(id < 0){ // new transport
    idx = transports.length; id = idx + trIdBase; 
    let trans = {id:id, dtls:dtls, components:[], coll:coll, 
      dtlsStates:[], iceStates:[], candStates:[]};
    transports.push(trans); 
    console.log(trans);
    transportTable.tBodies[0].insertAdjacentHTML('beforeend', `<tr id="transport_${id}">
      <td id="transport_${id}_id" class="text-state" title="transport_${id}">${id}</td> 
      <td id="transport_${id}_components" class="text-state" title="">${component}</td> 
      <td id="transport_${id}_dtls_state" class="text-state" title="">${dtls.state}</td> 
      <td id="transport_${id}_ice_state" class="text-state" title="">${ice?ice.state:"(none)"}</td> 
      <td id="transport_${id}_candidates" class="text-state" title="">0</td> 
      <td id="transport_${id}_ice_gathering_state" class="text-state" title="">${ice?ice.gatheringState:"(none)"}</td> 
      <td id="transport_${id}_paired" class="text-state" title=""><input id="transport_${id}_paired_check" type="checkbox" disabled="disabled"}"/></td> 
    </tr>`);
  }
  let comps=null; //Set(components)
  if(coll > transports[idx].coll || transports[idx].components.length < 1){ 
    comps = new Set(); transports[idx].components.push(comps); 
  }else{ comps = transports[idx].components.at(-1);}
  comps.add(component);
  transports[idx].coll = coll;
  if(dtls.state&& dtls.state!==transports[idx].dtlsStates.at(-1)){ transports[idx].dtlsStates.push(dtls.state);}
  if(ice&&ice.state&& ice.state!==transports[idx].iceStates.at(-1)){ transports[idx].iceStates.push(ice.state);}
  if(ice&&ice.gatheringState&& ice.gatheringState!==transports[idx].candStates.at(-1)){ transports[idx].candStates.push(ice.gatheringState);}
  //console.log('updateTransport: ', coll, dtls, component, transports);
}

/**
 * Collect all transports (DTLS & ICE) from data channel, all tracks (senders, receivers)
 */
var coll = 0; //collection #
function collectTransports(){
  if(!pc){return;}
  let cands = [];
  if(pc.sctp){  updateTransport(pc.sctp.transport, pc.sctp, ++coll); }
  for(let track of pc.getSenders()){ updateTransport(track.transport, track, coll); }
  for(let track of pc.getReceivers()){ updateTransport(track.transport, track, coll); }
  //console.log('collectTransports: ', coll, transports);
  let workingtrans = [];
  for(let trans of transports){ // process the collected transports
    let trRow = document.getElementById(`transport_${trans.id}`);
    if(trans.dtls.state=='closed'){ trRow.classList.add('deleted');
    }else{ workingtrans.push(trans);}
    let ice = trans.dtls.iceTransport; //console.log('check ', trans,ice)
    let lcands = ice.getLocalCandidates();
    if(lcands.length > cands.length){ cands = lcands;}
    // clean up duplicates in trans.components[]
    if(trans.components.length > 1 && eqSets(trans.components.at(-1), trans.components.at(-2))){
      trans.components.pop();
    }
    // update transport table
    {
      let trComps = document.getElementById(`transport_${trans.id}_components`);
      let compst = [];
      for(let comps of trans.components){
        let t = '';
        for(let comp of comps){ t += transCompName(comp)+', ';}
        if(t.length > 2){ t = t.slice(0,-2);}
        compst.push(t);
      }
      trComps.title = compst.join(" >>\n");
      trComps.innerHTML = compst.at(-1);
      let trDtlsState = document.getElementById(`transport_${trans.id}_dtls_state`);
      trDtlsState.title = trans.dtlsStates.join(" >> ");
      trDtlsState.innerHTML = trans.dtlsStates.at(-1);
      let trIceState = document.getElementById(`transport_${trans.id}_ice_state`);
      trIceState.title = trans.iceStates.join(" >> ");
      trIceState.innerHTML = trans.iceStates.at(-1);
      let trCandState = document.getElementById(`transport_${trans.id}_ice_gathering_state`);
      trCandState.title = trans.candStates.join(" >> ");
      trCandState.innerHTML = trans.candStates.at(-1);
      let trCands = document.getElementById(`transport_${trans.id}_candidates`);
      let candst = [];
      trans.dtls.iceTransport.getLocalCandidates().forEach(cand => {candst.push(candstr(cand));});
      trCands.title = candst.join('\n');
      trCands.innerHTML = candst.length;
      let trPaired = document.getElementById(`transport_${trans.id}_paired`);
      let trPairedCheck = document.getElementById(`transport_${trans.id}_paired_check`);
      let pair = trans.dtls.iceTransport.getSelectedCandidatePair(); 
      if(pair){
        if(role=='caller'){ trPaired.title = candstr(pair.local)+" [*local] <=>> [remote] "+candstr(pair.remote);
        }else{ trPaired.title = candstr(pair.remote)+" [remote] <<=> [*local] "+candstr(pair.local);}
        trPairedCheck.checked = true;
      }
    }
    // process ICE
    if(ice && !ices.has(ice)){ 
      ices.add(ice); 
      ice.addEventListener('selectedcandidatepairchange', async e => {
        let pair = ice.getSelectedCandidatePair();
        // look up pairId from this `pair`
        let lcand = 'local:'+candstr(pair.local);
        let rcand = 'remote:'+candstr(pair.remote);
        console.log('selectedcandidatepairchange', pair, lcand,'<=>',rcand);
        while(!(lcand in candAddrs && rcand in candAddrs)){ await updateStats(); }
        let pairId = '';
        for(let lid of candAddrs[lcand]){
          for(let rid of candAddrs[rcand]){
            pairId = `RTCIceCandidatePair_${lid}_${rid}`;
            if(candPairs[pairId]){break}
          }
        }
        if(!pairId){console.log('No RTCIceCandidatePair found for ', lcand,'<=>',rcand); return}
        // then update with `pairId`
        updateSelectedPair(pairId);
        //updateStats();
      });
    }
  }
  return [workingtrans, cands];
}

/**
 * Use PeerConnection's Stats `pc.getStats()` to update: candidate pairs, transports, media info
 * - Hilite the "nominated" pair with bold face and update its state & no. of packets transmitted
 *   + Hilite the "selected" pair with solid background
 * - Prepend new pairs and cross out the "deleted" ones
 */
async function updateStats(){
  if(!pc){return;}
  let stats = await pc.getStats();
  //console.log('pc stats: ', stats); // out-of-date stats???
  //for(let [id,r] of stats){if(r.type in {'candidate-pair':0, 'local-candidate':1, 'remote-candidate':1}) console.log(id,':',r);}
  let pairst = '', paired = {};  
  for(let [id,report] of stats){
    if(report.type=='candidate-pair'){
      let pairNode = document.getElementById(report.id);
      if(!pairNode){ // prepend this new pair
        console.log(report.id, report);
        let localCand = `<td name="${report.localCandidateId}" class="text-address`
        let remoteCand = `<td name="${report.remoteCandidateId}" class="text-address`;
        let leftCand = ((role=='caller')? localCand: remoteCand) + ` left"></td>`;
        let rightCand = ((role=='caller')? remoteCand: localCand) + ` right"></td>`;
        let leftDsc = (role=='caller')? `[<i>*local</i>] &lt;=`: `[remote] &lt;&lt;=`;
        let rightDsc = (role=='caller')? `=&gt;&gt; [remote]`: `=&gt; [<i>*local</i>]`;
        candPairTable.tBodies[0].insertAdjacentHTML('afterbegin', `<tr id="TR_${report.id}">
          ${leftCand} <td class="center">${leftDsc} <span id="${report.id}" class="text-state">...</span> ${rightDsc}</td> ${rightCand}
        </tr>`);
        pairNode = document.getElementById(report.id);
        candPairs[report.id] = pairNode;
      }
      let color = report.state in candpcmap? candpcmap[report.state]: candpcmap[''];
      let leftCnt = (role=='caller')? report.packetsReceived: report.packetsSent;
      let rightCnt = (role=='caller')? report.packetsSent: report.packetsReceived;
      pairNode.innerHTML = `${leftCnt} (<span style="color:${color}">${report.state}</span>) ${rightCnt}`;
      pairst += (pairst? ', ':'')+report.state; paired[report.id] = true;
      let pairRow = document.getElementById(`TR_${report.id}`);
      if(report.nominated){ pairRow.classList.add('nominated'); }else{ pairRow.classList.remove('nominated'); }
    }else if(report.type in {'local-candidate':1, 'remote-candidate':1}){
      let candNodes = document.getElementsByName(report.id);
      let candidate = candstr(report), peer = report.type.split('-')[0];
      if(!candNodes){ console.log('Unpaired candidate: ', report); }
      else{
        for(let node of candNodes){node.innerHTML = candidate};
      }
      let candId = report.id.substring('RTCIceCandidate_'.length);
      candidate = `${peer}:${candidate}`;
      if(!(candidate in candAddrs)){ candAddrs[candidate] = new Set(); }
      if(!candAddrs[candidate].has(candId)){
      console.log(report);
      candAddrs[candidate].add(candId);
      }
    }else if(report.type=='media-source' && report.kind=='video'){
      sourceVidres.innerText = report.width+'x'+report.height;
    }else if(report.type=='outbound-rtp' && report.kind=="video"){
      sentVidres.innerText = report.frameWidth+'x'+report.frameHeight+'*'+report.framesPerSecond+
        '('+report.keyFramesEncoded+'/'+report.framesEncoded+')';
    }else if(report.type=='inbound-rtp' && report.kind=="video"){
      recvVidres.innerText = report.frameWidth+'x'+report.frameHeight+'*'+report.framesPerSecond+
        '('+report.keyFramesDecoded+'/'+report.framesDecoded+')';
    }else if(report.type=='transport'){ //console.log(report);
      // Chrome: `RTCIceTransport.getSelectedCandidatePair()` gives obsolete result
      // Firefox: `RTCIceCandidatePairStats.selected` is non-standard
      // => Only this W3C standard works: `RTCTransportStats.selectedCandidatePairId`
      if(report.selectedCandidatePairId && selectedPairId!=report.selectedCandidatePairId){ console.log(report);
        updateSelectedPair(report.selectedCandidatePairId);
      }
    }
  };
  for(let id in candPairs){ 
    let pairRow = document.getElementById(`TR_${id}`);
    if(!paired[id]){ pairRow.classList.add('deleted'); }else{ pairRow.classList.remove('deleted'); }
  };
  candPairState.innerHTML = pairst? pairst: '(none)';
  collectTransports();
}

function updateSelectedPair(pairId){
  if(selectedPairId==pairId){ return }
  console.log('Selected candidate pair id = ', pairId);
  for(let id in candPairs){
    let pairRow = document.getElementById(`TR_${id}`);
    if(id==pairId){ pairRow.classList.add('selected'); 
    }else{ pairRow.classList.remove('selected'); 
      if(id==selectedPairId){ pairRow.classList.add('obsolete'); }
    }
  }
  selectedPairId = pairId;
}