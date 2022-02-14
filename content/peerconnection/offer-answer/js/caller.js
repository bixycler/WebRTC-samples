'use strict';

//require '../../../../js/utils.js';

var localStream = null; // the media stream on this peer
var pc = null, dtls = null, ice = null; // the peer connection with its transports
var dc = {local:null, remote:null, connected:false}; // the data channels of pc
var id = null; // the certificate of the identity of this peer
const pc_config = {
  'iceServers': [
    {
      'url': 'stun:stun.l.google.com:19302'
    }
  ],
  'bundlePolicy': 'max-bundle', // ensure that there's only 1 transport (for each layer: DTLS and ICE)
  'certificates': [/*id*/], // fix the id of this peer, to avoid regenerating new keys in subsequent calls
};
const dc_config = {
  ordered: true, // [default] guarantee in-order delivery of messages
  negotiated: false, // [default] let WebRTC automatically negotiate using its DTLS
};

//////////////////////// DOM elements & Data \\\\\\\\\\\\\\\\\\\\\\\\

const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
callButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

const localHashId = document.getElementById('local-hash-id');
const remoteHashId = document.getElementById('remote-hash-id');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
var started = false;
localVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
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
const candidateState = document.getElementById('candidate-state');
const candst = {state:'iceGatheringState', dome:candidateState, caption:'ICE Candidate state',
  colormap:{'':'black', 'complete':'blue'}};
const iconnectionState = document.getElementById('iconnection-state');
const conist = {state:'iceConnectionState', dome:iconnectionState, caption:'ICE Connection state',
  colormap:{'':'black', 'connected':'blue','completed':'blue', 'disconnected':'orange', 'closed':'purple', 'failed':'red'}};
const connectionState = document.getElementById('connection-state');
const connst = {state:'connectionState', dome:connectionState, caption:'Connection state',
  colormap:{'':'black', 'connected':'blue', 'disconnected':'orange', 'closed':'purple', 'failed':'red'}};
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
var selectedPairDsc = '', obsoletePairDsc = '';
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

const offer = document.getElementById('offer');
const answer = document.getElementById('answer');
const offerStatus = document.getElementById('offer-status');
const answerStatus = document.getElementById('answer-status');
const offerDeflated = document.getElementById('offer-deflated');
const answerDeflated = document.getElementById('answer-deflated');
const callerCandidates = document.getElementById('caller-candidates');
const receiverCandidates = document.getElementById('receiver-candidates');
const coffer = {txt:offer, but:offerStatus, deflated:offerDeflated};
const canswer = {txt:answer, but:answerStatus, deflated:answerDeflated};
offerStatus.addEventListener('click', async()=>{
  await copyToClipboard(offer, offerDeflated.checked);
  updateTooltip(offerStatus,offer,'(done)', offerDeflated.checked);
});
answerStatus.addEventListener('click', async()=>{
  await pasteFromClipboard(answer, answerDeflated.checked);
  updateTooltip(answerStatus,answer,'(done)', answerDeflated.checked);
});
[coffer, canswer].forEach(({txt,but,deflated})=>{
  but.addEventListener('mousemove', ()=>updateTooltip(but,txt,'(done)', deflated.checked));
});
answer.addEventListener('input', ()=>{
  callButton.disabled = !answer.value.trim();
  let candidates = answer.value.match(/a=candidate:[^\r\n]*/g);
  candidates = candidates? candidates.map(m => m.substring('a='.length)): [];
  receiverCandidates.value = candidates.join('\n');
  let fingerprint = answer.value.match(/a=fingerprint:[^\r\n]*/g);
  fingerprint = fingerprint? fingerprint[0].substring('a=fingerprint:'.length): '';
  console.log(`Remote peer's fingerprint: ${fingerprint}`);
  remoteHashId.innerText = fingerprint.hashCode(true);
  remoteHashId.title = 'Fingerprint:'+fingerprint;
});


//////////////////////// Action functions \\\\\\\\\\\\\\\\\\\\\\\\

