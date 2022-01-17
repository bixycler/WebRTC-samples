'use strict';

//require '../../../../js/utils.js';

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

const errmsg = document.getElementById('error-message');
function handleError(msg, e) {
  console.log('ERROR', msg, e);
  errmsg.innerText = `ERROR ${msg} ${e}`;
}

const offer = document.getElementById('offer');
const answer = document.getElementById('answer');
const offerStatus = document.getElementById('offer-status');
const answerStatus = document.getElementById('answer-status');
const callerCandidates = document.getElementById('caller-candidates');
const receiverCandidates = document.getElementById('receiver-candidates');
offerStatus.addEventListener('click', async()=>{
  await pasteFromClipboard(offer); updateTooltip(offerStatus,offer,'(done)'); });
answerStatus.addEventListener('click', async()=>{
  await copyToClipboard(answer); updateTooltip(answerStatus,answer,'(done)'); });
[{txt:offer, but:offerStatus}, {txt:answer, but:answerStatus}].forEach(({txt,but})=>{
  but.addEventListener('mousemove', ()=>updateTooltip(but,txt,'(done)'))});
offer.addEventListener('input', ()=>{
  startButton.disabled = !offer.value.trim();
  let candidates = offer.value.match(/a=candidate:[^\r\n]*/g);
  candidates = candidates? candidates.map(m => m.substring('a='.length)): [];
  callerCandidates.value = candidates.join('\n');
});

var localStream = null;
var pc = null;
const ICE_config = {
  'iceServers': [
    {
      'url': 'stun:stun.l.google.com:19302'
    }
  ]  
};


async function start() {
  startButton.disabled = true;
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

  pc = new RTCPeerConnection(ICE_config);
  console.log('Created peer connection object pc with ICE_config = ', ICE_config);
  console.log('ICE gathering state:', pc.iceGatheringState);
  console.log('ICE state:', pc.iceConnectionState);
  console.log('Signaling state:', pc.signalingState);
  pc.addEventListener('icegatheringstatechange', function(e){
    console.log('ICE gathering state:', pc.iceGatheringState);
    answerStatus.value = `ICE candidate ${pc.iceGatheringState}`;
    if(pc.iceGatheringState==='complete'){
      answerStatus.value = 'Copy Answer';
      answerStatus.disabled = false;
    }
  });
  pc.addEventListener('icecandidate', function(e){
    console.log('ICE candidate:', e.candidate ? e.candidate.candidate : null);
    answer.value = pc.localDescription.sdp; // update ICE candidates
    if(e.candidate){ receiverCandidates.value += e.candidate.candidate + '\n'; }
  });
  pc.addEventListener('iceconnectionstatechange', function(e){
    console.log('ICE state:', pc.iceConnectionState);
  });
  pc.addEventListener('signalingstatechange', function(e){
    console.log('Signaling state:', pc.signalingState);
  });
  pc.addEventListener('track', function(e){
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc received remote stream');
    }
  });

  //localStream.getTracks().forEach(track => pc.addTransceiver(track, {direction: "sendrecv", streams: [localStream]}));
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  console.log('Added local stream to pc');

  console.log('pc.setRemoteDescription() start');
  try {
    await pc.setRemoteDescription({type: 'offer', sdp: offer.value});
    console.log('pc.setRemoteDescription() completed: ', pc.remoteDescription);
  } catch (e) {
    handleError('pc.setRemoteDescription():', e);
    return;
  }

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
  pc.close();
  pc = null;
  hangupButton.disabled = true;
  startButton.disabled = false;
  offer.value = '';
  answer.value = '';
  answerStatus.value = 'Waiting for Start ...';
  answerStatus.disabled = true;
  callerCandidates.value = '';
  receiverCandidates.value = '';
}
