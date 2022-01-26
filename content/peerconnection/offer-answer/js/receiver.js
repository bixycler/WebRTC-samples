'use strict';

//require '../../../../js/utils.js';

var localStream = null;
var pc = null, dtls = null, ice = null;
const ICE_config = {
  'iceServers': [
    {
      'url': 'stun:stun.l.google.com:19302'
    }
  ],
  'bundlePolicy': 'max-bundle' //ensure that there's only 1 transport (for each layer: DTLS and ICE)
};

const startButton = document.getElementById('startButton');
const hangupButton = document.getElementById('hangupButton');
startButton.disabled = true;
hangupButton.disabled = true;
startButton.addEventListener('click', start);
hangupButton.addEventListener('click', hangup);

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
let started = false;
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
var statsUpdater = null;
function candstr(cand, useFoundation=false){
  let protocol = 'protocol' in cand? cand.protocol.toUpperCase(): '';
  let type = 'candidateType' in cand? cand.candidateType: 'type' in cand? cand.type: '';
  let address = useFoundation? ('foundation' in cand? cand.foundation: ''): 
    (type!='prflx' && 'address' in cand)? cand.address: ''; // peer-reflexive (prflx) IP is redacted anyway!
  let port = 'port' in cand? cand.port: '';
  return `${protocol} ${type} ${address}:${port}`;
}
async function parseStats(){
  let stats = await pc.getStats();
  //console.log('pc stats: ', stats); // out-of-date stats???
  //stats.forEach(r=>{if(r.type in {'candidate-pair':0, 'local-candidate':1, 'remote-candidate':1}) console.log(r);});
  let pairst = '', paired = {};
  stats.forEach(report=>{
    if(report.type=='candidate-pair'){
      let pairNode = document.getElementById(report.id);
      if(!pairNode){ // prepend this new pair
        console.log(report);
        candPairTable.insertAdjacentHTML('afterbegin', `<tr>
          <td name="${report.remoteCandidateId}" class="text-address left"></td> 
          <td class="center">[remote] &lt;&lt;= <span id="${report.id}" class="text-state">...</span> =&gt; [<i>*local</i>]</td>
          <td name="${report.localCandidateId}" class="text-address right"></td> 
        </tr>`);
        pairNode = document.getElementById(report.id);
        candPairs[report.id] = pairNode;
      }
      let color = report.state in candpcmap? candpcmap[report.state]: candpcmap[''];
      pairNode.innerHTML = `${report.packetsSent} (<span style="color:${color}">${report.state}</span>) ${report.packetsReceived}`;
      pairst += ' '+report.state; paired[report.id] = true;
      if(report.nominated){ pairNode.classList.add('nominated'); }else{ pairNode.classList.remove('nominated'); }
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
var selectedPairDsc = '';
async function updateSelectedPair(){
  if(!ice){ return; }
  let pair = ice.getSelectedCandidatePair();
  if(!pair){ return; }
  let local = 'local:'+candstr(pair.local);
  let remote = 'remote:'+candstr(pair.remote);
  let dsc = local+' <=> '+remote;
  if(selectedPairDsc==dsc){ return; }
  console.log('Selected candidate pair: ', dsc, pair);
  //parseStats();
  if(!(local in candAddrs && remote in candAddrs)){ return; }
  selectedPairDsc = dsc; // only update selectedPairDsc if everything's alright
  let pairid = `RTCIceCandidatePair_${candAddrs[local]}_${candAddrs[remote]}`;
  console.log('Selected candidate pair id = ', pairid);
  for(let id in candPairs){
    if(id==pairid){ candPairs[id].classList.add('selected'); }else{ candPairs[id].classList.remove('selected'); }
  }
}

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
  await pasteFromClipboard(offer, offerDeflated.checked);
  updateTooltip(offerStatus,offer,'(done)', offerDeflated.checked);
});
answerStatus.addEventListener('click', async()=>{
  await copyToClipboard(answer, answerDeflated.checked);
  updateTooltip(answerStatus,answer,'(done)', answerDeflated.checked);
});
[coffer, canswer].forEach(({txt,but,deflated})=>{
  but.addEventListener('mousemove', ()=>updateTooltip(but,txt,'(done)', deflated.checked));
});
offer.addEventListener('input', ()=>{
  startButton.disabled = !offer.value.trim();
  let candidates = offer.value.match(/a=candidate:[^\r\n]*/g);
  candidates = candidates? candidates.map(m => m.substring('a='.length)): [];
  callerCandidates.value = candidates.join('\n');
});


async function start() {
  startButton.disabled = true;

  // Start UserMedia
  if (!localStream) {
    console.log('Requesting local stream (user media)');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
      console.log('Received local stream:');
      localVideo.srcObject = stream;
      localStream = stream;
    } catch (e) {
      handleError('getUserMedia():', e);
      return;
    }
  }
  const videoTracks = localStream.getVideoTracks();
  const audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    console.log(`- Video device: ${videoTracks[0].label}`);
  }
  if (audioTracks.length > 0) {
    console.log(`- Audio device: ${audioTracks[0].label}`);
  }

  // Start PeerConnection
  pc = new RTCPeerConnection(ICE_config);
  console.log('Created peer connection object pc with ICE_config = ', ICE_config);
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); parseStats();
  pc.addEventListener('negotiationneeded', async function(e){
    console.log('Starting SDP negotiation'); // NEVER on a receiver!!!
  });
  pc.addEventListener('signalingstatechange', function(e){ updateState(signst); });
  pc.addEventListener('icegatheringstatechange', function(e){
    answerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    dtls = pc.getSenders()[0].transport; // due to bundlePolicy=='max-bundle', there's only 1 transport
    if(!ice){
      ice = dtls.iceTransport;
      ice.addEventListener('selectedcandidatepairchange', async e => parseStats()); // sometimes the "selected pair" is out-of-date (e.g. stuck at 'prflx' candidate)
    }
    let ncands = '';
    if(pc.iceGatheringState=='complete'){
      let n = ice.getLocalCandidates().length;
      ncands = `${n} candidate`+(n>1?'s':'');
      answerStatus.value = 'Copy Answer';
      answerStatus.disabled = false;
    }
    updateState(candst, ncands);
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    answer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ receiverCandidates.value += e.candidate.candidate + '\n'; }
  });
  pc.addEventListener('iceconnectionstatechange', async function(e){
    updateState(conist);
    parseStats();
  });
  pc.addEventListener('connectionstatechange', async function(e){
    updateState(connst);
    parseStats();
  });
  pc.addEventListener('track', function(e){
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc received remote stream');
    }
  });
  if(statsUpdater){ clearInterval(statsUpdater); }
  statsUpdater = setInterval(parseStats, 1000); // update the state of pc every second
  console.log('pc.setRemoteDescription() start');
  try {
    await pc.setRemoteDescription({type: 'offer', sdp: offer.value});
    console.log('pc.setRemoteDescription() completed: ', pc.remoteDescription);
    console.log('Added remote stream to pc', pc.getReceivers()); //pc.getTransceivers()
  } catch (e) {
    handleError('pc.setRemoteDescription():', e);
    return;
  }

  //localStream.getTracks().forEach(track => pc.addTransceiver(track, {direction: "sendrecv", streams: [localStream]}));
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream)); // REUSE transceivers created by pc.setRemoteDescription() [https://blog.mozilla.org/webrtc/rtcrtptransceiver-explored/]
  console.log('Added local stream to pc', pc.getSenders()); //pc.getTransceivers()

  console.log('pc.setLocalDescription() start');
  try {
    await pc.setLocalDescription();
    console.log('pc.setLocalDescription() completed: ', pc.localDescription);
    answer.value = pc.localDescription.sdp; // media metadata
  } catch (e) {
    handleError('pc.setLocalDescription():', e);
    return;
  }

  // >> ICE gathering candidates [>> conntected [>> on track]]

  hangupButton.disabled = false;
}


async function hangup() {
  console.log('End call');
  pc.close(); // the "closed" state will not be fired!
  updateState(signst); updateState(conist); updateState(connst); parseStats(); // so we must update states manually
  pc = dtls = ice = null;
  hangupButton.disabled = true;
  startButton.disabled = false;
  offer.value = '';
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
}