async function start() {
  startButton.disabled = true;
  if(!id){ 
    id = await RTCPeerConnection.generateCertificate(stdRSACertificate);
    pc_config.certificates = [id];
    let fp = id.getFingerprints()[0], fpv = fp.algorithm+' '+fp.value.toUpperCase();
    console.log(`Id (fingerprint) of this peer: ${fpv}`);
    localHashId.innerText = fpv.hashCode(true);
    localHashId.title = 'Fingerprint:'+fpv;
  }

  // 0. Start UserMedia
  await startLocalStream();

  // 1. Start PeerConnection
  pc = new RTCPeerConnection(pc_config);
  console.log('Created peer connection object pc with pc_config = ', pc_config);
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); updateStats();
  pc.addEventListener('negotiationneeded', async function(e){
    console.log('Starting SDP negotiation');
    // The following pc.setLocalDescription(offer) can be put right after pc.addTrack(), or right after pc.createDataChannel() if there's no media track.
    // But here we put it in event 'negotiationneeded' just to be on the safe side.
    // 3. Set LocalDescription
    console.log('pc.setLocalDescription() start');
    try {
      const sender = await pc.setLocalDescription();
      console.log('pc.setLocalDescription() completed: ', pc.localDescription);
      offer.value = pc.localDescription.sdp; // media metadata
    } catch (e) {
      handleError('pc.setLocalDescription():', e);
      return;
    }
  });
  pc.addEventListener('signalingstatechange', function(e){ updateState(signst); });
  pc.addEventListener('icegatheringstatechange', function(e){
    offerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    dtls = pc.sctp? pc.sctp.transport: pc.getSenders()[0].transport; // due to bundlePolicy=='max-bundle', there's only 1 transport for all: pc.sctp (data channel), senders & receivers of all tracks
    if(!ice){
      ice = dtls.iceTransport;
      ice.addEventListener('selectedcandidatepairchange', async e => updateStats());
    }
    let ncands = '';
    if(pc.iceGatheringState=='complete'){
      let n = ice.getLocalCandidates().length;
      ncands = `${n} candidate`+(n>1?'s':'');
      offerStatus.value = 'Copy Offer';
      offerStatus.disabled = false;
      answerStatus.value = 'Paste Answer';
      answerStatus.disabled = false;
    }
    updateState(candst, ncands);
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    offer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ callerCandidates.value += e.candidate.candidate + '\n'; }
  });
  pc.addEventListener('iceconnectionstatechange', async function(e){
    updateState(conist);
    updateStats();
  });
  pc.addEventListener('connectionstatechange', async function(e){
    updateState(connst);
    updateStats();
  });
  pc.addEventListener('track', function(e){
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc received remote stream');
    }
  });
  // Update pc's stats periodically. Required, because both pc's stats and selected candidate pair are not up-to-date at pc & ice events
  if(statsUpdater){ clearInterval(statsUpdater); }
  statsUpdater = setInterval(updateStats, 1000); // update every second

  // 1.1. Start DataChannel
  dc.local = pc.createDataChannel('text-messaging', dc_config);
  console.log('Created data channel dc.local with dc_config = ', dc_config);
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); updateStats();
  dc.local.binaryType = 'arraybuffer';
  dc.local.addEventListener('open', (e) => {
    console.log('Local channel opened.');
    dc.connected = true;
  });
  dc.local.addEventListener('close', (e) => {
    console.log('Local channel closed.');
    dc.connected = false;
  });
  dc.local.addEventListener('message', (e) => { // NEVER on a local channel!
    console.log('Local message received... back?!:', e.data);
  });
  pc.addEventListener('datachannel', (e) => {
    console.log('Remote channel received:', e.channel);
    dc.remote = e.channel;
    dc.remote.addEventListener('open', (e) => {
      console.log('Remote channel opened.');
      dc.connected = true;
    });
    dc.remote.addEventListener('close', (e) => {
      console.log('Remote channel closed.');
      dc.connected = false;
    });
    dc.remote.addEventListener('message', (e) => {
      let msg = e.data;
      console.log('Remote message received:', msg);
      remoteMessage.value = msg; remoteMessageLog.value += msg+'\n';
    });
    });

  // 2. Add Tracks
  if (localStream) {
    //localStream.getTracks().forEach(track => pc.addTransceiver(track, {direction: "sendrecv", streams: [localStream]}));
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream)); //=> pc.addTransceiver() because no transceiver yet [https://blog.mozilla.org/webrtc/rtcrtptransceiver-explored/]
    console.log('Added local stream to pc', pc.getSenders()); //pc.getTransceivers()
  }

  // >> on negotiationneeded { setLocalDescription()} >> ICE gathering candidates
  // >> call() { setRemoteDescription()} [>> conntected [>> on track] ]
}


async function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');

  // 4. Set RemoteDescription
  console.log('pc.setRemoteDescription() start');
  try {
    await pc.setRemoteDescription({type: 'answer', sdp: answer.value});
    console.log('pc.setRemoteDescription() completed: ', pc.remoteDescription);
    console.log('Added remote stream to pc', pc.getReceivers()); //pc.getTransceivers()
  } catch (e) {
    handleError('pc.setRemoteDescription():', e);
    return;
  }
}

