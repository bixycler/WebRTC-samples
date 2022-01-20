'use strict';

//require '../../../../js/utils.js';

var localStream = null;
var pc = null;
const ICE_config = {
  'iceServers': [
    {
      'url': 'stun:stun.l.google.com:19302'
    }
  ]  
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
function updateState({state, dome, caption, colormap}){
  console.log(`${caption}: ${pc[state]}`);
  let color = pc[state] in colormap? colormap[pc[state]]: colormap[''];
  dome.innerHTML += (dome.innerHTML? ' >> ':'') + `<span style="color:${color}">${pc[state]}</span>`;
}

const errmsg = document.getElementById('error-message');
function handleError(msg, e) {
  console.log('ERROR', msg, e);
  errmsg.innerText = `ERROR ${msg} ${e}`;
}

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
  updateState(signst); updateState(candst); updateState(conist); updateState(connst); 
  pc.addEventListener('negotiationneeded', async function(e){
    console.log('Starting SDP negotiation'); // NEVER on a receiver!!!
  });
  pc.addEventListener('signalingstatechange', function(e){ updateState(signst); });
  pc.addEventListener('icegatheringstatechange', function(e){
    updateState(candst);
    answerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    if(pc.iceGatheringState=='complete'){
      answerStatus.value = 'Copy Answer';
      answerStatus.disabled = false;
    }
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    answer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ receiverCandidates.value += e.candidate.candidate + '\n'; }
  });
  pc.addEventListener('iceconnectionstatechange', function(e){ updateState(conist); });
  pc.addEventListener('connectionstatechange', function(e){ updateState(connst); });
  pc.addEventListener('track', function(e){
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc received remote stream');
    }
  });

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

  hangupButton.disabled = false;
}


function hangup() {
  console.log('End call');
  pc.close(); // the "closed" state is not fired!
  updateState(signst); updateState(conist); updateState(connst); // so we must update states manually
  hangupButton.disabled = true;
  startButton.disabled = false;
  offer.value = '';
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
}