function sendMessage(e){
  if(!dc.local || dc.local.readyState!='open'){return;}
  let msg = localMessage.value;
  dc.local.send(msg);
  console.log('Send message:', msg);
  localMessageLog.value += msg+'\n'; localMessage.value = '';
}

async function hangup() {
  console.log('End call');
  pc.close(); // the "closed" state will not be fired!
  updateState(signst); updateState(conist); updateState(connst); updateStats(); // so we must update states manually
  pc = dtls = ice = null;
  hangupButton.disabled = true;
  startButton.disabled = false;
  offer.value = '';
  offerStatus.value = 'Waiting for Start ...';
  offerStatus.disabled = true;
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
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

async function updateStats(){
  if(!pc){return;}
  let stats = await pc.getStats();
  //console.log('pc stats: ', stats); // out-of-date stats???
  //stats.forEach(r=>{if(r.type in {'candidate-pair':0, 'local-candidate':1, 'remote-candidate':1}) console.log(r);});
  let pairst = '', paired = {};
  stats.forEach(report=>{
    if(report.type=='candidate-pair'){
      let pairNode = document.getElementById(report.id);
      if(!pairNode){ // prepend this new pair
        console.log(report);
        candPairTable.tBodies[0].insertAdjacentHTML('afterbegin', `<tr id="TR_${report.id}">
          <td name="${report.localCandidateId}" class="text-address left"></td> 
          <td class="center">[<i>*local</i>] &lt;= <span id="${report.id}" class="text-state">...</span> =&gt;&gt; [remote]</td>
          <td name="${report.remoteCandidateId}" class="text-address right"></td> 
        </tr>`);
        pairNode = document.getElementById(report.id);
        candPairs[report.id] = pairNode;
      }
      let color = report.state in candpcmap? candpcmap[report.state]: candpcmap[''];
      pairNode.innerHTML = `${report.packetsReceived} (<span style="color:${color}">${report.state}</span>) ${report.packetsSent}`;
      pairst += (pairst? ', ':'')+report.state; paired[report.id] = true;
      let pairRow = document.getElementById(`TR_${report.id}`);
      if(report.nominated){ pairRow.classList.add('nominated'); }else{ pairRow.classList.remove('nominated'); }
    }else if(report.type in {'local-candidate':1, 'remote-candidate':1}){
      //console.log(report);
      let candNodes = document.getElementsByName(report.id);
      let candidate = candstr(report), peer = report.type.split('-')[0];
      if(!candNodes){ console.log('Unpaired candidate: ', report); }
      else{
        candNodes.forEach(node=>{node.innerHTML = candidate});
      }
      candidate = `${peer}:${candidate}`;
      if(!(candidate in candAddrs)){ candAddrs[candidate] = report.id.substring('RTCIceCandidate_'.length); }
    }
  });
  for(let id in candPairs){ if(!paired[id]){ candPairs[id].classList.add('deleted'); }else{ candPairs[id].classList.remove('deleted'); }};
  candPairState.innerHTML = pairst? pairst: '(none)';

  updateSelectedPair();
}

async function updateSelectedPair(){
  if(!ice){ return; }
  let pair = ice.getSelectedCandidatePair();
  if(!pair){ return; }
  let local = 'local:'+candstr(pair.local);
  let remote = 'remote:'+candstr(pair.remote);
  let dsc = local+' <=> '+remote;
  if(selectedPairDsc!=dsc){ console.log('Selected candidate pair: ', dsc, pair); }
  //updateStats(); // if updateSelectedPair() is not embedded in updateStats()
  if(!(local in candAddrs && remote in candAddrs)){ return; }
  let pairid = `RTCIceCandidatePair_${candAddrs[local]}_${candAddrs[remote]}`;
  if(selectedPairDsc!=dsc){// new selected pair
    console.log('Selected candidate pair id = ', pairid);
    for(let id in candPairs){
      let pairRow = document.getElementById(`TR_${id}`);
      if(id==pairid){ pairRow.classList.add('selected'); }else{ pairRow.classList.remove('selected'); }
    }
    selectedPairDsc = dsc; // only update selectedPairDsc if everything's alright
  }else if(obsoletePairDsc!=dsc){// sometimes the "selected pair" is stuck at 'prflx' candidate ==> obsolete it!
    if(candPairs[pairid].classList.contains('deleted')){
      let pairRow = document.getElementById(`TR_${pairid}`);
      pairRow.classList.remove('selected'); pairRow.classList.add('obsolete');
      obsoletePairDsc = dsc;
    }
  }
}
